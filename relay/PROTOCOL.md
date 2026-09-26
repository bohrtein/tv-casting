# Relay protocol

WebSocket message schema between the relay, the TV receiver, and companion
apps. The relay is transport only: it validates message shape and
forwards — it never inspects or acts on payload contents beyond what's
needed to route (see root [README.md](../README.md) hard rules).

There is no pairing step. The relay tracks at most one TV socket (the
most recent to register) and any number of companion sockets; every
companion talks to whichever TV is currently connected.

## Transport

- Single WebSocket endpoint, e.g. `ws://<relay-host>:<port>/`.
- Every frame is a single JSON object (the "envelope"). No binary frames.
- Every envelope has a `type` string. Unknown `type`, non-JSON, or
  schema-invalid frames get an `error` reply and are otherwise ignored
  (connection stays open).
- LAN-only, no TLS, no auth.

## Roles and connection lifecycle

A socket is either a **tv** or a **companion**, decided by the first
message it sends after connecting. A socket that sends anything else
first gets an `error` and is dropped.

### TV connects

```json
{ "type": "register", "role": "tv" }
```

Relay replies:

```json
{ "type": "registered", "role": "tv" }
```

A second TV registering simply replaces the previous one as *the* TV —
there's no code, no ownership check.

### Companion connects

```json
{ "type": "join", "role": "companion" }
```

Relay replies:

```json
{ "type": "joined" }
```

Any number of companions can be connected simultaneously (decision #5 in
PLAN.md — multi-companion, no command locking).

## Commands (companion → relay → TV)

Any connected companion can send a command; the relay forwards it to the
TV verbatim.

```json
{ "type": "command", "action": "play", "payload": { "url": "https://jellyfin.local/.../stream.m3u8", "title": "Episode title", "startPositionSec": 0 } }
{ "type": "command", "action": "pause" }
{ "type": "command", "action": "resume" }
{ "type": "command", "action": "stop" }
{ "type": "command", "action": "seek", "payload": { "positionSec": 120 } }
```

- `action` is one of `play`, `pause`, `resume`, `stop`, `seek`, `captions`.
- `payload` is required for `play` and `seek`, omitted for
  `pause`/`resume`/`stop`.
- `resume` un-pauses whatever the TV has loaded, without a url, so any
  companion can resume, not just the one that cast it. (`play` with the
  url the TV already has loaded also resumes, and older TV builds only
  understand that.)
- `play.payload.url` is the only required field; `title` and
  `startPositionSec` are optional metadata for the TV's UI. `subtitleUrl` may
  point to a resolver-hosted UTF-8 SAMI file. The receiver downloads it locally
  before preparing AVPlay.
- `captions.payload` requires the `mediaId` from the selected receiver's latest
  `status.captions`, and either `trackId` (`null` for Off, `embedded:N`, or
  `external`) or `subtitleUrl` (a resolver-hosted HTTP(S) SAMI URL).
  The TV downloads a new external subtitle and attaches it during playback.
  Commands for an earlier media ID are ignored. Example:
  `{ "type": "command", "action": "captions", "payload": { "mediaId": "2", "trackId": "embedded:3" } }`.
- If no TV is currently connected, the relay replies to the sender with
  `{ "type": "error", "code": "TV_NOT_FOUND", ... }` instead of forwarding.

## Status (TV → relay → all companions)

The TV sends a status update on every state transition (not just when
asked), and the relay broadcasts it to every connected companion:

```json
{ "type": "status", "state": "idle", }
{ "type": "status", "state": "buffering", "positionSec": 0 }
{ "type": "status", "state": "playing", "positionSec": 42, "durationSec": 1380, "title": "Episode title" }
{ "type": "status", "state": "paused", "positionSec": 42, "durationSec": 1380 }
{ "type": "status", "state": "stopped" }
{ "type": "status", "state": "error", "error": { "code": "PLAYBACK_FAILED", "message": "..." } }
```

- `state` is one of `idle`, `buffering`, `playing`, `paused`, `stopped`,
  `error`, `tv_offline`.
- `positionSec`, `durationSec` and `title` are optional, included when
  meaningful. `durationSec` is omitted until AVPlay has actually prepared
  the stream (it can't be known before then), and companions should treat
  its absence as "not seekable yet" rather than assume 0.
- `error` is present only when `state` is `error`.
- TV status also includes `captions: { supported, mediaId, tracks: [{id, label}],
  selectedId, busy, error }`. A null `selectedId` means Off. Caption errors are
  nonfatal and do not change playback state. Caption data is repeated in status
  updates so joining companions and target snapshots have the current selection.

## Disconnects

- **TV disconnects:** the relay immediately broadcasts
  `{ "type": "status", "state": "tv_offline" }` to every connected
  companion. A command sent before that broadcast arrives just gets
  `TV_NOT_FOUND`.
- **Companion disconnects:** relay silently drops it. No notification to
  the TV or other companions — the TV doesn't need to know how many
  companions are watching.

## Error codes

`{ "type": "error", "code": "<CODE>", "message": "<human-readable>" }`

| code | when |
|---|---|
| `TV_NOT_FOUND` | a command is sent while no TV is connected |
| `INVALID_MESSAGE` | malformed JSON or missing/wrong-typed required fields |
| `UNKNOWN_TYPE` | `type` isn't one of the types above |
| `ALREADY_REGISTERED` | a socket sends `register`/`join` twice |

## Browser receivers and target routing

Browser receivers register with {type: "register", role: "receiver", name: "Device name", receiverId: "UUID"}.
The optional receiverId lets a browser keep its target identity across reconnects; older
receivers without it receive a fresh identity each time. A new connection with the same
receiverId replaces the previous socket.
The response includes an assigned targetId. TV retains the stable id "tv".
Companions receive {type: "targets", targets: [{id, name, online}]} on join and when receivers change.
A join may include targetId; otherwise it selects TV. Change destination with
{type: "select-target", targetId: "..."}. Commands and status are scoped to that destination.
An offline destination is never silently replaced with TV. Reconnected browser receivers
with a receiverId retain their identity and selection. Status snapshots are sent on selection.

Seek accepts either {positionSec: 30} or {deltaSec: -10}. Relative input is accumulated
by the receiver. TV status can include pendingSeek: {targetSec, busy, error}; null targetSec
means the operation was acknowledged. "ended" identifies natural completion, separate
from "stopped". The receiver's playback-history helper contacts the library resolver for
continuation; companions never race to autoplay. The relay remains transport-only.
