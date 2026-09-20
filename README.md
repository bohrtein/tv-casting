# TV Casting

A home-network "cast to TV" system for Jellyfin, built as four independent
pieces in one repo. Full background and open decisions live in
[PLAN.md](PLAN.md).

## Pieces

- **[`relay/`](relay/)** — Node.js + `ws` server that runs on the home
  Ubuntu server (alongside the app-launcher hub). Handles device pairing
  (room codes) and forwards `play`/`pause`/`stop`/`status` JSON messages
  between a TV and its companion(s). See [`relay/PROTOCOL.md`](relay/PROTOCOL.md)
  for the exact message schema.
- **[`tv-receiver/`](tv-receiver/)** — Samsung Tizen app (HTML/CSS/JS +
  AVPlay). Idle screen shows a pairing QR code and plain-text code,
  connects to the relay, plays whatever stream URL it's sent, and reports
  playback status back through the relay.
- **[`companion/`](companion/)** — Phone/desktop PWA. Talks to Jellyfin
  directly for library browsing and to obtain stream URLs, and to the
  resolver for non-direct links. Connects to the relay only to pair with
  a TV and to send play/pause/stop commands and receive status. Styled
  with the [Matrix](https://github.com/bohrtein/matrix_design) design
  system (`matrix.css`, `matrix.js`, `fonts/`, vendored in this folder).
- **[`resolver/`](resolver/)** — Node.js HTTP service, also on the home
  server. Turns a page URL with an embedded video (YouTube, Twitter/X,
  …) into a plain MP4 via `yt-dlp` + `ffmpeg`, since AVPlay can only load
  a direct media URL, not a webpage. See [`resolver/README.md`](resolver/README.md).

## Hard rules

These are enforced in code review, not just convention:

- **The relay never touches media files and never calls Jellyfin.** It is
  transport only — it forwards small control/status JSON messages between
  a TV and its companions and knows nothing about media.
- **The companion never streams media through the relay.** Media flows
  Jellyfin/resolver → TV directly; only control/status JSON goes through
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
