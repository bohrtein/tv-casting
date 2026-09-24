# TV Casting App — Implementation Plan

## Architecture recap

Three independent pieces, one repo, three top-level folders:

- **`relay/`** — Node.js + `ws`, runs on the home Ubuntu server alongside the
  app-launcher hub. No pairing — tracks at most one connected TV and any
  number of companions, forwards play/pause/stop/status JSON messages
  between them. Transport only — no media logic, no direct calls to the
  media server.
- **`tv-receiver/`** — Samsung Tizen (HTML/CSS/JS + AVPlay API). Connects to
  the relay on boot, plays whatever direct stream URL it's sent, reports status
  back.
- **`companion/`** — phone/computer PWA. Talks to Jellyfin directly for
  library browsing and direct stream URLs, and accepts direct media links
  (`.mp4`, `.m3u8`), styled with the existing design system, connects to the relay
  only to send play commands and receive status.

Hard rules (from project conventions, keep enforcing these in review):
- Relay never touches media files or calls Jellyfin directly.
- Companion never streams through the relay — media flows Jellyfin/direct host
  → TV directly; only control/status JSON goes through the relay.
- No media scraping, stream ripping, web-page extraction, or re-encoding services.

## Decisions (locked in)

1. ~~**Room code** — TV generates a short code and renders it as a QR code
   (primary path for phone companions) with the plain code printed
   underneath (fallback for desktop companions, which can't scan their
   own screen). One relay pairing mechanism, two entry paths.~~
   **Superseded twice now (see status log)** — pairing/QR was removed,
   restored, and has now been removed again for good: the relay tracks
   at most one TV and any number of companions with no gating at all,
   and nothing needs to survive a TV app restart because there's nothing
   to lose.
2. ~~**Pairing lifecycle** — companion remembers the last paired TV
   (room code / TV id) in local storage and auto-reconnects on next
   launch if that TV/room is still live. TV still gets a new code on
   every app restart; the *companion* is what remembers, not the relay.~~
   **Superseded** — nothing to remember or reconnect to now that there's
   no room/code concept.
3. **Relay message schema** — still needs to be nailed down at the start
   of Phase 1 (exact JSON shape for `play`/`pause`/`stop`/`status`/errors),
   but no open product question left — this is just implementation detail
   now.
4. **Relay exposure/auth** — home LAN only, room code is the only auth.
   No VPN/remote access, no secondary secret, matches "runs on the home
   Ubuntu server" framing.
5. **Multi-companion** — a room supports multiple companions
   simultaneously; any of them can send play/pause/stop; the relay
   broadcasts status to all companions in the room. Accept last-write-wins
   on conflicting commands rather than building command locking.
6. **Jellyfin auth in companion** — log in once against Jellyfin's auth
   endpoint, store the resulting API key/access token in device local
   storage, reuse until it expires or is revoked.
7. **Design system — [Matrix](https://github.com/bohrtein/matrix_design)**
   (private repo, `bohrtein/matrix_design`). Phosphor-on-black terminal
   look: liquid glass panels over an animated digital-rain background,
   phone-first, no build step. Two files (`matrix.css` + `matrix.js`,
   ES5, ~ same pattern already used in `munbyn-tickets`), plus
   `fonts/SpaceMono-*.ttf` and `fonts/UnifrakturMaguntia-Book.ttf`
   (SIL OFL — ship `fonts/OFL.txt` alongside). Component reference lives
   in that repo's `index.html`.
   - Copy `matrix.css`, `matrix.js`, `fonts/` into `companion/` at the
     start of Phase 3; don't fork them, pull updates from the source repo
     if it changes.
   - Follow the system's four rules: one accent color (green; amber/red
     only for waiting/error states), keep the rain+bloom canvases and
     vignette/scanlines behind any glass panel, nothing tappable under
     `--mx-tap` (46px) with `mx-has-cmdbar` on `<body>` if a command bar
     is used, and respect `prefers-reduced-motion`.
   - This is a phone-first system; the desktop-companion pairing-by-typed-code
     path (decision #1) still needs its own layout pass since Matrix's
     two-column breakpoint is designed around 900px+, not a full desktop
     control surface.
8. **Tizen target** — build against the latest Tizen TV API profile,
   iterate in the Tizen Studio emulator, sideload to the real TV once
   core pairing/playback flows work in the emulator.

## Phases

### Phase 0 — Repo scaffolding & shared conventions
- Create `relay/`, `tv-receiver/`, `companion/` top-level folders.
- Root `README.md` describing the three pieces and the transport-only rule
  for the relay.
- Root `.gitignore`, root `package.json` if using workspaces (optional —
  decide once relay/companion tooling is chosen).
- Write `relay/PROTOCOL.md`: exact JSON message schema for pair/play/
  pause/stop/status/error, covering the multi-companion broadcast case
  (decision #5) and the QR-code + plain-code pairing payload (decision #1).
- Pull `matrix.css`, `matrix.js`, and `fonts/` from
  [matrix_design](https://github.com/bohrtein/matrix_design) into
  `companion/` so Phase 3 starts from the real design system, not a
  placeholder.

**Deliverable:** empty-but-structured repo, agreed message schema doc
(`relay/PROTOCOL.md` or similar).

### Phase 1 — Relay server
- Node.js + `ws` server: WebSocket endpoint, in-memory room registry
  (code → {tv socket, set of companion sockets}) — a room is one TV and
  zero-or-more companions per decision #5.
- Pairing: TV connects, requests a room code, gets one back plus enough
  info for it to render the QR (e.g. a `matrixcast://<code>` payload or
  just the raw code — pin this down in `PROTOCOL.md`); companion connects
  with a code (scanned or typed) and gets added to that room's companion
  set.
- Message forwarding: any companion → relay → TV for commands, TV → relay
  → *all* companions in the room for status, with schema validation
  (reject malformed JSON). No command locking — last write wins.
- Disconnect/reconnect handling: TV drop mid-cast notifies remaining
  companions; a companion reconnecting with a remembered room code
  (decision #2) rejoins if the room still exists, otherwise gets a clear
  "TV not found" so it can prompt for re-pairing.
- Basic logging, and a health/readiness endpoint if it'll run under the
  app-launcher hub's process supervision.
- Deployment: systemd unit or however the app-launcher hub's other
  services are run on the Ubuntu box — match that convention rather than
  inventing a new one.

**Deliverable:** relay running locally, testable with two `wscat` sessions
simulating a TV and a companion exchanging pair → play → status messages.

### Phase 2 — TV receiver app (Tizen)
- Idle screen: renders the QR code (large, high contrast) with the plain
  text code underneath it (decision #1), connects to relay on boot,
  requests a room code.
- Relay client: reconnect-with-backoff if the WebSocket drops, re-requests
  a code on reconnect if the old one expired.
- Playback: AVPlay integration — receive a direct stream URL + play command,
  load and play, handle pause/stop/seek if in scope, surface playback
  errors.
- Status reporting: send state changes (buffering, playing, paused,
  stopped, error) back through the relay on every transition, not just on
  request.
- Return-to-idle behavior when playback ends or the companion disconnects.

**Deliverable:** receiver installed on Tizen Studio emulator (then real TV
once available), pairable and controllable end-to-end from a manual
WebSocket client standing in for the companion.

### Phase 3 — Companion app (PWA)
- Jellyfin integration: log in once, fetch and store the API key/token in
  local storage (decision #6), library browsing, fetch direct stream
  URLs — entirely separate from the relay connection.
- Direct media casting: "Cast a link" tab allowing users to cast direct video URLs
  (`.mp4`, `.m3u8`, etc.) directly to the TV receiver via AVPlay.
- Relay client: pair by scanning the TV's QR (camera, mobile) or typing
  the plain code underneath it (desktop, decision #1); remember the last
  paired room and auto-reconnect on next launch (decision #2); send
  `play` with the direct stream URL + metadata, send pause/stop, receive
  and render TV status broadcast to every companion in the room
  (decision #5).
- UI built on the [Matrix](https://github.com/bohrtein/matrix_design)
  design system (`matrix.css`/`matrix.js`, decision #7): library browser,
  now-playing/remote-control view, pairing entry screen (QR scan view +
  typed-code fallback). Keep the rain/bloom background and glass panels
  per the system's rules; build the desktop pairing/control layout as its
  own pass rather than stretching the phone-first components.
- PWA install/offline shell basics (manifest, service worker for app shell
  only — never for cached media, since media never flows through this app
  to begin with... it goes Jellyfin/host → TV directly).

**Deliverable:** companion running on a phone and desktop browser, full
loop: browse Jellyfin or input direct media URL → pair with TV → cast → control → see live status.

### Phase 4 — Integration & hardening
- End-to-end test pass: pairing edge cases (wrong code, expired code, TV
  offline), mid-playback relay restart, companion backgrounded on mobile
  and reconnecting, multiple companions to one TV (if that's meant to be
  supported — decide and document).
- Error surfacing: Jellyfin errors, AVPlay errors, relay disconnects — each
  should reach the companion UI in a recognizable way.
- Security pass on the relay (matches decision #4): confirm the room-code
  scheme is adequate for the actual exposure (LAN-only vs. remote access).

### Phase 5 — Deployment
- Relay deployed on the Ubuntu server next to the app-launcher hub,
  following whatever process-management convention that hub already uses.
- TV receiver packaged/signed and installed on the actual Samsung TV.
- Companion PWA hosted somewhere reachable by phone/desktop on the home
  network (or wherever the design intends).

## Current status

2026-09-24 — Dropped the idle screen's looping `<video>` background for
good. On the real TV it never played: it showed the first frame, then
disappeared, across every encode tried. The idle screen now shows a
static still of the digital rain (`media/idle-background.jpg`, formerly
the video's poster) as a plain CSS background. Removed the `.mp4`, the
on-screen `idle-bg-debug` instrumentation, and the
`tools/render-idle-background.js` generator. Don't retry a video
background. Also added console logging across `tv-receiver` (relay,
player, app, uncaught errors) via `js/log.js`, so it all shows up in
devtools.

2026-09-21 — Removed `resolver/` and all web-stream extraction/downloading services.
Restored architecture to a clean, 3-tier structure (`relay/`, `tv-receiver/`, `companion/`).
Media delivery is strictly direct-pass-through: the companion app fetches direct media stream
URLs from the user's Jellyfin instance or accepts direct media URLs (`.mp4`, `.m3u8`) and passes
them directly to the TV's AVPlay engine. Removed `yt-dlp`, Playwright network sniffing, and local
media re-encoding/caching infrastructure entirely to ensure compliance with streaming and platform policies.

2026-09-21 — Removed pairing and QR-code pairing entirely, again, by
request: the room-code restore from the entry below reintroduced the
exact problem it was meant to fix — the resume token that lets a TV
reclaim its room only lives in an in-memory JS variable, so any real app
restart (not just a relay hiccup) mints a fresh code, strands the
companion's remembered one, and the phone can't reconnect until someone
re-scans/re-types a new code off the TV. That's a fundamentally bad fit
for a single-TV home setup with no real access-control need (decision #4
already accepted "anyone on this LAN" as the trust boundary), so this
reverts to the same design as the first "remove pairing" pass: relay
tracks at most one TV (the most recent to register) and any number of
companions, no codes/tokens/resume logic at all; `relay/src/rooms.js` →
back to `clients.js`'s flat `ClientRegistry`; TV idle screen no longer
renders anything pairing-related; companion connects and joins
automatically on load. Supersedes decisions #1/#2 again.

Also found and fixed a real regression while doing this: the room-code
restore commit didn't just re-add pairing, it silently reverted
`tv-receiver/index.html`/`css/style.css`/`js/app.js` to versions that
predate the idle-background-video work (3 commits, ~2026-09-20) — the
pre-rendered digital-rain `<video>` background, its debug
instrumentation, and the `tools/render-idle-background.js` generator
were all gone from the working tree even though `media/idle-background.mp4`
and its poster were still sitting on disk, unreferenced. That work took
several real iterations to get right on the actual TV hardware (canvas
animation too slow → pre-rendered video → wrong H.264 profile → codec
debugging), so losing it silently would have been a real step backward.
Restored it from the last commit before the regression (`1b5ae75`) as
part of this same pass, since it touches the same files. Also deleted
`tv-receiver/js/vendor/qrcode.js` (and confirmed the Tizen `Debug/`
build-mirror project never had its own copy, so nothing to clean up
there) and the now-empty `relay/src/codes.js` dependency — the working
tree had actually been broken (relay would crash on `require('./codes')`,
since that file didn't exist despite `rooms.js` requiring it) going into
this change, which is now moot since `rooms.js` itself is gone.

Verified locally: relay starts cleanly (`node relay/src/index.js`,
`GET /healthz` returns `tvConnected`/`companions` counts, no room
concept in the response). Not yet deployed to the real Ubuntu server or
tested against the real TV/phone — the wire protocol changed again
(register/join no longer carry `code`/`resume`), so an old TV or
companion build in the field won't speak it; redeploy relay first, then
the companion, then rebuild/resideload `tv-receiver` via the Tizen VS
Code extension so it picks up both the no-pairing change and the
restored idle-background video.

2026-09-20 — Deployed `companion/` to the real home Ubuntu server
(`bortein@192.168.2.31`, same host/layout as `relay/`), and closed out
Phase 5 by hosting `companion/` there too, by request. Companion served via
a plain static file server (`companion/serve.js`).

2026-09-20 — Sideloaded `tv-receiver` onto the user's real Samsung TV
(model `UN40N5200`, a 2018 set) and confirmed it live end-to-end — a
first, since every prior AVPlay/hardware-key verification in this
project was emulator-only. Lowered `required_version` in `config.xml` to `4.0`
and generated a Samsung certificate profile (`sex`) bound to the TV's DUID.

2026-09-20 — Added TV-remote hardware-key controls to `tv-receiver`, by
request: Play, Pause, Play/Pause toggle, Stop, Rewind, Fast-Forward on
the physical remote itself, separate from (and in addition to) the
companion app's on-screen transport controls.

2026-09-20 — Phase 4 done. Found and fixed two real bugs while reviewing
against the phase's own checklist (`companion/js/app.js` error formatting
and `tv_offline` state handling).

2026-09-20 — Phase 3 done: companion PWA built in `companion/`.

2026-09-20 — Phase 2 mostly done; confirmed Tizen VS Code extension setup on TV emulator.

2026-09-20 — Phase 1 done: relay implemented in `relay/src/`. Deployed and running as a systemd service (`tv-casting-relay.service`).

2026-09-20 — Phase 0 done: repo structure initialized.