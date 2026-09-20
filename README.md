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

## Status

See the "Current status" section at the bottom of [PLAN.md](PLAN.md).
