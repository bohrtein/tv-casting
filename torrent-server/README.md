# Torrent server

Streams one file of a torrent over HTTP, from inside the VPN. The
resolver reads films from it (`TORRENT_SERVER_URL`) instead of from the
Stremio server. Browsing, addons and the stream list on the companion's
Stremio page don't change; the Stremio server keeps running for the
streams that need its header proxy.

## Why

Through PIA, only a few peers answer outgoing connections. Measured on
Ember: the same tracker's peer list connected to 2 of 52 peers through
the VPN, and to 10 of 53 from the home connection. The Stremio server only
makes outgoing connections (it listens on no BitTorrent port, and has no
setting for one), so behind the VPN it usually ends up with no peers and
the cast times out.

This server listens on the port PIA forwards, so peers can connect in:
that's the part of the swarm outgoing connections can't reach. It also
uses DHT and uTP, and adds the big open trackers to whatever the addon
sent.

## What it serves

Same URL shape as the Stremio server, so the companion still builds the
URLs and the resolver only swaps the host:

| Route | |
|---|---|
| `GET`/`HEAD /<infoHash>/<fileIdx>?tr=…&f=…` | The file, with `Range` support. `-1` picks the biggest video file (the biggest one matching an `f=` pattern, if any). Waits up to `METADATA_TIMEOUT_MS` for the torrent's metadata, then answers 504 with how many peers it had. |
| `GET /<infoHash>/stats.json` | `peers`, `downloadSpeed`, `downloaded`, `progress`… The resolver reads this to explain a failure. |
| `GET /stats.json` | The forwarded port and every running torrent. |

Only the chosen file is downloaded, in order. A torrent nobody has read
from for `IDLE_MS` is dropped and its files deleted (the resolver keeps
its own copy of films it finished saving), and the data folder is
cleared on every start.

When the VPN reconnects, PIA hands out a new port. The server notices
within 30 s, exits, and systemd starts it again on the new port.

## Install (home server, once)

Needs the VPN from [`stremio-server/`](../stremio-server/README.md) set up
first, on a PIA region that supports port forwarding (Canada, Netherlands
and most of Europe do; the US regions don't).

```bash
cd ~/Desktop/github/apphub/apps/tv-casting
git pull

# The VPN unit changed: port forwarding on, port 11480 published.
sudo cp stremio-server/systemd/tv-casting-vpn.service /etc/systemd/system/
sudo cp torrent-server/systemd/tv-casting-torrent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl restart tv-casting-stremio          # restarts the VPN with the new settings
sudo systemctl enable --now tv-casting-torrent     # first start builds the image, a minute or two

# Point the resolver at it: add this line to the resolver's .env (the
# unit's EnvironmentFile; `systemctl cat tv-casting-resolver` shows where)
#   TORRENT_SERVER_URL=http://192.168.2.31:11480
sudo systemctl restart tv-casting-resolver
```

The unit builds the image from
`/home/bortein/Desktop/github/apphub/apps/tv-casting/torrent-server`.
Update that path in `tv-casting-torrent.service` if the checkout moves.

## Check it

```bash
# Forwarded port from PIA, and what's running
curl -s http://192.168.2.31:11480/stats.json; echo
journalctl -u tv-casting-torrent -n 20 --no-pager
```

`forwardedPort` should be a number. If it's `null`, the log says it
gave up waiting for one: check `journalctl -u tv-casting-vpn` for
`port forwarded is …`, and that the region supports port forwarding.

## Settings

Environment variables (set with `-e` in the unit):

| Variable | Default | |
|---|---|---|
| `PORT` | `11480` | HTTP port. Also published by the VPN unit. |
| `PORT_FILE` | `/gluetun/forwarded_port` | Where gluetun writes the forwarded port. |
| `PORT_WAIT_MS` | `90000` | How long to wait for that port at startup before running without one. |
| `METADATA_TIMEOUT_MS` | `170000` | How long a request waits for the torrent's metadata. Under the resolver's 180 s. |
| `IDLE_MS` | `600000` | A torrent unused this long is dropped with its files. |
| `MAX_CONNS` | `100` | Peer connections per torrent. |
| `DATA_DIR` | `/data` | Downloads, deleted when idle and on start. |

Run it outside Docker with `npm install && npm start` (Node 22+); it then
keeps downloads in `torrent-server/data/` and, without a port file, makes
outgoing connections only.
