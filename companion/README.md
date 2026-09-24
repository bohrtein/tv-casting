# Companion (PWA)

Phone/desktop app: browse Jellyfin, cast, control playback, see live
status — or skip Jellyfin entirely and cast any video URL, direct file
or a page with a video embedded in it. Connects to the relay
automatically, no pairing step. See root [README.md](../README.md) and
[PLAN.md](../PLAN.md) for the wider picture, [relay/PROTOCOL.md](../relay/PROTOCOL.md)
for the exact relay messages, and [resolver/README.md](../resolver/README.md)
for how an embed-page URL becomes a castable file.

## Three tabs

Jellyfin sign-in is not a gate on the app screen — it's an inline prompt
inside the Library tab only, since browsing Jellyfin is the one thing
here that actually needs it:

- **Library** — browse Jellyfin (shows an inline sign-in form first if
  not authenticated yet).
- **Link** — paste a direct video URL and it casts straight to the
  paired TV; paste a page with an embedded video (YouTube, Twitter/X,
  …) and it's resolved to a castable file first, via `resolver/`. No
  Jellyfin involved either way.
- **Remote** — now-playing status and transport controls, for whatever
  got cast from either of the above.

## Stremio page (`stremio.html`)

A separate page (the **stremio** button in the top bar) that works like
the Stremio app's discover/detail screens, but every "play" casts to the
TV instead. It doesn't embed Stremio's own app; it speaks the open
[Stremio addon protocol](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/protocol.md)
directly from the browser, the same way Stremio does:

- **Browse / search**: poster grid from any addon catalog. Cinemeta
  (Stremio's official metadata addon, the default in `js/config.js`)
  gives Popular movies/series plus search.
- **Detail**: title info, season/episode picker for series, then the
  streams every stream addon returns for that title or episode. Tap one
  and it casts.
- **Addons** (sheet): add any addon by its manifest link
  (`https://…/manifest.json` or `stremio://…`), remove them, and set
  the streaming server. The addon list is shared by every device:
  `serve.js` saves it (`GET`/`POST /api/stremio-settings`, stored in
  `.companion-data/stremio-settings.json` at the repo root, or
  `$DATA_DIR`), and each browser keeps a copy for when `serve.js` can't
  be reached. An addon added on the computer shows up on the phone the
  next time the page loads or comes back to the foreground. The first
  time each browser loads this version, any addons it had saved on its
  own are added to the shared list, so nothing added before is lost.
  The streaming server setting is still per browser. Cinemeta has no
  streams, so nothing plays until at least one stream addon is added.

How each kind of stream reaches the TV (mirrors stremio-core's own
conversion in `src/types/resource/stream.rs`):

| addon gives | TV is sent | needs |
|---|---|---|
| `url` (http/https) | that URL as-is | nothing |
| `url` + `behaviorHints.proxyHeaders` | `<server>/proxy/…` | streaming server |
| `infoHash` (+`fileIdx`, `sources`) or a `magnet:` url | `<server>/<infoHash>/<fileIdx or -1>?tr=…` | streaming server |
| `ytId` | an MP4 from `resolver/` | resolver |
| `externalUrl` | not castable, shown disabled | |

"Streaming server" is Stremio's own server (port 11470), run on the home
server next to relay/resolver as the `tv-casting-stremio` unit, and
controlled from App Hub's Developer Tools (see
[`stremio-server/`](../stremio-server/)). It's `STREMIO_SERVER_URL` in
`js/config.js`, overridable on the page. The
TV fetches from it directly; nothing media-related goes through the
relay, same hard rule as Jellyfin.

**Not verified:** real addons and a real streaming server (neither was
reachable from the dev environment; tested against a mock addon that
returns every stream shape, the real relay and a scripted TV), and
AVPlay actually playing what addons return. Per PLAN.md, direct links
sent straight to AVPlay failed on the real TV, while the resolver's
plain-LAN-http MP4s played. Torrent streams from the streaming server
are also plain LAN http, so they're the closest match to what already
works. Codecs inside the file (MKV/HEVC/DTS etc.) still depend on the TV.

## Layout

- `matrix/` — the [Matrix](https://github.com/bohrtein/matrix_design)
  design system. Behind the app hub the page loads Matrix live from
  `/ds/1/` (the one copy every app shares, never cached by `sw.js`), on
  top of this synced copy, which the service worker caches for offline
  use. Don't edit it; update it with
  `python ../matrix_design/tools/sync.py companion/matrix`.
  `css/app.css` adds the handful of things Matrix doesn't cover (screen
  routing, the library row/breadcrumb list), with Matrix tokens only.
- `js/config.js` — `RELAY_URL`, `RESOLVER_URL`, `STREMIO_ADDONS`,
  `STREMIO_SERVER_URL`.
- `js/jellyfin-client.js` — auth, library browsing, stream URL
  construction. Talks to Jellyfin directly, never through the relay.
- `js/resolver-client.js` — starts a resolve job for a non-direct link
  and polls it to completion. Talks to the resolver directly, same
  "never through the relay" rule as Jellyfin.
- `js/relay-client.js` — companion-side relay client: connects and joins
  immediately, reconnect-with-backoff on drop.
- `js/app.js` — all the DOM wiring for the app screen and its tabs.
- `js/stremio-client.js` — Stremio addon protocol client (manifests,
  catalogs, search, meta, streams) and the stream → castable URL
  conversion. Talks to addons directly, never through the relay.
- `js/stremio-app.js` — DOM wiring for `stremio.html`.
- `serve.js` — plain static file server (no deps), for hosting this
  folder as-is (Phase 5), plus the one small `/api/stremio-settings`
  endpoint that holds the shared Stremio addon list. Blocks path traversal by resolving every
  request path against the folder root and rejecting anything that
  escapes it.
- `manifest.webmanifest`, `sw.js` — installable PWA shell. The service
  worker caches only the local app-shell files listed in
  `SHELL_FILES`; it explicitly ignores cross-origin requests (Jellyfin)
  so media and library data are never cached, matching the root
  README's hard rule that media never flows through anything but
  Jellyfin → TV directly.

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
this exercised the full loop: sign in → connect → browse (multi-level
drill-down + breadcrumb) → cast → live status → pause/resume/stop →
reload reconnect. All of it passed.

**Not verified:** an actual Jellyfin server's real response shapes
(only the documented API contract, via the mock), real AVPlay playback
of a cast stream end-to-end (see `tv-receiver/README.md`'s own gap), and
service worker registration (blocked in the local preview tool used for
testing, not something in `sw.js` itself — worth a quick check once this
is hosted for real).
