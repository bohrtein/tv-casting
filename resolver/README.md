# Resolver

Turns a page URL with an *embedded* video — a YouTube watch page, a
Twitter/X post, a Reddit thread, anything [yt-dlp](https://github.com/yt-dlp/yt-dlp)
knows how to read — into a plain MP4 file that the TV receiver's AVPlay
can actually cast. AVPlay only knows how to play a direct media URL
(a file or an HLS/DASH manifest); it can't load a webpage and find the
`<video>` tag itself, which is what this fills in.

Talks directly to nothing else in this repo except the companion, which
calls it over plain HTTP before sending a `play` command through the
relay (same "talks to an external service directly" pattern the
companion already uses for Jellyfin — see root [README.md](../README.md)
hard rules; the relay itself never touches media, this is a separate
piece for exactly that reason).

## Why it downloads instead of just resolving a direct URL

Sites like YouTube haven't served a single combined audio+video URL in
years — everything is separate adaptive video-only and audio-only
streams that need muxing. Even on sites that *do* expose a direct URL,
it often needs specific headers (`Referer`, cookies, signed tokens) to
actually load, which AVPlay has no way to send. So instead of a fast
path that works on some sites and mysteriously 403s on others, this
always does the same thing: yt-dlp downloads (and ffmpeg muxes, if
needed) to a local MP4, and the resolver serves that file directly.
Slower, but it means "cast this link" behaves the same way everywhere.

Downloaded files are treated as transient — swept off disk after
`MEDIA_TTL_MS` (default 6h) — **except** the last `RESOLVER_CACHE_SIZE`
(default 5) distinct source urls, which the LRU cache below keeps
around regardless of age.

## Rewatch cache

`src/cache.js` keeps the last `RESOLVER_CACHE_SIZE` (default 5)
distinct source urls' downloaded files on disk, indexed by source url
in `MEDIA_DIR/cache-index.json`. Recasting a url that's still in the
cache skips the download entirely — `POST /resolve` resolves straight
to `status: "ready"` with the existing file's `streamUrl`, no yt-dlp
invocation at all. Eviction is by *last used*, not insertion order:
rewatching an older cached video bumps it back to the front, so the
one that actually gets evicted when a 6th distinct video is cast is
whichever entry has gone longest untouched. Evicted files are deleted
immediately (not left for the TTL sweep). This is independent of, and
takes priority over, `MEDIA_TTL_MS` — a cached file's lifetime is "one
of the last N distinct things cast," not a timer; the TTL sweep only
ever touches files the cache isn't tracking (orphaned partial/error
downloads).

## Torrents

`POST /torrent` takes a torrent URL from the Stremio server
(`http://<host>:11470/<infoHash>/<fileIdx>`, what the companion's Stremio
page builds) and saves that film on this server while the TV watches it:

- ffmpeg reads the file through the Stremio server (which does the actual
  torrenting, through the VPN) and writes it to
  `MEDIA_DIR/torrents/<infoHash>-<fileIdx>/` as an HLS playlist
  (`index.m3u8`) plus `.ts` segments of about 6 seconds each.
- The job turns `ready` as soon as the first 3 segments are saved, so the
  TV starts right away. The download keeps going on the server at whatever
  speed the torrent gives, whether the TV is watching, paused or stopped.
  `complete` in the job turns `true` once the whole film is saved.
- h264/hevc video and aac/mp3/ac3/eac3 audio are copied as they are, so
  the server does almost no work. Other audio (DTS, FLAC, TrueHD...) is
  converted to AAC stereo, and other video to h264, which is slow on a
  weak CPU. Subtitles are dropped.
- Finished films are kept, so casting the same one again plays from disk
  with no torrent at all. `TORRENT_CACHE_SIZE` (default 3) finished films
  are kept, least recently watched deleted first. A download that never
  finished (resolver stopped mid-film) is deleted on the next start.
- Casting a film that's already downloading joins the running download
  instead of starting a second one.

Seeking works within what's saved so far; jumping past it has to wait for
the download to get there.

## Extraction tiers

`runJob` in `src/index.js` tries, in order:

1. **yt-dlp native extractors** — YouTube, Twitter/X, Reddit, and the
   ~1800 other sites yt-dlp ships a dedicated extractor for.
2. **yt-dlp's own generic extractor** — no dedicated extractor, but the
   page's raw HTML has a `<video>` tag or a direct `.m3u8`/`.mpd` link
   yt-dlp can find by parsing the response it fetched. Built into yt-dlp
   itself, nothing added here.
3. **Rendered-page fallback** (`src/genericExtract.js`) — only reached
   if 1 and 2 both fail. Loads the page in real headless Chromium via
   [Playwright](https://playwright.dev/), the same way any visitor's
   browser would (JS runs, no fingerprint spoofing, no captcha solving,
   no anti-bot evasion), and reads back whatever HLS/DASH manifest
   request or `<video src>` that render actually produces. This exists
   for players that build their video url client-side, which tier 2 is
   structurally unable to see since it never executes JS. If a site
   detects and blocks plain automated Chromium, or requires a login this
   resolver was never given, this tier finds nothing and the original
   yt-dlp error from tier 1 is what reaches the companion. Disable it
   with `ENABLE_GENERIC_FALLBACK=0` if Playwright/Chromium isn't
   installed on a given host.

## Requirements

- Node.js (whatever version `relay/` runs on this host)
- [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) on `PATH` (or point
  `YTDLP_BIN` at it) — `pip install -U yt-dlp` or the site's other
  install methods. Keep it updated; sites change and yt-dlp ships
  frequent fixes.
- `ffmpeg` on `PATH` (yt-dlp shells out to it to mux separate
  video/audio streams into one MP4).
- [Playwright](https://playwright.dev/) + Chromium, for the tier-3
  fallback above: `npm install` pulls in the `playwright` package, then
  run `npx playwright install chromium` once to fetch the browser binary
  (not installed automatically — it's a ~150MB download). Skip this and
  set `ENABLE_GENERIC_FALLBACK=0` if you don't want the extra install;
  tiers 1–2 keep working exactly as before.

## API

- `POST /resolve` `{ "url": "https://..." }` → `202 { "id": "...", "status": "starting" }`
  (or `status: "ready"` immediately, if this url is a rewatch-cache hit
  — see above). Otherwise kicks off metadata probe + download in the
  background; does not block on it (a real download can take anywhere
  from seconds to minutes).
- `GET /resolve/:id` → current job state:
  ```json
  { "id": "...", "status": "downloading", "progress": 42.1, "title": "..." }
  ```
  `status` is one of `starting`, `downloading`, `ready`, `error`. Once
  `ready`, the response also includes `streamUrl` — an absolute
  `http://<this-host>/media/<id>.mp4` URL built from whatever `Host`
  header the request came in on, so it resolves correctly for both the
  companion and, once handed to it, the TV, as long as both reach this
  service at the same LAN address. On `error`, includes `error` (a
  human-readable message from yt-dlp).
- `GET /media/:id.mp4` — the resolved file, with HTTP Range support so
  AVPlay can seek.
- `POST /torrent` `{ "url": "<stremio server>/<infoHash>/<fileIdx>", "title": "..." }`
  → same job shape as `/resolve` (see "Torrents"). Once `ready`,
  `streamUrl` is `http://<this-host>/media/torrents/<key>/index.m3u8`,
  and `complete` says whether the download is still running.
- `GET /cache` → `{ "entries": [{ "sourceUrl", "title", "streamUrl", "lastUsedAt" }, ...] }`,
  most-recently-used first. The still-on-disk rewatch cache (up to
  `RESOLVER_CACHE_SIZE` entries) — lets a client offer "cast something
  you already downloaded" without re-resolving the source url.
- `GET /healthz` — `{ "status": "ok", "jobs": <n> }`.

## Config (`.env`, see `.env.example`)

| var | default | meaning |
|---|---|---|
| `PORT` | `8788` | HTTP port |
| `MEDIA_DIR` | `./media` | where downloaded MP4s land |
| `MAX_HEIGHT` | `1080` | caps the requested format so a cast doesn't pull an 8K master onto a home LAN |
| `MAX_FILESIZE` | `2G` | hard stop passed to yt-dlp's `--max-filesize`, protects disk from a runaway download |
| `MEDIA_TTL_MS` | `21600000` (6h) | sweep interval for deleting old downloaded files and job records not tracked by the rewatch cache |
| `RESOLVER_CACHE_SIZE` | `5` | how many distinct source urls the rewatch cache (see above) keeps on disk at once |
| `TORRENT_CACHE_SIZE` | `3` | how many finished torrent films stay on disk (see "Torrents"; a film is often 2–20 GB) |
| `TORRENT_START_TIMEOUT_MS` | `180000` | how long to wait for a torrent to start sending data before giving up |
| `YTDLP_BIN` | `yt-dlp` | override if it's not on `PATH` for the service user |

## Personal use

This exists so casting *your own* browsing — a video someone sent you,
a clip you want on the big screen — doesn't dead-end just because it's
wrapped in a page instead of being a bare `.mp4` link. It's the same
category of tool as a "cast this tab" browser extension or VLC's
network-stream-from-a-url feature: it fetches whatever a URL you
already have access to and paste in yourself points at, for playback on
your own TV, nothing more. It doesn't get you past a paywall or login
wall it wasn't already logged into, and it doesn't touch DRM-protected
streaming services (Netflix, Disney+, etc.) — those are encrypted and
yt-dlp deliberately doesn't attempt them. The rendered-page fallback
(tier 3 above) doesn't change this: it's a real browser loading a page
the same way any visitor's would, not a tool for getting past detection
or protection a site put up specifically to stop this kind of access.

## Deployment

Same host and pattern as `relay/` (see `systemd/tv-casting-resolver.service`,
mirrors `relay/systemd/tv-casting-relay.service`) — a separate systemd
unit and port, not folded into the relay process, so the relay's
"never touches media" rule stays literally true at the process level,
not just by convention.
