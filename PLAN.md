# TV Casting App — Implementation Plan

## Architecture recap

Four independent pieces, one repo, four top-level folders:

- **`relay/`** — Node.js + `ws`, runs on the home Ubuntu server alongside the
  app-launcher hub. No pairing — tracks at most one connected TV and any
  number of companions, forwards play/pause/stop/status JSON messages
  between them. Transport only — no media logic, no direct calls to the
  media server.
- **`tv-receiver/`** — Samsung Tizen (HTML/CSS/JS + AVPlay API). Connects to
  the relay on boot, plays whatever stream URL it's sent, reports status
  back.
- **`companion/`** — phone/computer PWA. Talks to Jellyfin directly for
  library browsing and stream URLs, and to the resolver for non-direct
  links, styled with the existing design system, connects to the relay
  only to send play commands and receive status.
- **`resolver/`** — Node.js HTTP service, same host as the relay but its
  own process/port. Wraps `yt-dlp` + `ffmpeg` to turn a page URL with an
  embedded video into a plain MP4 the TV's AVPlay can load. Added after
  Phase 4 (see status log) once "cast a link" ran into pages AVPlay can't
  parse itself.

Hard rules (from project conventions, keep enforcing these in review):
- Relay never touches media files or calls Jellyfin directly.
- Companion never streams through the relay — media flows Jellyfin/resolver
  → TV directly; only control/status JSON goes through the relay.
- Resolver is its own process, not folded into the relay — keeps "the
  relay never touches media" true at the process boundary.

## Decisions (locked in)

1. ~~**Room code** — TV generates a short code and renders it as a QR code
   (primary path for phone companions) with the plain code printed
   underneath (fallback for desktop companions, which can't scan their
   own screen). One relay pairing mechanism, two entry paths.~~
   **Superseded (see status log)** — pairing/QR removed entirely for
   easier iteration on the TV app. The relay now tracks at most one TV
   and any number of companions with no gating at all.
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
- Playback: AVPlay integration — receive a stream URL + play command,
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
- Relay client: pair by scanning the TV's QR (camera, mobile) or typing
  the plain code underneath it (desktop, decision #1); remember the last
  paired room and auto-reconnect on next launch (decision #2); send
  `play` with the Jellyfin stream URL + metadata, send pause/stop, receive
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
  to begin with... it goes Jellyfin → TV directly).

**Deliverable:** companion running on a phone and desktop browser, full
loop: browse Jellyfin → pair with TV → cast → control → see live status.

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

2026-09-20 — Replaced the live-canvas idle background (previous entry
below) with a pre-rendered video, after the user tested the canvas
version on the real TV and reported it "not rendering at all" with a
terrible frame rate. Root causes: (1) the canvas/vignette/scanline CSS
used the `inset: 0` shorthand, which is a relatively recent addition
(Chromium ~87, 2020) that this TV's much older WebKit almost certainly
doesn't parse, likely collapsing those elements to zero size; (2) even
fixed, live canvas rendering (per-glyph `shadowBlur`, a full quarter-res
bloom pass + CSS blur filter, 25fps across a 1920x1080 grid) was simply
too expensive for this 2018 TV's CPU — the entire approach of computing
the effect on-device was the wrong call for this hardware, not just a
tunable performance bug. Deleted `js/background.js` entirely. New
`tools/render-idle-background.js` + `tools/render-harness.html` load
`companion/matrix.js`'s real animation, unmodified, in a headless
Playwright/Chromium browser on a real computer, record it, and encode
`media/idle-background.mp4` (H.264, ~5.8MB for an 18s loop) with a
crossfade between the tail and head so `<video loop>` doesn't hard-cut.
`index.html` now just has `<video id="idle-bg-video" ... autoplay loop
muted>`; `app.js` calls `.play()`/`.pause()` on it in
`showIdleScreen()`/`showPlayerScreen()` instead of starting/stopping a
JS loop. This offloads the actual decoding to the TV's hardware video
pipeline, the same one that plays every cast stream, instead of
software canvas scripting. Also switched the vignette/scanline overlay
CSS to explicit longhand `top/right/bottom/left` instead of `inset`, for
the same old-WebKit reason. Caught a real bug while building the
renderer: the first version's recording included the ~3s the rain takes
to fill in from its scattered initial state at the *front* of the kept
clip (never trimmed), so frame 0 was nearly solid black — fixed by
trimming that lead-in with `-ss` before encoding, verified by extracting
frame 0 as a PNG and confirming it's fully populated. Verified in the
browser preview via direct video-element inspection (`paused`,
`currentTime` advancing, `videoWidth`/`videoHeight`, no `.error`) rather
than screenshots, since the preview pane's screenshot tool had already
proven unreliable for this app's oversized fixed 1920x1080 layout in the
previous entry. Not yet verified on the actual Tizen emulator or TV —
that's the real test this was tuned for and the browser preview can't
fully stand in for it.

2026-09-20 — Ported the Matrix design system's idle-screen background
(digital rain + bloom + vignette/scanlines) into `tv-receiver`, by
request, so the idle screen (shown on boot and whenever nothing is
playing) matches `companion`'s look. New `tv-receiver/js/background.js`
is a trimmed copy of `companion/matrix.js`'s `Background()` — same
algorithm, but hardcoded to this app's fixed 1920x1080 canvas instead of
the phone/desktop version's resize/devicePixelRatio handling, since a TV
viewport never changes at runtime. `index.html`/`css/style.css` add the
two canvases + vignette/scanline layers inside `#idle-screen` only
(companion's `--mx-` color tokens weren't reused — `--green`/`--ink-hot`
etc. in `css/style.css` already carry the identical values). `app.js`
starts the animation in `showIdleScreen()` and stops it in
`showPlayerScreen()`, so it only runs when there's something to show and
doesn't burn CPU on the 2018 TV's weaker hardware during actual
playback. Added a `tv-receiver` entry to `.claude/launch.json` (plain
`python -m http.server`) to preview this in a browser standing in for
the TV. Verified the canvas actually paints across the full 1920x1080
area via direct pixel sampling (an 8x6 grid of `getImageData` reads, hit
in every region) after the preview pane's own screenshot tool turned out
to render an oversized emulated viewport unreliably (screenshots showed
rain confined to a small top-left box that didn't move over time, while
pixel sampling proved content was correct everywhere) — a preview-tool
quirk, not a bug in the page. Not verified on the actual Tizen emulator
or real TV.

2026-09-20 — Removed pairing and QR-code pairing entirely, by request,
to make TV-app iteration easier (no re-pairing after every reload while
developing). Supersedes decisions #1 and #2 above. Changes:
- `relay/`: `rooms.js` → `clients.js`, replacing the room registry
  (code → {tv, companions}) with a flat `ClientRegistry` (at most one TV
  socket, a set of companion sockets, no codes/tokens at all).
  `codes.js` deleted. `register`/`join` no longer take or return a code;
  a second TV registering just replaces the first. `PROTOCOL.md`
  rewritten to match.
- `tv-receiver/`: idle screen no longer renders a QR or room code —
  `js/vendor/qrcode.js` deleted, `js/app.js`/`relay-client.js` simplified
  to register with no resume/code handling, idle screen just shows a
  "waiting for a companion…" note. `COMPANION_BASE_URL` dropped from
  `js/config.js` (nothing points at it anymore).
- `companion/`: no more pairing screen — `js/app.js` shows the app
  screen unconditionally instead of gating on `relay.isPaired()`;
  `js/relay-client.js` joins immediately on connect instead of waiting
  for a code; dropped the `?code=` URL handling, the typed-code field,
  and the "forget this tv" button along with `pairing.lastCode` local
  storage.
Not deployed to the real Ubuntu server or tested against the real TV —
this was a local code change only; the next real-hardware test will also
need the relay redeployed since the wire protocol changed (old TV/
companion builds won't speak it). The user is planning further updates
to `tv-receiver` on top of this.

2026-09-20 — Deployed the tier-3 fallback (see entry below) to the real
Ubuntu server, with a denylist added first by request after the live
systemd journal showed a real `/resolve` request had already been made
against `https://playmate.to/embed/...` (adult-content embed
aggregator, unrelated to any test in this project) which failed only
because yt-dlp has no extractor for it — precisely the gap tier 3
closes. Declined the user's first ask ("deploy as-is, no site
restrictions") since that would make the fallback succeed on exactly
that request next time, the same category of "bypass obfuscation on an
embed site" this project has declined twice before. Added
`resolver/src/denylist.js` instead: a manually maintained, subdomain-
aware hostname denylist (seeded with `playmate.to` plus ~15 widely
known unauthorized movie/TV-embed hosts — doodstream, streamtape,
vidsrc, filemoon, etc.), checked before `genericExtract.js` ever
launches a browser; a denylisted url falls straight through to yt-dlp's
original error, same as if tier 3 didn't exist. Extensible without a
code change via `RESOLVER_DENYLIST_EXTRA` (comma-separated hostnames)
in `.env`. Deployed via the existing `bortein_temp` SSH key (already
present in this environment, reused rather than re-provisioned):
copied the four changed/new `src/` files + `package.json` +
`README.md`, ran `npm install` and `npx playwright install chromium`
directly on the server, restarted `tv-casting-resolver` via
`systemctl --user restart`. Verified live, not just deployed: the
denylist correctly blocked a re-request of the exact `playmate.to` url
from the journal (no browser launched, same plain "Unsupported URL"
error as before); a throwaway JS-rendered test page (same one used for
local verification) confirmed the fallback tier still engages
correctly end-to-end post-deploy (tier 1 fails → Chromium launches →
finds the stream request → retried through yt-dlp); headless Chromium
launches cleanly on this host with no missing system libraries and no
`sudo`/`playwright install-deps` needed. `/healthz` and
`systemctl --user is-active` both confirm the service is healthy
post-restart. Left the two pre-existing `.mp4` files already in
`media/` untouched (real prior usage, not test artifacts).

2026-09-20 — Added a third extraction tier to `resolver/`, by request
("make yt-dlp work on every site"): the resolver already got yt-dlp's
full native extractor coverage (~1800 sites) plus yt-dlp's own generic
extractor (parses raw HTML for a `<video>` tag or direct manifest link)
for free, since `runJob` just calls `yt-dlp` on whatever url it's given
— that part needed no new code. The actual gap is pages where the
player builds its video url client-side via JS, which is structurally
invisible to yt-dlp's generic extractor since it only reads the static
HTML response. Added `resolver/src/genericExtract.js`: only reached
when both existing tiers fail, it renders the page in real headless
Chromium via Playwright — same as any visitor's browser, JS executes
normally, no fingerprint spoofing/captcha-solving/anti-bot evasion added
— and reads back whatever HLS/DASH manifest request or `<video src>`
that render actually produces, plus the page's referer/user-agent so
yt-dlp can then download the discovered url the normal way (some sites
403 a manifest fetched without the referer of the page that requested
it). `ytdlp.js`'s `getInfo`/`download` gained optional `referer`/
`userAgent` args (passed as `--referer`/`--user-agent` to yt-dlp,
appended to the existing no-`shell:true` argv array — no new injection
surface) for exactly this retry path. Lazily `require()`d so a resolver
deployment that hasn't run `npx playwright install chromium` only loses
this one fallback tier (falls straight through to the original yt-dlp
error) rather than crashing the whole service; `ENABLE_GENERIC_FALLBACK=0`
disables it outright. Explicitly declined (same line this project has
held since the original resolver work and the earlier "cast a link"
UI): no anti-bot bypass, no login/paywall circumvention, no DRM —
tier 3 finds only what a site already hands to an ordinary browser
visit. Verified locally: `npm install` + `npx playwright install
chromium` succeeded, and a throwaway local test page (JS-injected
`<video src>` after a delay, standing in for a client-side-rendered
player) confirmed `genericExtract.extract()` correctly captures the
resulting manifest request. Not verified against yt-dlp itself end-to-
end (`yt-dlp` isn't installed in this dev sandbox, same gap noted
during the original resolver work) or redeployed to the real Ubuntu
server — `ytdlp.js`'s header-arg changes are small and mechanical
(syntax-checked, same spawn-argv pattern as the existing code) but
worth a real re-verification pass before/at the next deploy. No change
needed on the companion side — `resolver-client.js` already only cares
about `{status, progress, title, streamUrl}` from `GET /resolve/:id`,
so it's connected to the "cast a link" tab exactly as before.

2026-09-20 — Added `resolver/`, by request: the "cast a link" tab
(Link, added earlier — see the entry below) only ever worked for a
direct media URL, but a link to a page with a video *embedded* in it
(a YouTube watch page, a tweet, …) would just hand AVPlay a webpage,
which it has no way to parse. `resolver/` is a new Node.js HTTP service
wrapping `yt-dlp` + `ffmpeg`: `POST /resolve {url}` kicks off metadata
lookup + download in the background (a real download can take seconds
to minutes, so this doesn't block), `GET /resolve/:id` polls job state,
and once `status: "ready"` it includes a `streamUrl` serving the
downloaded MP4 with Range support (AVPlay needs that to seek). Kept as
its own process/port rather than folded into the relay, so "the relay
never touches media" (root README.md hard rule) stays true at the
process level. `companion/js/resolver-client.js` wires it in: the Link
tab now checks if the pasted URL already looks like a direct file
(`.mp4`/`.m3u8`/…) and casts it straight through as before if so,
otherwise calls the resolver and shows live download progress
("downloading… 42%") before casting the resolved file.

Verified end-to-end locally against a real public Creative-Commons test
video (Big Buck Bunny on YouTube, chosen specifically so testing
doesn't touch anything copyright-questionable): `yt-dlp` installed via
`pip install yt-dlp` (not present in this dev environment beforehand;
`ffmpeg` already was), resolver started standalone, `POST /resolve`
against the YouTube url, polled through `starting` → `downloading`
(with real progress percentages) → `ready`, downloaded file confirmed
via `ffprobe` (valid MP4, correct duration), and `Range: bytes=0-999`
returned a correct `206 Partial Content` response. Also caught and
fixed a real bug during this test: the first format selector
(`bestvideo+bestaudio`, no codec preference) picked AV1 video by
default on modern YouTube, which is unreliable-to-unsupported on older
Samsung Tizen TVs — this project's actual AVPlay testing (see the
entries below) was all against H.264. Changed the format selector to
prefer `avc1`/`mp4a` (H.264/AAC) explicitly, falling back to whatever's
available otherwise, and re-verified the same test video now downloads
as H.264/AAC. Confirmed the path-traversal-shaped request
`/media/..%2f..%2findex.js` and a nonexistent job/file both correctly
404 (the media route only matches a 16-hex-char id + `.mp4`, so
traversal attempts never match the route at all). Not yet deployed to
the real Ubuntu server (needs `yt-dlp` + `ffmpeg` installed there and a
systemd unit enabled — `resolver/systemd/tv-casting-resolver.service`
is written, mirroring `relay`'s, but not installed), and not yet tested
against a real Samsung TV (same AVPlay-on-real-hardware gap the rest of
this project has — see `tv-receiver/README.md`). Also not attempted:
sites requiring a logged-in session (would need cookie passthrough,
out of scope for this pass) or DRM-protected services (Netflix,
Disney+, etc. — `yt-dlp` deliberately doesn't support these; not a gap
to close). Declined, on request, to test the resolver against a
specific pasted URL that matched the pattern of a piracy/adult-content
embed host rather than a mainstream platform — same call as the
earlier "cast a link" entry below, which declined a piracy-site UI
reference for the same reason; the resolver itself doesn't discriminate
by domain, that's a per-use decision, not something to bake into or
pre-validate in the tool itself.

2026-09-20 — Deployed `resolver/` to the real home Ubuntu server
(`bortein@192.168.2.31`, same host/layout as `relay/`), and closed out
Phase 5 by hosting `companion/` there too, by request ("push it to
Ubuntu... let me install this on my TV" — pairing needs somewhere real
for the TV's QR code to point at). `yt-dlp` installed via `pipx`
(plain `pip install` is blocked by Debian/Ubuntu's PEP 668
externally-managed-environment guard; `pipx` was already present and
is the cleaner isolated-venv route anyway) to
`/home/bortein/.local/bin/yt-dlp`, referenced by the resolver's `.env`
via `YTDLP_BIN` since systemd services don't get a login shell's PATH.
Both `resolver` and a new `companion/serve.js` (plain static file
server, no deps — always serves `index.html` for `/` and `/pair` so
the TV's QR-code path works, blocks path traversal by resolving every
request against the folder root) run as **systemd `--user` units**
(`tv-casting-resolver`, `tv-casting-companion`), not system units like
`relay`'s — this session had SSH access via an existing key but no
passwordless sudo, and password-based sudo was correctly out of reach
(credential-handling rules: never accept or type a password on the
user's behalf, even given explicit permission). User units need no
root to create/enable/start and did so successfully; the one gap is
`loginctl enable-linger bortein`, which needs root and makes user
units survive full logout/reboot the way system units do automatically
— **the user needs to run that one command themselves** for these two
services to survive a server reboot. Everything else about the
deployment is done.

Hit real flakiness during verification: the first two live `/resolve`
calls against the deployed resolver both failed with `HTTP Error 403:
Forbidden` partway through download, while manually re-running the
exact same yt-dlp command over SSH immediately after each failure
succeeded both times, including a full 1080p H.264 download. Wrote a
standalone script replicating the resolver's exact `getInfo()` →
`download()` sequence to rule out an env/spawn-argument difference
between the systemd-run process and an interactive shell — it
succeeded, confirming this was YouTube-CDN-side flakiness (signed
googlevideo URLs occasionally blip under repeated close-together
requests for the same video id from one IP), not a bug in the
resolver. A real bug *did* surface from this testing, though: failed
downloads left yt-dlp's partial fragment files (`<jobId>.f299.mp4.part`,
tens/hundreds of MB) sitting in `MEDIA_DIR` indefinitely — only the
multi-hour TTL sweep would ever have caught them. Fixed in
`resolver/src/ytdlp.js`: `download()` now deletes any file starting
with the job's output prefix as soon as the yt-dlp process exits
non-zero. Redeployed the fix and confirmed the live service passes a
full resolve → download → serve → Range-request round trip cleanly.

Companion hosting verified live: `/` and `/pair?code=...` both serve
`index.html`, static assets (`matrix.css`, `manifest.webmanifest`,
`js/config.js`) serve with correct content types, and path traversal
(`--path-as-is` with both literal `../` and `%2e%2e` encoded segments)
correctly 404s rather than escaping the companion folder.
`tv-receiver/js/config.js`'s `COMPANION_BASE_URL`
(`http://192.168.2.31:8080/pair`) already matched this deployment
exactly — it had been set as a forward-looking placeholder in an
earlier phase and needed no change.

Not done here (needs the user, at their TV, with the physical
hardware): sideloading `tv-receiver` onto the real Samsung TV via the
Tizen VS Code extension's device connection, and `loginctl
enable-linger` on the server for full reboot persistence.

2026-09-20 — Sideloaded `tv-receiver` onto the user's real Samsung TV
(model `UN40N5200`, a 2018 set) and confirmed it live end-to-end — a
first, since every prior AVPlay/hardware-key verification in this
project was emulator-only. Connected via `sdb` (the Tizen SDK/VS Code
extension tooling was already installed on the dev machine from the
earlier emulator work) once the user enabled Developer Mode and shared
the TV's LAN IP. Two real, unrelated bugs surfaced and got fixed along
the way:

1. **Wrong Tizen API version.** `config.xml` declared
   `required_version="6.0"` (decision #8: "build against the latest
   Tizen TV API profile" — correct for the emulator, which ran the
   newest platform image). `sdb capability` against the real TV showed
   `platform_version:4.0` — a 2018 TV runs Tizen 4.0, not 6.0. First
   install attempt failed with a parsing-error code (`118019`).
   Lowered `required_version` to `4.0` (checked `player.js`/`app.js`
   first for any ES2020+ syntax like optional chaining that Tizen 4.0's
   older engine wouldn't run — none found, `const`/`let`/arrow
   functions are fine), rebuilt with `tz build`/`tz pack`, and the
   parsing error went away.
2. **Certificate chain error (`118012`).** The existing Samsung
   Certificate (`iphonecolddih`) was created earlier against the
   emulator and is DUID-locked (Samsung's free/Public-tier distributor
   certs are registered to specific device IDs, confirmed by reading
   `device-profile.xml`'s `<TestDeviceInfo>`). Walked the user through
   Certificate Manager's GUI (no CLI/API path exists for the
   Samsung-Account-authenticated device-registration step, and this
   session has no desktop/GUI automation tool — only a browser one —
   so this genuinely needed the user's own hands) to create a new
   profile (`sex`) bound to the real TV. The extension's own log
   (`AppData/Roaming/Code/logs/.../Tizen Log.log`) confirmed the DUID
   query (`0 getduid` over the secure sdb protocol) correctly returned
   the TV's real DUID (`MTCGVGAGOHW44`) and the new certificate was
   issued for exactly that DUID — yet install kept failing with the
   identical chain error for several more attempts, ruling out the
   device-registration theory outright. Chased two more leads before
   it started working: found a near-identical, still-unresolved
   Samsung/Tizen.Issues GitHub report filed just 3 days prior
   (suggesting a possibly live issue in the current cert-issuance
   pipeline) and checked for TV clock skew (a classic cause of
   "invalid chain" on embedded devices) via the TV's own Settings menu
   (the TV's `sdb shell` turned out to be locked to a small whitelisted
   command set on production hardware — unlike the emulator's open
   shell — so this couldn't be checked remotely); clock was correct,
   and `openssl x509 -dates` on the freshly issued cert showed a
   normal, already-valid window, ruling that out too. No single
   isolated fix was confirmed for this second error — a later install
   attempt with the same `sex`-signed package succeeded. Possibly
   Samsung-server-side propagation delay for a freshly issued cert;
   left as an open question rather than a confirmed root cause.

Verified live via the relay's own systemd journal: the real TV
registered (`tv registered 3CCK3N`) and a real companion session
joined and paired with it (`companion joined 3CCK3N`) — the first
fully real (no mocks, no emulator, no scripted stand-ins) device on
either end of this system.

2026-09-20 — Found and fixed a real bug once the user actually tried
"cast a link" against the deployed resolver from the real companion
app in a real browser: it silently did nothing. Resolver's own journal
showed zero new `/resolve` requests since the last test, meaning the
failure was client-side, before the request ever left the browser —
and every one of *my* earlier verifications of the resolver used
`curl`, which doesn't enforce CORS at all, so this never surfaced.
Root cause: `companion` (served from `:8080`) and `resolver` (`:8788`)
are different origins, and `resolver/src/index.js` sent no
`Access-Control-Allow-Origin` header, so the browser blocked the
`fetch()` in `resolver-client.js` before `app.js` ever saw a response.
Fixed by adding CORS headers (`Access-Control-Allow-Origin: *` — fine
here, no auth/cookies in play, LAN-only) plus an `OPTIONS` preflight
handler to every response in `resolver/src/index.js`; deployed and
confirmed via a real preflight request (`OPTIONS /resolve` with an
`Origin` header) returning `204` with the right headers. Relay's own
WebSocket endpoint was never affected (already confirmed working from
the real companion pre-fix) since `ws` doesn't enforce CORS the same
way plain `fetch()` does.

2026-09-20 — Added TV-remote hardware-key controls to `tv-receiver`, by
request: Play, Pause, Play/Pause toggle, Stop, Rewind, Fast-Forward on
the physical remote itself, separate from (and in addition to) the
companion app's on-screen transport controls. `player.js` gained
`resume()` (local un-pause, no url needed — distinct from the existing
url-based `play()` a companion resume uses) and `seekBy(deltaSec)`
(relative seek off `webapis.avplay.getCurrentTime()`). `app.js` now
registers `MediaPlayPause`/`MediaPlay`/`MediaPause`/`MediaStop`/
`MediaRewind`/`MediaFastForward` alongside the existing `Return` key and
routes their keydown codes to the right player method, toggling
play/pause based on the last known playback state. Cross-checked every
key code (`PLAYPAUSE: 10252`, `PLAY: 415`, `PAUSE: 19`, `STOP: 413`,
`RW: 412`, `FF: 417`) against Samsung's own official `TVDemoAvPlayer`
sample app on GitHub rather than trusting memory — all matched exactly.
Verified the wiring logic with a scripted mock of `webapis.avplay` and
`tizen.tvinputdevice` standing in for the real device (a throwaway test
HTML file, deleted after): every key fired the correct AVPlay call,
including the rewind/fast-forward math. **Not yet pressed on the actual
running emulator** with a real keyboard/remote — that needs someone at
the keyboard rather than a scripted test.

2026-09-20 — Companion scope grew beyond the original plan, by request:
added a "cast a link" tab that sends any direct video URL straight to
the paired TV, bypassing Jellyfin entirely (the relay protocol already
took an arbitrary `url` in a `play` command, so this needed no protocol
change — just a companion UI for it). This also prompted a routing
fix: Jellyfin sign-in used to gate the whole app screen, which made no
sense once casting a raw link needs no Jellyfin account at all. Now
**pairing is the only hard gate**; sign-in moved to an inline prompt
inside the Library tab specifically. Verified end-to-end against the
live relay: paired with zero Jellyfin session in local storage, landed
on the Library tab's inline sign-in prompt (not a full-screen block),
switched to the new Link tab, empty-submit validation fired correctly,
and a pasted public HLS test URL was cast and received by a stand-in TV
with the exact URL and custom title intact, then showed live status on
the Remote tab. (Note: the user's ask referenced a piracy-style
streaming site by name for UI inspiration — declined that part
explicitly; this feature only ever sends a user-supplied URL to their
own TV, same as pasting a link into any generic "cast to device" tool.)

2026-09-20 — Phase 4 done. Found and fixed two real bugs while reviewing
against the phase's own checklist:
- `companion/js/app.js`: an AVPlay error with a title present rendered
  as `"<title> — error"`, never showing the actual reason (the
  human-readable message was computed but then discarded by a backwards
  conditional). Now shows `"<title>: <message>"`.
- `companion/js/relay-client.js` + `app.js`: a live `tv_offline`
  broadcast (TV disconnects while a companion is already on the app
  screen) updated nothing — the relay chip still said "paired", the
  readout showed the raw string `"tv_offline"`, and nothing routed back
  to the pairing screen until a manual reload forced a rejoin attempt.
  Now `tv_offline` clears the remembered pairing, flips the chip to
  "tv offline", toasts, and routes back to the pairing screen
  immediately — verified live (killed a stand-in TV process mid-session,
  companion updated without a reload).
Also added: `relay-client.js` (companion) now reconnects immediately on
`visibilitychange` back to visible, instead of waiting out a stale
backoff timer that mobile browsers throttle while backgrounded (not
device-tested, but a standard, well-understood fix for exactly this
class of bug). `relay/src/index.js` caps `maxPayload` at 16KB (every
real PROTOCOL.md message is a few hundred bytes; no reason to let a
misbehaving LAN client make the relay buffer more).

Tested against the checklist: wrong/expired code and TV-offline pairing
(already covered in Phase 1/3 testing) confirmed again live; **mid-
playback relay restart** — TV reconnects and gets a new code, companion
correctly detects `TV_NOT_FOUND` on its stale rejoin and now surfaces
that properly instead of silently failing; **multiple companions to one
TV** (decision #5) — two companion connections in the same room both
received the status broadcast from a command sent by only one of them,
confirmed via a scripted test against the live relay.

Security pass (relay exposure, decision #4): room codes are 6 chars from
a 31-char alphabet (~887M combinations), issued fresh per TV connection
and dead the moment that TV disconnects, with no persistent secret to
leak. There's no rate-limiting on `join` attempts, which would matter on
a hostile network — but decision #4 already scopes this to a trusted
home LAN with no remote/VPN exposure, so the accepted risk is a
malicious device already on that LAN, which room-code auth was never
meant to defend against. Conclusion: adequate for the stated exposure;
no new auth mechanism added. The `maxPayload` cap above is the one
concrete hardening change from this pass.

Remaining before Phase 5: no real Jellyfin server has been tested
against (only a mock matching the documented API shape), real-TV display
and hardware remote-key handling are still emulator-only, and the
companion PWA isn't hosted anywhere yet.

2026-09-20 — AVPlay playback gap closed: sent a real HLS stream (Apple's
public `bipbop_16x9` test asset) to the running TV emulator via a
scripted companion stand-in, joining its live room code. Confirmed
visually (test pattern actually decoding and playing on screen, title
overlay showing "playing") and via the relay (`buffering` → `playing`
status messages with `positionSec` ticking up continuously for the full
test). This was the last unverified piece from Phase 2/3 — real AVPlay
video playback, driven by a real command through the real relay, on the
real Tizen emulator, now confirmed working end-to-end. Minor curiosity,
not a bug: one burst of ~11 duplicate `positionSec:65` status messages
arrived within 2ms around the 65s mark before position ticked on
normally — looked like a platform-side event-timing quirk in AVPlay's
`oncurrentplaytime` callback, not a bug in `player.js`/`relay-client.js`
(no loop or retry logic there that could produce it). Not worth chasing
further unless it recurs. Remaining gaps before Phase 4 can really
close things out: no real Jellyfin server has been tested against
(companion verified only against a mock matching the documented API
shape), hardware remote-key handling and real-TV display are still
emulator-only, and the companion PWA isn't hosted anywhere yet.

2026-09-20 — Phase 3 done: companion PWA built in `companion/`
(`js/jellyfin-client.js`, `js/relay-client.js`, `js/app.js`, Matrix
design system UI in `index.html`/`css/app.css`, PWA shell via
`manifest.webmanifest`/`sw.js`). Decided against an in-app camera QR
scanner (see `companion/README.md`) — the TV's QR encodes a full URL, so
the phone's native camera app opens the companion pre-paired via
`?code=`; an in-page scanner would need `getUserMedia()`, which requires
a secure context the plain-`http://` LAN deployment doesn't have.
Verified end-to-end against the real Phase 1 relay plus two scripted
"TV" stand-ins and a throwaway mock Jellyfin server (no real Jellyfin
instance was reachable anywhere on the LAN from this environment): sign
in → pair by typed code and by `?code=` URL → multi-level library
drill-down with breadcrumb → cast → live status → pause/resume/stop →
reload persistence (decision #2) → stale-pairing detection when the
paired TV disappears. All passed. Not verified: real Jellyfin server
behavior beyond its documented API contract, actual AVPlay playback of a
cast stream (same gap as Phase 2), and service worker registration
(blocked by the local preview tool, not `sw.js` itself). Companion isn't
hosted anywhere yet — that's Phase 5; `tv-receiver/js/config.js`'s
`COMPANION_BASE_URL` is still a placeholder until then. Next action:
Phase 4 (integration & hardening) — or close the Phase 2/3 AVPlay
playback gap first, since Phase 4's end-to-end pass assumes real
playback works.

2026-09-20 — Phase 2 gap mostly closed: got the Tizen VS Code extension
(replaces classic Tizen Studio, deprecated — see "Tizen target" note
below) working end-to-end on a `tv-samsung-10.0-x86_64` TV emulator.
Notable snags, for next time: (1) "Tizen Studio" no longer exists as a
download — Samsung SDK 10 (Nov 2025) replaced it with the
`tizen.vscode-tizen-csharp` VS Code extension (works for Web despite the
package name) and a Visual Studio extension; (2) a generic Tizen
certificate profile (via the standalone Certificate Manager) is **not**
enough for a `tv` profile target — installs fail with `Invalid
certificate chain with certificate in signature.:<-3>` until you create
a **Samsung Certificate** instead (VS Code sidebar: Actions → Create
Certificate → Create Samsung Certificate, DUID-bound to the running
emulator, requires a Samsung Account); (3) the Samsung Account login
step for that 403s intermittently — known, longstanding bug on Samsung's
side per public forum reports, not fixable here, just retry. Confirmed
on the real emulator: idle screen renders, QR + code display correctly,
relay connection and registration work. **Still not verified: actual
AVPlay video playback** (offered to test with a real stream, deferred by
user in favor of starting Phase 3 — pick this up before Phase 4's
hardening pass). Also still open: hardware remote-key handling on a real
TV (only the emulator has been tried).

2026-09-20 — Phase 2 mostly done, with a real gap: the TV receiver app
is fully written in `tv-receiver/` (idle screen with QR + plain code,
`relay-client.js` with reconnect-with-backoff, `player.js` wrapping
`webapis.avplay`, `app.js` wiring it together, TV remote Return-key
handling) and vendors `js/vendor/qrcode.js` (kazuhikoarase/qrcode-generator,
MIT). Logic was verified by serving the folder over plain HTTP and
driving it with a script playing the companion's role directly against
the live Phase 1 relay: idle screen connects and registers, QR renders
correctly, a simulated companion join+play switches it to the player
screen, and — since a desktop browser has no `webapis.avplay` — the
`AVPLAY_UNAVAILABLE` error path fires correctly and it returns to idle.
**Not verified: actual AVPlay playback, hardware remote-key handling, or
real-TV display**, because Tizen Studio isn't installed anywhere in this
environment (checked; not present). See `tv-receiver/README.md` "Known
gap" for exactly what's untested and the steps to pick it up in Tizen
Studio once available. `COMPANION_BASE_URL` in `js/config.js` is a
placeholder (no companion host yet — Phase 3/5). Next action: either get
Tizen Studio available somewhere to close that gap, or move on to Phase
3 (companion PWA) and come back to finish Phase 2 hardware verification
before Phase 4.

2026-09-20 — Phase 1 done: relay implemented in `relay/src/` (in-memory
room registry, register/join, command forwarding, status broadcast,
malformed-JSON rejection, heartbeat-based dead-connection detection,
TV-disconnect → `tv_offline` broadcast + room teardown, `GET /healthz`).
Deployed and running as a systemd service (`tv-casting-relay.service`,
enabled) on the home Ubuntu server (`bortein@192.168.2.31`,
`~/Desktop/github/tv-casting/relay`, Node v24.21.0 via nvm — no dedicated
system user, matches the real `apphub.service` convention found on that
host rather than the `/opt` + dedicated-user layout originally assumed).
`ufw` is inactive on that host, so no firewall rule was needed. Verified
end-to-end (pair → play → status, plus error paths: bad code, malformed
JSON, TV disconnect) against the live deployed service over the LAN.
Next action: start Phase 2 (Tizen TV receiver).

2026-09-20 — Phase 0 done: `relay/`, `tv-receiver/`, `companion/` folders
created; root `README.md` and `.gitignore` written; `relay/PROTOCOL.md`
written (room-code format, register/join, play/pause/stop/seek commands,
status broadcast, disconnect handling, error codes); `matrix.css`,
`matrix.js`, and `fonts/` pulled into `companion/` from
[matrix_design](https://github.com/bohrtein/matrix_design). Root
`package.json` deferred until Phase 1 tooling is chosen. Not yet a git
repo — no commit made. Next action: start Phase 1 (relay server
implementation).

2026-09-20 — Plan drafted, all open product decisions resolved (see
"Decisions (locked in)" above). No code written yet.

_(Update this section as phases complete — add a short log line per
phase, e.g. "Phase 0 done 2026-09-22", so status stays visible without
digging through commit history.)_
