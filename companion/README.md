# Companion (PWA)

Phone/desktop app: browse Jellyfin, pair with a TV, cast, control
playback, see live status — or skip Jellyfin entirely and cast any
video URL, direct file or a page with a video embedded in it. See root
[README.md](../README.md) and [PLAN.md](../PLAN.md) for the wider
picture, [relay/PROTOCOL.md](../relay/PROTOCOL.md) for the exact relay
messages, and [resolver/README.md](../resolver/README.md) for how an
embed-page URL becomes a castable file.

## Three tabs, one hard gate

Pairing with a TV is the only thing that gates the app screen. Jellyfin
sign-in is **not** a gate — it's an inline prompt inside the Library tab
only, since browsing Jellyfin is the one thing here that actually needs
it:

- **Library** — browse Jellyfin (shows an inline sign-in form first if
  not authenticated yet).
- **Link** — paste a direct video URL and it casts straight to the
  paired TV; paste a page with an embedded video (YouTube, Twitter/X,
  …) and it's resolved to a castable file first, via `resolver/`. No
  Jellyfin involved either way.
- **Remote** — now-playing status and transport controls, for whatever
  got cast from either of the above.

## Layout

- `matrix.css` / `matrix.js` / `fonts/` — the
  [Matrix](https://github.com/bohrtein/matrix_design) design system,
  vendored whole (decision #7 in PLAN.md). `css/app.css` adds the handful
  of things the base component set doesn't cover (screen routing, the
  library row/breadcrumb list), built from the same CSS custom
  properties rather than new colors.
- `js/config.js` — `RELAY_URL`, `RESOLVER_URL`.
- `js/jellyfin-client.js` — auth, library browsing, stream URL
  construction. Talks to Jellyfin directly, never through the relay.
- `js/resolver-client.js` — starts a resolve job for a non-direct link
  and polls it to completion. Talks to the resolver directly, same
  "never through the relay" rule as Jellyfin.
- `js/relay-client.js` — companion-side relay client: join a room,
  reconnect-with-backoff, remember the last paired code (decision #2).
- `js/app.js` — screen router (login → pairing → app) and all the DOM
  wiring for both.
- `serve.js` — plain static file server (no deps), for hosting this
  folder as-is (Phase 5). Always serves `index.html` for `/` and `/pair`
  (the TV's QR target) so client-side routing on `location.search` has
  something to run against; blocks path traversal by resolving every
  request path against the folder root and rejecting anything that
  escapes it.
- `manifest.webmanifest`, `sw.js` — installable PWA shell. The service
  worker caches only the local app-shell files listed in
  `SHELL_FILES`; it explicitly ignores cross-origin requests (Jellyfin)
  so media and library data are never cached, matching the root
  README's hard rule that media never flows through anything but
  Jellyfin → TV directly.

## Pairing: no camera scanner, on purpose

The TV's QR code encodes a full URL (`<companion-host>/?code=XXXXXX`),
not a bare code. Scanning it with the phone's **native** camera app
opens that URL directly — the companion app itself never needs a
camera. `app.js` just checks `location.search` for `?code=` on load and
joins that room immediately.

This isn't a shortcut, it's the correct call for this deployment: an
in-page camera scanner needs `getUserMedia()`, which browsers only allow
in a secure context (`https://` or `localhost`). This app is served
plain `http://` on the home LAN (decision #4 — no VPN, no local TLS
setup), so an in-app scanner would silently fail to even ask for camera
permission. The typed-code field (decision #1's fallback for desktop
companions) covers the case where no camera is involved at all.

## Known limitation: resuming after a reload

Relay `status` messages carry `state`/`title`/`positionSec`, not the
stream URL (see PROTOCOL.md) — status is meant to stay lightweight, and
the companion is the one that already knows the URL it sent. That means
if the companion page reloads while something is paused on the TV, it
has no URL to resume with, since the in-memory `nowCasting` doesn't
survive a reload and the relay doesn't hand it back. `app.js` handles
this gracefully (a toast, not a broken command) but doesn't persist
`nowCasting` across reloads — cast it again from the library instead.
Not worth fixing by changing the protocol for what should be a rare
edge case; noted here in case it's ever worth revisiting.

## Testing without a real Jellyfin server

No Jellyfin instance was reachable anywhere on the LAN from this
environment, so the client code was verified against a throwaway mock
server implementing just `/Users/AuthenticateByName`,
`/Users/{id}/Views`, and `/Users/{id}/Items` with Jellyfin's real
response shapes — not part of this repo. Combined with two scripted "TV"
processes standing in for `tv-receiver` against the real Phase 1 relay,
this exercised the full loop: sign in → pair (typed code **and** the
`?code=` URL path) → browse (multi-level drill-down + breadcrumb) → cast
→ live status → pause/resume/stop → reload persistence (decision #2) →
stale-pairing detection when the paired TV disappears. All of it passed.

**Not verified:** an actual Jellyfin server's real response shapes
(only the documented API contract, via the mock), real AVPlay playback
of a cast stream end-to-end (see `tv-receiver/README.md`'s own gap), and
service worker registration (blocked in the local preview tool used for
testing, not something in `sw.js` itself — worth a quick check once this
is hosted for real).
