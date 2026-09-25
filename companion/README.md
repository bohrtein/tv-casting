# Companion

Phone/desktop PWA for a persistent video library, Stremio browsing, and TV playback.
Jellyfin integration has been removed.

- **Library:** its own page in the top navigation, with all saved links and torrents grouped as Movies, Television series,
  YouTube videos, Porn, or Other videos. Episodes with Stremio metadata are grouped
  by show and ordered by season and episode. YouTube videos use a thumbnail grid;
  their category and delete controls are under More options. Categories can be corrected per file.
- **Stremio:** the existing catalog, search, add-on management, and episode picker.
  Selecting a stream saves the metadata with the download. Enable “Save to Library
  without casting” to download only. “Match Stremio metadata” on an existing library
  item opens this page to apply movie or episode details without downloading again.
- **Link:** download and cast, or save without casting. Direct video URLs are saved
  by default; uncheck the save option for immediate direct playback.
- **Downloads:** progress, cancellation, and casting while torrents download.
- **Remote / Activity:** playback controls and recent download activity.

Downloads remain until explicitly deleted. Partial torrents, resume, 4K originals,
and TV optimization remain available. YouTube videos retain the original YouTube
thumbnail locally when available; other files use a Stremio poster or a video frame.
Existing files without metadata can be matched manually; deleted files cannot be recovered.

Run `node companion/serve.js`. Configure server addresses in `js/config.js`.
The service worker caches only the shell and automatically changes version as files
change. Stremio add-on settings are shared using the companion server's settings API.
Media goes from resolver to TV directly; the relay only carries playback commands.

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
