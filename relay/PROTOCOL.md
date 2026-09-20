# Relay protocol

WebSocket message schema between the relay, the TV receiver, and companion
apps. The relay is transport only: it validates message shape, tracks room
membership, and forwards — it never inspects or acts on payload contents
beyond what's needed to route (see root [README.md](../README.md) hard
rules).

## Transport

- Single WebSocket endpoint, e.g. `ws://<relay-host>:<port>/`.
- Every frame is a single JSON object (the "envelope"). No binary frames.
- Every envelope has a `type` string. Unknown `type`, non-JSON, or
  schema-invalid frames get an `error` reply and are otherwise ignored
  (connection stays open).
- LAN-only, no TLS, no auth beyond the room code (decision #4 in PLAN.md).

## Roles and connection lifecycle

A socket is either a **tv** or a **companion**, decided by the first
message it sends after connecting. A socket that sends anything else
first gets an `error` and is dropped.

### TV connects

```json
{ "type": "register", "role": "tv" }
```

Relay creates a new room, generates a code and a `resumeToken`, and replies:

```json
{ "type": "registered", "role": "tv", "code": "K7H4PX", "resumeToken": "..." }
```

The relay hands back the raw code only. It does not know or care what the
TV displays — the TV renders the code as plain text *and* builds its own
QR payload (a URL into the companion app, e.g.
`https://<companion-host>/pair?code=K7H4PX`, using a companion base URL
baked into the TV app's own config). This keeps QR content a TV/companion
concern, not a relay concern, consistent with the relay being transport
only.

`resumeToken` is how the TV can reclaim this exact room (same code) after
a dropped connection, without forcing every paired companion to re-pair
over a brief network blip. A reconnecting TV includes it:

```json
{ "type": "register", "role": "tv", "resume": { "code": "K7H4PX", "token": "..." } }
```

If the room still exists (see "Disconnects" below) and the token matches,
the relay reattaches this socket as the room's TV and replies with the
*same* `code` (and a resumeToken, for the next reconnect). Companions in
the room are never notified — as far as they can tell, nothing happened.
If the token doesn't match (or the room's already been torn down), the
relay silently falls back to creating a brand new room, same as a `register`
with no `resume` at all.

The TV only ever holds `resumeToken` in memory for the life of its app
process — it isn't written to disk. A genuine app restart has nothing to
resume with and always gets a fresh room (decision #2 in PLAN.md: the
companion is what remembers long-term, not the relay).

### Companion connects

```json
{ "type": "join", "role": "companion", "code": "K7H4PX" }
```

Relay looks up the room by code. Success:

```json
{ "type": "joined", "code": "K7H4PX" }
```

Failure (unknown/expired code, or TV in that room has disconnected):

```json
{ "type": "error", "code": "TV_NOT_FOUND", "message": "No TV is using this code." }
```

On failure the companion should prompt the user to re-pair (scan the QR
again or type a new code) — this is also what a companion gets when it
auto-reconnects (decision #2) with a remembered code for a TV that's no
longer live.

A room supports multiple simultaneous companions (decision #5). Each
`join` with a valid code just adds that socket to the room's companion
set; there's no limit and no "already has a companion" rejection.

## Commands (companion → relay → TV)

Any companion in the room can send a command; the relay forwards it to
the TV verbatim, tagged with nothing extra (the TV doesn't need to know
which companion sent it — no per-companion command locking, decision #5:
last write wins).

```json
{ "type": "command", "action": "play", "payload": { "url": "https://jellyfin.local/.../stream.m3u8", "title": "Episode title", "startPositionSec": 0 } }
{ "type": "command", "action": "pause" }
{ "type": "command", "action": "stop" }
{ "type": "command", "action": "seek", "payload": { "positionSec": 120 } }
```

- `action` is one of `play`, `pause`, `stop`, `seek`.
- `payload` is required for `play` and `seek`, omitted for `pause`/`stop`.
- `play.payload.url` is the only required field; `title` and
  `startPositionSec` are optional metadata for the TV's UI.
- If there's no TV in the room (shouldn't normally happen — the room only
  exists while the TV is connected), the relay replies to the sender with
  `{ "type": "error", "code": "TV_NOT_FOUND", ... }` instead of forwarding.

## Status (TV → relay → all companions in room)

The TV sends a status update on every state transition (not just when
asked), and the relay broadcasts it to every companion currently in the
room:

```json
{ "type": "status", "state": "idle", }
{ "type": "status", "state": "buffering", "positionSec": 0 }
{ "type": "status", "state": "playing", "positionSec": 42, "durationSec": 1380, "title": "Episode title" }
{ "type": "status", "state": "paused", "positionSec": 42, "durationSec": 1380 }
{ "type": "status", "state": "stopped" }
{ "type": "status", "state": "error", "error": { "code": "PLAYBACK_FAILED", "message": "..." } }
```

- `state` is one of `idle`, `buffering`, `playing`, `paused`, `stopped`,
  `error`.
- `positionSec`, `durationSec` and `title` are optional, included when
  meaningful. `durationSec` is omitted until AVPlay has actually prepared
  the stream (it can't be known before then), and companions should treat
  its absence as "not seekable yet" rather than assume 0.
- `error` is present only when `state` is `error`.

## Disconnects

- **TV disconnects:** the room and its code are *not* torn down
  immediately — the relay keeps them alive for a grace period (45s; see
  `TV_GRACE_MS` in `relay/src/index.js`, comfortably longer than the TV's
  own reconnect backoff cap) in case the TV reconnects and reclaims the
  room with its `resumeToken` (see "TV connects" above). Companions
  already in the room get no notification during this window — a command
  sent while the TV is mid-reconnect just gets `TV_NOT_FOUND` for that one
  request, same as a room with no TV would.

  Only once the grace period elapses with no successful reattach does the
  relay give up: it broadcasts one final status to all companions in the
  room, then tears the room down for good:
  ```json
  { "type": "status", "state": "tv_offline" }
  ```
  Any companion `join` against that room's code after this point gets
  `TV_NOT_FOUND`.
- **Companion disconnects:** relay silently drops it from the room's
  companion set. No notification to the TV or other companions — the TV
  doesn't need to know how many companions are watching.

## Error codes

`{ "type": "error", "code": "<CODE>", "message": "<human-readable>" }`

| code | when |
|---|---|
| `TV_NOT_FOUND` | `join` with unknown/expired code, or command sent to a room with no TV |
| `INVALID_MESSAGE` | malformed JSON or missing/wrong-typed required fields |
| `UNKNOWN_TYPE` | `type` isn't one of the types above |
| `ALREADY_REGISTERED` | a socket sends `register`/`join` twice |

## Room code format

6 characters, uppercase, from an alphabet that excludes visually
ambiguous characters (`0`/`O`, `1`/`I`/`L`):
`ABCDEFGHJKMNPQRSTUVWXYZ23456789`. Generated fresh per TV connection;
uniqueness enforced against currently-live rooms only (codes are free to
reuse once a room is torn down).
