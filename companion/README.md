# Companion

Phone/desktop PWA for a persistent video library, Stremio browsing, and TV playback.
Jellyfin integration has been removed.

- **Stremio (`stremio.html`):** laid out like Stremio Web, in the Matrix style. A nav rail
  (bottom bar on a phone) has Board, Discover, Library, Calendar, Addons, and Settings; the
  search bar on top searches your library and every searchable addon catalog. Board shows
  Continue Watching, then a row per addon catalog. Discover has type, catalog, and filter
  menus over a poster grid that loads as you scroll, with a preview beside it on wide screens.
  Details show the title with episodes, then streams, in a side panel. Official Stremio Core
  runs in a Web Worker and supplies addons, catalogs, search, metadata, episodes, streams,
  and subtitles. Choosing a stream casts it and saves it; **save** on a stream downloads it
  without casting. “Match Stremio metadata” on a saved file opens this page to apply movie
  or episode details without downloading again.
- **Library:** the Library section is your own library, the files saved on the resolver, not a
  Stremio library addon. It has Stremio's type and sort menus (last watched, recently added,
  A-Z, watched). Movies and series are one poster each, with every saved episode under it;
  YouTube and other videos are listed per file. A saved movie or episode appears as the
  first source, **Your library**, above the addon streams, with play or continue, continue
  download, 4K link, optimize for TV, category, and delete. Calendar shows episode release
  days for the series in your library. `library.html` now redirects here.
- **Plus18:** the 18+ button (with a confirmation) switches the whole page to the Plus18
  section: its own Core profile and addons, and a library of only 18+ files. Normal mode
  hides 18+ titles everywhere.
- **Link:** download and cast, or save without casting. Direct video URLs are saved
  by default; uncheck the save option for immediate direct playback.
- **Downloads:** progress, cancellation, and casting while torrents download.
- **Remote / Activity:** playback controls and recent download activity.

Downloads remain until explicitly deleted. Partial torrents, resume, 4K originals,
and TV optimization remain available. YouTube videos retain the original YouTube
thumbnail locally when available; other files use a Stremio poster or a video frame.
Existing files without metadata can be matched manually; deleted files cannot be recovered.

Run `node companion/serve.js`. Configure server addresses in `js/config.js`.
The checked-in `vendor/stremio-core/` worker and WASM are built from pinned
`@stremio/stremio-core-web@0.63.2`. To rebuild, run `npm ci` and
`npm run build:core` from `companion/`. The upstream MIT license is in
`vendor/stremio-core/LICENSE.md`. The companion server serves WASM with
`application/wasm`.
The service worker caches only the shell and automatically changes version as files
change. Stremio add-on settings are shared using the companion server's settings API.
Media goes from resolver to TV directly; the relay only carries playback commands.
Normal and Plus18 use separate Core workers and profiles. Automatic next episode
downloads may run after the page closes, so the resolver has a limited server-side
stream lookup using the saved addon URLs for that background path.

## Local series library and watch history

Movies and shows now open from a poster grid into a detail view using the same
hero, season selector, and episode layout as the Stremio page. A download saves
the title's catalog, episode descriptions and dates, and available artwork on
the resolver. Episode rows distinguish downloaded, partial, and missing files,
and show watched status and the last playback position. Artwork caching runs in
the background; unavailable provider images retain their remote URL until cached.
Older Cinemeta series are enriched when the library is opened; custom-addon
items can be refreshed with “Match Stremio metadata”.

The updated TV receiver saves progress every five seconds and on pause/stop,
resumes saved videos automatically, and advances on natural completion to the
immediate next complete, TV-playable episode, including the next season. It stops
at missing or partial episodes, specials, and the end of the series. A next
4K episode that still needs a TV copy must first be optimized from the library.
Closing the companion page does not interrupt this behavior. Watch history is
shared across companions and persists through resolver restarts.

Deploy the updated resolver and companion, and rebuild/install the updated TV
receiver to enable progress and continuation. No relay update is needed.

## Accounts (the guest door)

You use the companion as always, with no login. For other people, `serve.js`
also runs a **guest door** on `127.0.0.1:8790` (`GUEST_PORT`, `0` turns it
off; `guest-gateway.js`) where everything needs an account:

- They see Board, Discover, Search, Calendar and Library for **Movies and
  Series only**: no Plus18, no addons or settings, no tools, and never
  your TV or relay.
- They play on **their own devices**. Under **Play on**, "This device"
  plays in the page; and a receiver page (`receiver.html`) they open and
  turn on in another browser where they're logged in with the same
  account (a laptop, a TV's browser) shows up there too, with the remote
  at the bottom working as it does for you. Each account has its own
  small relay inside the guest door (`guest-cast.js`, over server-sent
  events): nobody sees anyone else's receivers.
- Each account has **its own library and watch progress**. Saving
  downloads onto the server like yours does, or reuses the file if it's
  already there, and adds it to their list only. Removing it from their
  library never deletes the file. You still see every saved file in yours.
- The server checks all of this, not just the page: the guest door only
  passes library, download and media requests for that person's own
  titles; torrents always go to your own Stremio server
  (`STREMIO_INTERNAL_URL`, default `http://127.0.0.1:11470`), links into
  the home network are refused, and the resolver is reached at
  `RESOLVER_INTERNAL_URL` (default `http://127.0.0.1:8788`).

Accounts live in `DATA_DIR/accounts.json` (passwords as scrypt hashes).
Create them on your own page under **Settings → accounts**. A new password
logs that person out everywhere; wrong passwords lock that name out for
15 minutes after 8 tries.

Put the door on the internet with Tailscale Funnel, on the server
(MagicDNS and HTTPS certificates on in the Tailscale admin console; the
first run prints a link to allow Funnel):

```bash
sudo tailscale funnel --bg --https=10000 http://127.0.0.1:8790
```

People then open `https://<your server's name>.ts.net:10000` and log in.
Port 10000 keeps it apart from your own `https://` address and the AirPlay
links (8443); Funnel also allows 443 if nothing else uses it. To close the
door: `sudo tailscale funnel --https=10000 off`.

Not for guests yet: AirPlay (the TV can't log in) and subtitles.
