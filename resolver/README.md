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

`src/cache.js` keeps the last `RESOLVER_CACHE_SIZE` (default 100)
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
  torrenting, through the VPN), or through our own torrent server when
  `TORRENT_SERVER_URL` is set (same URL path, different host; see
  [`torrent-server/`](../torrent-server/README.md)), and writes it to
  `MEDIA_DIR/torrents/<infoHash>-<fileIdx>/` as an HLS playlist
  (`index.m3u8`) plus `.ts` segments of about 6 seconds each.
- The job turns `ready` as soon as the first 3 segments are saved, so the
  TV starts right away. While the film is still saving, the TV gets a
  playlist for the whole film (`src/hls.js`): the saved segments, then
  placeholders for the rest. Samsung's player treats a growing playlist
  as live TV and would start wherever the download has got to; this way
  it starts at the beginning and its seek bar shows the full length. A
  request for a segment that isn't saved yet waits for it (up to
  `SEGMENT_WAIT_MS`, default 2 min), and the few spare placeholders left
  once the film is saved are answered empty, so the TV just reaches the end. The download keeps going on the server at whatever
  speed the torrent gives, whether the TV is watching, paused or stopped.
  `complete` in the job turns `true` once the whole film is saved.
- h264/hevc video up to 1080p and aac/mp3/ac3/eac3 audio are copied as
  they are, so the server does almost no work. Bigger video (4K) is
  converted down to 1080p for the TV, on the NVIDIA GPU when there is one
  (`TORRENT_ENCODER`), and the untouched original is kept beside it in
  `original/` from the same download (`TORRENT_KEEP_ORIGINAL`). Other audio (DTS, FLAC, TrueHD...) is
  converted to AAC stereo, and other video to h264, which is slow on a
  weak CPU. Subtitles are dropped.
- Finished films are kept, so casting the same one again plays from disk
  with no torrent at all. `TORRENT_CACHE_SIZE` (default 100) finished films
  are kept, least recently watched deleted first. A download that never
  finished (resolver stopped mid-film) is deleted on the next start.
- Casting a film that's already downloading joins the running download
  instead of starting a second one.
- The log reports the torrent's peers while a job runs, every 10 s while
  it's still looking for them and every 30 s once it's saving:
  `torrent peers [connecting] <key> 3 connected (2 in, 1 out), 57 known,
  metadata ok, 1.20 MB/s, forwarded port 34136`. `in` are peers that
  connected to us through the VPN's forwarded port, `out` ones we reached;
  `known` is every address heard of. The Stremio server reports tries
  and per-tracker finds instead of in/out and known.
- Torrent jobs in `/jobs` and `/resolve/:id` also carry `kind: "torrent"`,
  `phase` (`connecting` → `saving` → `done`), `savedSec`, `durationSec`,
  `bytes` (on disk so far) and `bytesPerSec` (over the last ~5 s). The
  companion shows them as progress bars (the "downloads" tab, and the Stremio page)
  (`companion/js/downloads-view.js`), which
  keep updating after the TV starts playing and have a cancel button.

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
- `POST /resolve/:id/cancel` — stops a download that's still running
  (yt-dlp, or a torrent's ffmpeg) and deletes what it saved so far; the
  job's `status` becomes `cancelled`. `409` if it already finished. A
  torrent the TV is playing stops playing too.
- `GET /cache` → `{ "entries": [{ "kind", "key", "sourceUrl", "title", "streamUrl", "thumbUrl", "bytes", "createdAt", "lastUsedAt" }, ...] }`,
  most-recently-used first. The still-on-disk rewatch cache (up to
  `RESOLVER_CACHE_SIZE` entries) — lets a client offer "cast something
  you already downloaded" without re-resolving the source url. Also
  `"torrents": [{ "kind", "key", "title", "streamUrl", "thumbUrl", "bytes", "createdAt", "lastUsedAt" }]`:
  the films saved from torrents (up to `TORRENT_CACHE_SIZE`), which the
  companion's downloads list offers to cast.
- `GET /thumb/<media|torrents>/<key>.jpg` — a 480 px frame from 10% into a
  saved video or film (`src/thumbs.js`), made on first request and kept in
  `MEDIA_DIR/thumbs/` until the video is deleted. A film still saving gets a
  fresh one every 5 minutes.
- `POST /cache/torrents/<key>/optimize` — makes the 1080p TV copy of a
  saved film that's bigger than `TORRENT_MAX_HEIGHT` and has none yet
  (saved before conversions existed), from the files on disk: no download.
  The full-size film moves into `original/`, same as a converted download.
  One runs at a time, the rest queue; `GET /cache` shows each film's
  `width`/`height`, `canOptimize`, and `optimize` (`queued`, `running` with
  `pct`, or `error`). `409` if it doesn't need it or is still downloading.
- `POST /cache/<media|torrents>/<key>/delete` — deletes a saved video or
  film (files and thumbnail). `409` for a film that's still downloading
  (cancel it instead), `404` if it isn't saved.
- `GET /healthz` — `{ "status": "ok", "jobs": <n> }`.

## Config (`.env`, see `.env.example`)

| var | default | meaning |
|---|---|---|
| `PORT` | `8788` | HTTP port |
| `MEDIA_DIR` | `./media` | where downloaded MP4s land |
| `MAX_HEIGHT` | `1080` | caps the requested format so a cast doesn't pull an 8K master onto a home LAN |
| `MAX_FILESIZE` | `2G` | hard stop passed to yt-dlp's `--max-filesize`, protects disk from a runaway download |
| `MEDIA_TTL_MS` | `21600000` (6h) | sweep interval for deleting old downloaded files and job records not tracked by the rewatch cache |
| `RESOLVER_CACHE_SIZE` | `100` | how many distinct source urls the rewatch cache (see above) keeps on disk at once; delete by hand from the companion's "saved" tab |
| `TORRENT_CACHE_SIZE` | `100` | how many finished torrent films stay on disk (see "Torrents"; a film is often 2–20 GB, so watch the disk); delete by hand from the "saved" tab |
| `TORRENT_SERVER_URL` | *(unset)* | read torrents from [`torrent-server/`](../torrent-server/README.md) (e.g. `http://192.168.2.31:11480`) instead of the Stremio server the companion names |
| `TORRENT_MAX_HEIGHT` | `1080` | films bigger than this (4K) are converted down to it as they're saved, for the TV; `0` keeps every size |
| `TORRENT_KEEP_ORIGINAL` | `1` | when a film is converted down, also keep the untouched original in `<film>/original/` (the saved tab's "copy 4K link"); `0` keeps only the TV's copy. Costs the film's full size again on disk |
| `TORRENT_ENCODER` | `auto` | `nvenc`: convert on an NVIDIA GPU (h264_nvenc, with CUDA decoding); `x264`: on the CPU; `auto`: nvenc if a test encode works at the first conversion, else x264. The log says which (`video conversions: …`) |
| `TORRENT_X264_PRESET` | `superfast` | libx264 speed for CPU conversions; on a slow CPU a 4K conversion can run slower than the film plays |
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
