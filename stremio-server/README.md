# Stremio server

Stremio's own streaming server ([`stremio/server`](https://github.com/Stremio/server-docker)
in Docker), which the companion's Stremio page uses for torrent streams
and header-proxied links. It turns those into plain `http://<host>:11470/…`
URLs the TV fetches itself. Nothing in this repo runs inside it; this
folder only holds the systemd units that run it on the home server, so
App Hub's **Developer Tools** can start, stop, restart and show logs for it
like relay and resolver.

All of its internet traffic goes through a VPN (PIA, via
[gluetun](https://github.com/qdm12/gluetun)), so torrent peers see the
VPN's IP, never the home one. Two units:

- `tv-casting-vpn` runs gluetun. It never runs on its own: the Stremio
  server starts it, and it stops and restarts with it.
- `tv-casting-stremio` runs the Stremio server inside gluetun's network.
  It waits for the VPN to connect first, and stops if the VPN container
  stops. gluetun's firewall only lets traffic out through the tunnel, so
  when the VPN drops, torrents stop instead of leaking the home IP.

It isn't an App Hub app (`app.toml`) for the same reason relay and
resolver aren't: the TV talks to port 11470 directly, never through the
hub's proxy, so the hub's idle timer would stop it mid-film.

## Install (Ubuntu server, once)

```bash
sudo apt install -y docker.io          # skip if Docker is already there
sudo systemctl enable --now docker

# If you started it by hand earlier with `docker run -d ...`, remove that
# container; the unit runs its own.
sudo docker rm -f stremio-server 2>/dev/null

# PIA login: fill in OPENVPN_USER / OPENVPN_PASSWORD / SERVER_REGIONS.
sudo mkdir -p /etc/tv-casting
sudo cp stremio-server/vpn.env.example /etc/tv-casting/vpn.env
sudo nano /etc/tv-casting/vpn.env
sudo chmod 600 /etc/tv-casting/vpn.env

sudo cp stremio-server/systemd/tv-casting-vpn.service \
        stremio-server/systemd/tv-casting-stremio.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now tv-casting-stremio   # also starts the VPN; first start pulls both images
```

Then add it to App Hub's Developer Tools: App Hub's `devtools.toml` lists
it as `tv-casting-stremio` (with `stoppable = true`), and its sudoers rule
needs these three extra entries (see App Hub's README, "Developer Tools"):

```
/usr/bin/systemctl restart --no-block tv-casting-stremio, /usr/bin/systemctl start --no-block tv-casting-stremio, /usr/bin/systemctl stop --no-block tv-casting-stremio
```

The VPN unit needs no entries of its own: controlling `tv-casting-stremio`
controls it too.

## Check the VPN is working

```bash
# The IP the Stremio server shows to the internet. Must NOT be your home IP.
sudo docker exec tv-casting-vpn wget -qO- https://ipinfo.io/ip; echo
# Your home IP, to compare:
curl -s https://ipinfo.io/ip; echo

# gluetun's own log: look for "Public IP address is ..." and "healthy".
journalctl -u tv-casting-vpn -n 50
```

If the Stremio server doesn't start, `journalctl -u tv-casting-vpn` almost
always says why. A wrong PIA username/password shows as `AUTH_FAILED`, and
a wrong region name lists the valid ones. You can also print the valid
region names with
`sudo docker run --rm qmcgaw/gluetun format-servers -private-internet-access`.

PIA's port forwarding isn't turned on. It only helps a torrent client
that can be told which port to listen on, and it isn't confirmed that
the Stremio server supports that. Torrents work without it, but less popular
ones may find fewer peers.

## Using it

- **Start / Stop** in Developer Tools. Stopping it frees the bandwidth and
  disk a torrent keeps using after you stop watching. Direct-link streams
  and YouTube don't need it.
- **Restart** pulls the newest `stremio/server` and gluetun images first,
  so it's also the update button.
- **Logs** in Developer Tools, under services → Stremio Server (it's the
  unit's journal). The VPN's own log is `journalctl -u tv-casting-vpn`.

`enable` makes it start on boot. If you'd rather it only run when you
switch it on, `sudo systemctl disable tv-casting-stremio` and use Start in
Developer Tools each time.
