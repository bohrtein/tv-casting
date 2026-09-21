# TV Casting

A home-network "cast to TV" system for Jellyfin, built as three
independent pieces in one repo. Full background and open decisions live
in [PLAN.md](PLAN.md).

## Pieces

- **[`relay/`](relay/)** — Node.js + `ws` server that runs on the home
  Ubuntu server (alongside the app-launcher hub). No pairing — it tracks
  at most one connected TV and any number of companions, and forwards
  `play`/`pause`/`stop`/`status` JSON messages between them. See
  [`relay/PROTOCOL.md`](relay/PROTOCOL.md) for the exact message schema.
- **[`tv-receiver/`](tv-receiver/)** — Samsung Tizen app (HTML/CSS/JS +
  AVPlay). Connects to the relay on boot, plays whatever direct stream
  URL it's sent, and reports playback status back through the relay.
- **[`companion/`](companion/)** — Phone/desktop PWA. Talks to Jellyfin
  directly for library browsing and to obtain stream URLs, and accepts
  direct media URLs (`.mp4`, `.m3u8`) pasted straight in. Connects to the
  relay automatically on load to send play/pause/stop commands and
  receive status. Styled with the
  [Matrix](https://github.com/bohrtein/matrix_design) design system
  (`matrix.css`, `matrix.js`, `fonts/`, vendored in this folder).

## Hard rules

These are enforced in code review, not just convention:

- **The relay never touches media files and never calls Jellyfin.** It is
  transport only — it forwards small control/status JSON messages between
  a TV and its companions and knows nothing about media.
- **The companion never streams media through the relay.** Media flows
  Jellyfin/direct host → TV directly; only control/status JSON goes
  through the relay.
- **No media scraping, stream ripping, web-page extraction, or
  re-encoding services.** The companion only ever hands the TV a URL the
  user already has (a Jellyfin stream endpoint, or a direct `.mp4`/`.m3u8`
  link they paste in) — nothing is downloaded, decrypted, or re-encoded,
  and nothing is saved to disk.

## Deployment (Ubuntu server, alongside [app-launcher hub](https://github.com/bohrtein/apphub))

- **`relay/` runs as its own always-on systemd service**
  (`relay/systemd/tv-casting-relay.service`), independent of the
  app-launcher hub's own on-demand process management. It's not a fit for
  it: the hub only starts an app when its dashboard is used and stops it
  after proxied-traffic idle time, but the TV and phone companions talk
  to relay over WebSocket on its own fixed port, never through the hub's
  proxy -- so the hub would have no way to see it's actually in use, and
  relay has to be up even when nobody has App Hub open at all. The unit
  assumes `/opt/tv-casting/relay` and the hub's own `apphub` service
  account -- copy to `/etc/systemd/system/`, `daemon-reload`,
  `enable --now`, same as `apphub.service` itself.
- **`companion/` is registered with the app-launcher hub** as an on-demand
  app via its **+ Import from GitHub** page -- this repo's root
  [`app.toml`](app.toml) points the hub at `node companion/serve.js`, so
  importing `tv-casting` there launches/stops/health-checks just the
  companion PWA like any other app-launcher app. It's a clean fit (small
  static assets, no persistent connection) unlike relay above. Reaching
  it then goes through the hub's own login (password + TOTP) first, same
  as every other app-launcher app.
- `companion/js/config.js`'s `RELAY_URL` still points straight at relay's
  own LAN host:port either way -- being proxied by the hub only changes
  how you reach the companion page itself, not how the two pieces talk to
  each other.

## Status

See the "Current status" section at the bottom of [PLAN.md](PLAN.md).
