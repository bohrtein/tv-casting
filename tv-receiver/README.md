# TV receiver (Tizen)

A Tizen TV web app: connects to the relay, plays whatever it's told to
via Samsung's AVPlay API, reports status back. No pairing — the relay
forwards commands from whatever companion is connected. See root
[README.md](../README.md) and [PLAN.md](../PLAN.md) for the wider
picture, and [relay/PROTOCOL.md](../relay/PROTOCOL.md) for the exact
messages this app sends and receives.

## Layout

- `config.xml` — Tizen widget manifest (TV profile, `internet` privilege).
- `index.html` — loads Samsung's `webapis.js` bridge, then the app scripts.
- `css/style.css` — fixed 1920x1080, 10-foot-UI styling (no dependency on
  the Matrix design system used in `companion/` — that system's
  components target phone/desktop breakpoints, not a TV canvas).
- `media/idle-background.mp4` (+ `idle-background-poster.jpg`) — the
  idle screen's digital-rain background, matching the look of
  `companion/matrix.js`'s animation but **pre-rendered to video**, not
  run live: a first attempt ran the real canvas animation on-device and
  it was unusably slow on this TV's own CPU. `app.js` just plays this on
  loop with a plain `<video>` tag, which the TV decodes in hardware like
  any other stream. Encoded conservatively (H.264 Baseline, level 3.1,
  no B-frames, one reference frame, 1280x720) because this TV's plain
  `<video>` element turned out to be much pickier than `webapis.avplay`
  about profile/level — the first encode (High profile, level 5.0)
  played fine in a desktop browser but didn't play at all on the real
  TV. The poster JPEG is a still frame of the same background, shown
  immediately and left in place if the video ever fails to play for any
  reason, so the idle screen is never plain black. See
  `tools/render-idle-background.js` for how both are generated.
- `tools/render-idle-background.js`, `tools/render-harness.html` — the
  generator for `media/idle-background.*`: loads `companion/matrix.js`'s
  animation unmodified in a real headless browser (Playwright), records
  it, and encodes a seamless-looking loop (crossfades the tail into the
  head so `<video loop>` doesn't hard-cut) plus the poster frame. Not
  part of the shipped app — rerun it and re-save the outputs if the
  design changes, or if a device turns out to need even more
  conservative encode settings. Needs `playwright` (already a dependency
  of `resolver/` — no separate install here, just point `NODE_PATH` at
  it: `NODE_PATH=../../resolver/node_modules node render-idle-background.js [seconds]`
  from this folder) and `ffmpeg`/`ffprobe` on `PATH`.
- `js/config.js` — `RELAY_URL`. Edit for your setup.
- `js/relay-client.js` — WebSocket client: registers as `tv`, reconnects
  with exponential backoff on drop.
- `js/player.js` — thin wrapper around `webapis.avplay`: play/pause/
  resume/seek/seekBy/stop.
- `js/app.js` — wires the above together: idle screen ⇄ player screen,
  command handling, status reporting, and TV remote hardware-key
  handling (Return/Back, Play, Pause, Play/Pause toggle, Stop, Rewind,
  Fast-Forward — separate from and in addition to the companion app's
  own on-screen transport controls, for whoever's holding the physical
  remote instead of a phone).

## Tooling note: "Tizen Studio" no longer exists

Classic Tizen Studio was replaced by Samsung with Tizen SDK 10 (Nov
2025) — a VS Code extension (`tizen.vscode-tizen-csharp`, works for Web
apps despite the package name) plus a Visual Studio extension, not a
standalone IDE download anymore. Getting a `tv` profile app installed
also needs a **Samsung Certificate** (DUID-bound to the target
device/emulator, created via the VS Code extension's Actions → Create
Certificate → Create Samsung Certificate, requires a Samsung Account) —
a generic Tizen certificate from the standalone Certificate Manager is
not enough and fails with `Invalid certificate chain with certificate
in signature.:<-3>` on install.

1. Install the VS Code extension, open this `tv-receiver/` folder in
   VS Code.
2. First-time setup: Tizen sidebar → set up the SDK path (auto-installs
   everything else).
3. Create a TV emulator (`tv-samsung-<latest>-x86_64` platform, HD1080
   TV template).
4. Create a Samsung Certificate for that emulator (see above), set it
   active.
5. Edit `js/config.js`: `RELAY_URL` (defaults to the relay deployed in
   Phase 1).
6. Build Project → Run Project with the emulator selected.

## What's actually been verified

Confirmed live, on a real `tv-samsung-10.0-x86_64` emulator (not just a
plain-browser stand-in): idle screen renders and registers with the
relay; a real HLS stream (Apple's public `bipbop_16x9` test asset) was
cast to it and **actually played** — visually confirmed on screen and
via continuous `buffering` → `playing` status broadcasts with
`positionSec` ticking up through the relay; the new hardware-key wiring
(Play/Pause/Stop/Rewind/Fast-Forward) was verified with a mocked
`webapis.avplay`/`tizen.tvinputdevice` standing in for the real device —
every key fired the exact right AVPlay call (pause/resume toggle by
current playback state, `seekTo` computed from `getCurrentTime() ±
10s`, stop → stop+close) — but not yet pressed on the actual running
emulator with a real remote/keyboard, since that needs someone at the
keyboard rather than a scripted test.

**Still not verified:** hardware-key handling on the real running
emulator (mocked-AVPlay test above stands in for it) or a real TV, and
behavior on an actual Samsung TV's display rather than the emulator.
