# TV Casting

A home-network "cast to TV" system for saved videos, built as four independent
pieces in one repo. Full background and open decisions live in
[PLAN.md](PLAN.md).

## Pieces

- **[`relay/`](relay/)** — Node.js + `ws` server that runs on the home
  Ubuntu server (alongside the app-launcher hub). No pairing — it tracks
  at most one connected TV and any number of companions, and forwards
  `play`/`pause`/`stop`/`status` JSON messages between them. See
  [`relay/PROTOCOL.md`](relay/PROTOCOL.md) for the exact message schema.
- **[`tv-receiver/`](tv-receiver/)** — Samsung Tizen app (HTML/CSS/JS +
  AVPlay). Connects to the relay on boot, plays whatever stream URL it's
  sent, and reports playback status back through the relay.
- **[`companion/`](companion/)** — Phone/desktop PWA with a permanent saved library,
  categorized as Movies, Television series, YouTube videos, Porn, and Other videos.
  Stremio add-ons provide catalog browsing and movie/episode metadata. Downloads
  and locally saved thumbnails live on the resolver; playback commands use the relay.
- **[`resolver/`](resolver/)** — Node.js HTTP service, also on the home
  server. Turns a page URL with an embedded video (YouTube, Twitter/X,
  …) into a plain MP4 via `yt-dlp` + `ffmpeg`, since AVPlay can only load
  a direct media URL, not a webpage. See [`resolver/README.md`](resolver/README.md).

## Hard rules

These are enforced in code review, not just convention:

- **The relay never touches media files and never calls media providers.** It is
  transport only — it forwards small control/status JSON messages between
  a TV and its companions and knows nothing about media.
- **The companion never streams media through the relay.** Media flows
  Resolver → TV directly; only control/status JSON goes through
  the relay.
- **The resolver is a separate process from the relay**, on its own port,
  so "the relay never touches media" stays true at the process level, not
  just by convention — it's the piece that touches media (downloads it
  via yt-dlp, serves it back over HTTP) precisely because the relay isn't
  allowed to.

## Deployment (Ubuntu server, alongside [app-launcher hub](https://github.com/bohrtein/apphub))

- **`relay/` and `resolver/` run as their own always-on systemd services**
  (`relay/systemd/tv-casting-relay.service`, `resolver/systemd/tv-casting-resolver.service`),
  independent of the app-launcher hub's own on-demand process management.
  They're not a fit for it: the hub only starts an app when its dashboard
  is used and stops it after proxied-traffic idle time, but the TV and
  phone companions talk to relay (WebSocket) and resolver's `/media/*`
  (direct file fetch) on their own fixed ports, never through the hub's
  proxy -- so the hub would have no way to see either one is actually in
  use, and relay in particular has to be up even when nobody has App Hub
  open at all. Both units assume `/opt/tv-casting/<relay|resolver>` and
  the hub's own `apphub` service account -- copy to `/etc/systemd/system/`,
  `daemon-reload`, `enable --now`, same as `apphub.service` itself.
- **`companion/` is registered with the app-launcher hub** as an on-demand
  app via its **+ Import from GitHub** page -- this repo's root
  [`app.toml`](app.toml) points the hub at `node companion/serve.js`, so
  importing `tv-casting` there launches/stops/health-checks just the
  companion PWA like any other app-launcher app. It's a clean fit (small
  static assets, no persistent connection) unlike relay/resolver above.
  Reaching it then goes through the hub's own login (password + TOTP)
  first, same as every other app-launcher app.
- `companion/js/config.js`'s `RELAY_URL`/`RESOLVER_URL` still point
  straight at relay/resolver's own LAN host:port either way -- being
  proxied by the hub only changes how you reach the companion page
  itself, not how the three pieces talk to each other.

## Status

See the "Current status" section at the bottom of [PLAN.md](PLAN.md).

## Playback improvements (September 2026)

- Root companion launches Remote; #link, #remote, #downloads and #activity remain explicit routes.
- Library's 18+ section includes legacy Porn items and explicit adult/rating metadata.
  Catalog mode persists across navigation. Unrated media stays usable; absent ratings are
  not a guarantee of suitability. Mode is a browsing filter, not an access-control boundary.
- Downloaded videos live in Library; Links contains acquisition controls only.
- Open companion/receiver.html on a phone or computer, enable it, then select its name
  in the companion target selector. Keep the receiver open. Browser autoplay restrictions
  may require tapping Start on that device. Native HTML5 playback and bundled HLS.js
  reuse server streams without making another saved copy. Codec support depends on the browser.
- TV seeks combine relative button presses, serialize AVPlay calls, retain failed targets,
  retry transient failures and show pending feedback. After repeated failure, press seek to retry.
- TV uses contain fitting, dynamic viewport sizing, and Samsung's documented AVPlay coordinate
  conversion: https://developer.samsung.com/smarttv/develop/guides/multimedia/media-playback/using-avplay.html
- Natural episode completion uses the saved ordered catalog (excluding specials and future
  releases). It plays the next saved episode or resolves it using saved addon settings and
  the existing stream-selection/download clients. Manual stop, replacement, errors and
  disconnect cancel continuation. Older library entries without provider settings can
  continue through downloaded episodes; select a catalog stream again to save provider settings.

Validation: node --test relay/test/*.test.js companion/test/*.test.js tv-receiver/tests/*.test.js resolver/test/*.test.js
Browser smoke checks used synthetic media and library data, not personal downloads.
Real Samsung firmware, physical mobile devices and live third-party provider compatibility
still need on-device checks. Rebuild and sideload tv-receiver for the TV changes; deploy relay,
resolver and companion together. All three use files from this repository, so deploy the full clone.
