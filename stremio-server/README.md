# Stremio server

Stremio's own streaming server ([`stremio/server`](https://github.com/Stremio/server-docker)
in Docker), which the companion's Stremio page uses for torrent streams
and header-proxied links. It turns those into plain `http://<host>:11470/…`
URLs the TV fetches itself. Nothing in this repo runs inside it; this
folder only holds the systemd unit that runs it on the home server, so
App Hub's **Developer Tools** can start, stop, restart and show logs for it
like relay and resolver.

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

sudo cp stremio-server/systemd/tv-casting-stremio.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now tv-casting-stremio   # first start pulls the image
```

Then add it to App Hub's Developer Tools: App Hub's `devtools.toml` lists
it as `tv-casting-stremio` (with `stoppable = true`), and its sudoers rule
needs these three extra entries (see App Hub's README, "Developer Tools"):

```
/usr/bin/systemctl restart --no-block tv-casting-stremio, /usr/bin/systemctl start --no-block tv-casting-stremio, /usr/bin/systemctl stop --no-block tv-casting-stremio
```

## Using it

- **Start / Stop** in Developer Tools. Stopping it frees the bandwidth and
  disk a torrent keeps using after you stop watching. Direct-link streams
  and YouTube don't need it.
- **Restart** pulls the newest `stremio/server` image first, so it's also
  the update button.
- **Logs** in Developer Tools, under services → Stremio Server (it's the
  unit's journal).

`enable` makes it start on boot. If you'd rather it only run when you
switch it on, `sudo systemctl disable tv-casting-stremio` and use Start in
Developer Tools each time.
