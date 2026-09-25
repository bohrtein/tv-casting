# Stremio Core migration baseline

This is the compatibility contract for replacing the Stremio addon client. It
describes behavior present in this repository, not behavior promised by Core.
Keep the resolver, relay, and receiver interfaces stable while moving addon
state and resource discovery to Core.

## Existing behavior to preserve

| Area | Current behavior | Code and parity check |
| --- | --- | --- |
| Addons | Normal and Plus18 have separate, ordered manifest URL lists. `serve.js` shares them between devices; local storage is a fallback. A failed addon stays visible with an error. | `stremio-client.js`, `serve.js`, `stremio-sections.test.js` |
| Catalogs | List all catalogs that need no required extra, browse with `skip` pagination, remember the selected catalog per section, and search every addon catalog advertising `search`. | `stremio-client.js`, `stremio-app.js` |
| Content policy | Hide restricted results and details in Normal; require confirmation before entering Plus18. | `content-policy.js`, `stremio-app.js` |
| Details | Resolve metadata, show poster, backdrop, facts, series seasons, specials, and episodes. The episode ID is used to request streams. | `stremio-client.js`, `stremio-app.js` |
| Streams | Query capable addons; keep partial results when one fails; show addon name, release tags, seeders, and a clear reason for unsupported sources. | `stremio-client.js`, `stremio-app.js` |
| Casting | Convert direct HTTP, proxied HTTP, torrents, magnets, and YouTube to a playable URL or resolver job. Send only a play command through the relay. The TV fetches media directly. | `stremio-client.js`, `stremio-app.js`, `resolver-client.js` |
| Local library | Save selected source with metadata; support save without casting and applying metadata to an existing file. Playback progress and next episode are managed by the resolver and receiver. | `stremio-app.js`, `resolver/src/index.js`, `tv-receiver/js/playback-history.js` |
| Other websites | Link extraction and generic website handling remain in the resolver path. | `companion/js/app.js`, `resolver/src/genericExtract.js`, `resolver/src/ytdlp.js` |

## Gaps and migration constraints

- The current Stremio page does not fetch or choose addon subtitles. Core
  subtitle models require new UI and a receiver or resolver path for delivering
  the chosen subtitle; this is a feature addition, not existing parity.
- `resolver/src/index.js` imports the browser's `stremio-client.js` to find a
  stream for the next unsaved episode. Removing that file requires migrating
  this server-side path too. Core's web bridge runs in a browser worker, so a
  Node-compatible replacement or an explicit server-side addon client is
  needed there.
- Library files and playback history are local resolver state. Moving that
  state to Core requires a migration design; Core must not silently replace it.
- Core addon state must be initialized separately for Normal and Plus18, or
  equivalent isolation must be demonstrated. A single unfiltered profile
  could expose Plus18 catalogs in Normal.
- A Core-selected stream must cross one normalized playable-source boundary.
  Only the playback adapter should know how to send it through the existing
  resolver, streaming server, and relay interfaces.

## Parity gates

1. Pin and locally serve a verified `@stremio/stremio-core-web` build, with its
   worker and WASM assets. Keep the current client active until Core can load
   in the deployed no-build companion.
2. Run the same Normal and Plus18 addon lists against both paths. Verify
   manifest failures, catalog filters and pagination, search, movie details,
   episode IDs, stream discovery, and source conversion with unrelated addons.
3. Move subtitle discovery and selection through Core; verify delivery on the
   actual Samsung receiver.
4. Move server-side next-episode discovery before deleting
   `stremio-client.js`. Verify downloaded and unsaved next episodes, including
   season boundaries.
5. Test direct, proxied, torrent, and YouTube playback on the real TV, plus
   saved-library metadata, Plus18 isolation, and arbitrary website links.

Official references: [Stremio Core](https://github.com/Stremio/stremio-core),
[Core web bridge](https://github.com/Stremio/stremio-core/tree/development/stremio-core-web),
and [Stremio Web](https://github.com/Stremio/stremio-web).

## Implemented migration

The companion now loads the pinned official Core worker and WASM. Core owns
interactive addon installation, catalog selection and filters, search, metadata,
episodes, streams, and subtitle discovery. A cast adapter maps selected streams
to the existing resolver and relay. Normal and Plus18 have isolated Core profiles.
The old `stremio-client.js` is removed. The receiver downloads selected subtitles
as local SAMI files for AVPlay. Existing resolver library and playback history
remain in place because they track downloaded media and TV progress.

The resolver has one limited background addon lookup for automatic next episode
downloads after the companion browser closes. This is the remaining server-side
exception to Core owning addon discovery. It uses the saved addon URLs and is
covered by the resolver continuation test. Generic website extraction stays on
its existing path. Real Samsung TV playback and unrelated public addon behavior
still require device/network acceptance testing.
