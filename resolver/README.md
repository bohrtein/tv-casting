# Saved-library update

Both link and torrent downloads now stay until explicitly deleted; the historical
RESOLVER_CACHE_SIZE and TORRENT_CACHE_SIZE caps are ignored. Existing indexed files
are retained automatically. The TTL sweep only removes orphaned files.

POST /resolve and POST /torrent accept category and metadata. Categories are porn,
movies, series, youtube, other, or auto. Stremio metadata includes id, type, name,
poster, description, and videoId/season/episode/episodeTitle for series.
GET /library aliases GET /cache and returns entries and torrents with category and
metadata fields. POST /library/:kind/:key updates a saved item's category/metadata.
YouTube thumbnails are saved locally (5 MB limit, 15-second fetch timeout); a failed
image request retains the remote image URL or falls back to a video frame.
Requires Node 18+. Run npm test in resolver for persistence/API regression tests.

`POST /subtitle` accepts `{ "url": "https://.../captions.srt" }` and returns
`{ "url": "http://resolver/media/subtitle-....smi" }`. It downloads a bounded
subtitle file and converts SRT or WebVTT to UTF-8 SAMI for Samsung AVPlay.
The companion sends that local URL as the optional `subtitleUrl` play field.

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
companion uses for media services — see root [README.md](../README.md)
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

## Permanent library

`src/cache.js` keeps completed downloads in `MEDIA_DIR/cache-index.json` and torrent
entries in `MEDIA_DIR/torrents/cache-index.json`. These historical filenames allow
existing downloads to be retained without migration. Recasting a saved URL returns
its existing file immediately. Files and their thumbnails stay until deleted from
Library; `MEDIA_TTL_MS` only applies to orphaned partial/error files and old job records.

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
- Unfinished films are kept too: a download that's stopped, fails, or is
  cut short by a resolver restart stays in the cache as partial
  (`partial`, `savedSec` of `durationSec` in `GET /cache`). Continuing it
  (`POST /cache/torrents/<key>/resume`, or casting the same stream again)
  seeks the torrent to where the saved part ends and writes the rest to
  `index.resume.m3u8`, numbered on from the saved segments; players get
  the two joined with an `EXT-X-DISCONTINUITY`, and they're merged into
  `index.m3u8` when the run ends. A few seconds around the join may play
  twice (the seek lands on the keyframe before). A partial film at rest is
  served as a finished playlist of what's saved, so a cast starts at the
  beginning.
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
- `POST /share` → `{ "prefix": "/s/<expiry>/<signature>", "expiresAt": <ms>, "expiresIn": <ms> }`,
  a key for the AirPlay listener: a saved video's `/media/...` path after
  the prefix is its link (see "AirPlay away from home").
- `POST /torrent` `{ "url": "<stremio server>/<infoHash>/<fileIdx>", "title": "..." }`
  → same job shape as `/resolve` (see "Torrents"). Once `ready`,
  `streamUrl` is `http://<this-host>/media/torrents/<key>/index.m3u8`,
  and `complete` says whether the download is still running.
- `POST /resolve/:id/cancel` — stops a download that's still running
  (yt-dlp, or a torrent's ffmpeg); the job's `status` becomes `cancelled`.
  A link download's file is deleted. A torrent keeps what it saved, as a
  partial film in `GET /cache` (see "Torrents"), unless that's nothing.
  `409` if it already finished. A torrent the TV is playing stops playing
  too.
- `POST /cache/torrents/<key>/resume` — continues a partial film from
  where its saved part ends; answers with the new job (`{ id, status }`).
- `GET /cache` → `{ "entries": [{ "kind", "key", "sourceUrl", "title", "streamUrl", "thumbUrl", "bytes", "createdAt", "lastUsedAt" }, ...] }`,
  most-recently-used first. The still-on-disk rewatch cache (up to
  `RESOLVER_CACHE_SIZE` entries) — lets a client offer "cast something
  you already downloaded" without re-resolving the source url. Also
  `"torrents": [{ "kind", "key", "title", "streamUrl", "thumbUrl", "bytes", "createdAt", "lastUsedAt" }]`:
  the films saved from torrents, which the
  companion's downloads list offers to cast.
- `GET /thumb/<media|torrents>/<key>.jpg` — a 480 px frame from 10% into a
  saved video or film (`src/thumbs.js`), made on first request and kept in
  `MEDIA_DIR/thumbs/` until the video is deleted. A film still saving gets a
  fresh one every 5 minutes.
- `POST /cache/torrents/<key>/optimize` — makes the 1080p TV copy of a
  saved film that's bigger than `TORRENT_MAX_HEIGHT` and has none yet
  (saved before conversions existed), from the files on disk: no download.
  The full-size film moves into `original/` first and the copy is written
  where the TV plays from, as a growing playlist, so it can be cast while
  it's being made (the same whole-film playlist a download gets). Each run
  is a job (it shows in `/jobs` and the downloads list; cancel puts the
  full-size film back). One runs at a time, the rest queue; `?cast=1`
  starts it right away and answers with its job `id`. A run a restart cut
  short is undone at startup. `GET /cache` shows each film's
  `width`/`height`, `needsTvCopy`, `canOptimize`, and `optimize`
  (`queued`, `running` with `pct`, or `error`). `409` if it doesn't need
  it, is partial, or is still downloading.
- A film too big for the TV is never sent to it: casting one
  (`POST /torrent`) starts its optimize run and answers with that job,
  which turns `ready` once the first segments of the 1080p copy exist.
- `POST /cache/<media|torrents>/<key>/delete` — deletes a saved video or
  film (files and thumbnail). `409` for a film that's still downloading
  (cancel it instead), `404` if it isn't saved.
- `GET /healthz` — `{ "status": "ok", "jobs": <n> }`.

## Config (`.env`, see `.env.example`)

| var | default | meaning |
|---|---|---|
| `PORT` | `8788` | HTTP port |
| `AIRPLAY_PORT` | `8789` | the signed-links listener for AirPlay away from home, on `127.0.0.1` only (see below); `0` turns it off |
| `AIRPLAY_KEY_HOURS` | `3` | how long each AirPlay key opens saved videos for |
| `MEDIA_DIR` | `./media` | where downloaded MP4s land |
| `MAX_HEIGHT` | `1080` | caps the requested format so a cast doesn't pull an 8K master onto a home LAN |
| `MAX_FILESIZE` | `2G` | hard stop passed to yt-dlp's `--max-filesize`, protects disk from a runaway download |
| `MEDIA_TTL_MS` | `21600000` (6h) | sweep interval for deleting old downloaded files and job records not tracked by the rewatch cache |
| `RESOLVER_CACHE_SIZE` | ignored | Saved link videos remain until deleted from Library |
| `TORRENT_CACHE_SIZE` | ignored | Saved torrents remain until deleted from Library |
| `TORRENT_SERVER_URL` | *(unset)* | read torrents from [`torrent-server/`](../torrent-server/README.md) (e.g. `http://192.168.2.31:11480`) instead of the Stremio server the companion names |
| `TORRENT_MAX_HEIGHT` | `1080` | films bigger than this (4K) are converted down to it as they're saved, for the TV; `0` keeps every size |
| `TORRENT_KEEP_ORIGINAL` | `1` | when a film is converted down, also keep the untouched original in `<film>/original/` (the saved tab's "copy 4K link"); `0` keeps only the TV's copy. Costs the film's full size again on disk |
| `TORRENT_ENCODER` | `auto` | `nvenc`: convert on an NVIDIA GPU (h264_nvenc, with CUDA decoding); `x264`: on the CPU; `auto`: nvenc if a test encode works at the first conversion, else x264. The log says which (`video conversions: …`) |
| `TORRENT_X264_PRESET` | `superfast` | libx264 speed for CPU conversions; on a slow CPU a 4K conversion can run slower than the film plays |
| `TORRENT_START_TIMEOUT_MS` | `180000` | how long to wait for a torrent to start sending data before giving up |
| `YTDLP_BIN` | `yt-dlp` | override if it's not on `PATH` for the service user |

## AirPlay away from home

AirPlay doesn't send the picture: the phone hands the TV a link and the TV
fetches the video itself. A TV that isn't on the home Wi-Fi (a friend's, a
hotel's) can't reach this server's private addresses, so it gets nothing.

For that, the resolver keeps a second listener on `127.0.0.1:8789` that
answers only links with a **key** (`src/share.js`): `/s/<expiry>/<signature>/media/...`.
A key opens any saved video (not a list of them: saved videos have random
names that nothing public shows) and stops working 3 hours after it was
made. It can't start a download and never reaches the Stremio server or
any other part of the resolver: everything else answers `403`. The secret
behind the keys lives only in the running process, so restarting the
resolver ends every key. The receiver asks for a new key a few minutes
before its current one runs out, so a long film keeps playing.

Put that listener on the internet with [Tailscale Funnel](https://tailscale.com/kb/1223/funnel),
on the server:

```bash
# once: turn on MagicDNS and HTTPS certificates in the Tailscale admin
# console; the first funnel command prints a link to allow Funnel here.
sudo tailscale funnel --bg --https=8443 http://127.0.0.1:8789
tailscale status --json | grep -m1 DNSName     # e.g. myserver.tail1234.ts.net.
```

Check from a phone with Wi-Fi and Tailscale off: `https://<that name>:8443/`
should answer **403** (reachable, and closed without a signed link). Then
put `https://<that name>:8443` in the companion under **Settings → AirPlay
away from home**. The receiver page (`receiver.html`, opened in Safari over
`https://`) asks `POST /share` for a key and switches what it's playing to
the public link while AirPlay is on. To turn it all off:
`sudo tailscale funnel --https=8443 off`.

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

## Playback history API

`POST /playback` accepts `{ url, event }` for `event: "start"`, and additionally
`positionSec` and `durationSec` for `"progress"` and `"completed"`. The URL must
identify an indexed local media file. The response contains `progress`,
`startPositionSec` (zero for a watched item), and, on natural completion, an
optional `next: { url, title }` for the immediate next complete, TV-ready episode.
The receiver is the sole writer during playback; companion tabs do not race to
advance episodes. Manual stops and partial-file completion never trigger autoplay.

`GET /library` and `/cache` include each entry's `progress` and a shared `titles`
catalog containing all known episodes, including files not downloaded. Catalogs,
watch positions, and artwork mappings live in `MEDIA_DIR/library-state.json`;
locally cached images live in `MEDIA_DIR/library-art/`. These survive media deletion
and are excluded from orphan-file cleanup. Catalog and history updates use atomic
file replacement. The relay remains control transport only.
