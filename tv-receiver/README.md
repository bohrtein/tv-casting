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
- `matrix/` — the [Matrix](https://github.com/bohrtein/matrix_design)
  design system's tokens (colours, fonts, TV type sizes), flattened to
  literal values in `matrix-tokens.css` because this TV's browser
  (Chromium 56–76) is too old for `matrix.css` itself. Don't edit it;
  update it with
  `python ../matrix_design/tools/sync.py tv-receiver/matrix --tokens-only --device tv`
  so a change to Matrix (a new accent, a theme) reaches the TV too.
- `css/style.css` — fixed 1920x1080, 10-foot-UI layout, styled only from
  those tokens. Keep to what old Chromium supports (custom properties
  yes; `inset`, flex `gap`, `color-mix()`, `clamp()` no).
- `media/idle-background.jpg` — the idle screen's background: a
  **static** still of `companion/matrix/matrix.js`'s digital rain, shown as a
  plain CSS background image. Deliberately not animated. A live canvas
  animation was unusably slow on this TV's CPU, and a pre-rendered
  looping `<video>` never worked on the real TV no matter how it was
  encoded (it showed the first frame, then disappeared). Don't bring
  either back. The generator that recorded the video and this frame
  (`tools/render-idle-background.js`) was removed along with the video;
  it's in git history before this change if the still ever needs
  re-rendering.
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

## Playback controls

The title and three transport buttons appear when playback starts and hide
after four seconds without input, including while paused. On the remote:

- **OK:** reveal the overlay; when it is visible, pause or resume.
- **Left / Right:** skip back or forward 10 seconds and reveal the overlay.
- **Down:** hide the controls and title immediately without changing playback.
- **Back:** dismiss the visible overlay; otherwise retain the app exit action.
- Dedicated media keys still play, pause, stop, and skip as before.

Transport controls are disabled while loading/buffering. Skips are bounded
by the video duration when known; streams that reject seeking keep playing.

Run `node --test tv-receiver/tests/remote-controls.test.js` from the repository
root for the mocked AVPlay/remote tests. These cover the overlay timer,
OK toggle, arrow skips and bounds, paused state after buffering, loading,
click controls, media keys, and stop. Physical-TV validation still requires
rebuilding and installing the receiver through the Tizen extension.

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

## Persistent progress and next episode

`js/playback-history.js` talks directly to the resolver that serves the current
local media URL. It obtains the resume position before playback, saves every five
seconds and on pause/stop, and asks for the next episode only after AVPlay reports
natural completion. Pending replies cannot restart playback after Stop or replace
a newer cast. If the resolver is unavailable, initial playback falls back to zero.
A sudden TV power loss can lose up to the latest five seconds of progress.

Run `node --test resolver/test/*.test.js tv-receiver/tests/*.test.js` from the repo
root. Rebuild and install this receiver along with the resolver/companion update;
existing installed receiver packages do not acquire these changes automatically.
