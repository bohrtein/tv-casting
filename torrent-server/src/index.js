// Streams one file of a torrent over HTTP, from inside the VPN. Same URL
// shape as Stremio's streaming server (<infoHash>/<fileIdx>?tr=...), so
// the resolver can read from either; see README.md for why this exists.
//
//   GET|HEAD /<infoHash>/<fileIdx>   the file, with Range support. -1
//                                    picks the biggest file (or the
//                                    biggest one matching an f= param)
//   GET /<infoHash>/stats.json       peers, speed, progress
//   GET /stats.json                  the forwarded port + what's running
//
// Unlike the Stremio server it listens for incoming peers, on the port
// the VPN forwards (gluetun writes it to PORT_FILE). Through a VPN only
// a few peers answer outgoing connections, so the ones connecting in are
// most of the swarm.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import WebTorrent from 'webtorrent';

const PORT = parseInt(process.env.PORT || '11480', 10);
const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
const PORT_FILE = process.env.PORT_FILE || '/gluetun/forwarded_port';
// How long to wait at startup for the VPN to hand out a port before
// running without one (outgoing connections only, like the Stremio server).
const PORT_WAIT_MS = parseInt(process.env.PORT_WAIT_MS || '90000', 10);
// A request waits this long for the torrent's metadata. Under the
// resolver's own 180s, so the resolver gets our error, not a timeout.
const METADATA_TIMEOUT_MS = parseInt(process.env.METADATA_TIMEOUT_MS || '170000', 10);
// A torrent nobody has read from for this long is dropped, with its
// files: the resolver keeps its own copy of what it finished saving.
const IDLE_MS = parseInt(process.env.IDLE_MS || '600000', 10);
const MAX_CONNS = parseInt(process.env.MAX_CONNS || '100', 10);

// Added to whatever trackers the addon sent: addons often send a short
// or stale list, and these are the big open ones that are still up.
const DEFAULT_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://explodie.org:6969/announce',
  'udp://tracker.dler.org:6969/announce',
  'udp://tracker.qu.ax:6969/announce',
  'https://tracker.opentrackr.org:443/announce'
];

const VIDEO_EXT = /\.(mkv|mp4|m4v|avi|mov|wmv|ts|m2ts|webm|mpg|mpeg|flv)$/i;
const MIME = {
  mkv: 'video/x-matroska', mp4: 'video/mp4', m4v: 'video/mp4', avi: 'video/x-msvideo',
  mov: 'video/quicktime', webm: 'video/webm', ts: 'video/mp2t', m2ts: 'video/mp2t',
  mpg: 'video/mpeg', mpeg: 'video/mpeg', wmv: 'video/x-ms-wmv', flv: 'video/x-flv'
};

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function readForwardedPort() {
  try {
    const n = parseInt(fs.readFileSync(PORT_FILE, 'utf8').trim().split(/\s+/)[0], 10);
    return n > 0 && n < 65536 ? n : null;
  } catch (e) {
    return null;
  }
}

async function waitForForwardedPort() {
  const until = Date.now() + PORT_WAIT_MS;
  for (;;) {
    const port = readForwardedPort();
    if (port || Date.now() >= until) return port;
    await new Promise((r) => setTimeout(r, 2000));
  }
}

const forwardedPort = await waitForForwardedPort();
if (forwardedPort) {
  log(`peers can connect in on forwarded port ${forwardedPort}`);
} else {
  log(`no forwarded port in ${PORT_FILE} after ${PORT_WAIT_MS / 1000}s; outgoing connections only`);
}

// The VPN hands out a new port when it reconnects. The old one stops
// working, and the client can't move ports while running, so exit and
// let systemd start us again on the new one.
setInterval(() => {
  const now = readForwardedPort();
  if (now && now !== forwardedPort) {
    log(`forwarded port changed ${forwardedPort} -> ${now}; restarting`);
    process.exit(0);
  }
}, 30000).unref();

// Nothing survives a restart (see IDLE_MS), so whatever is left in
// DATA_DIR is from before one, and would only fill the disk.
// Only its contents: in Docker DATA_DIR is a volume's mount point, and
// that can't be removed itself.
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.readdirSync(DATA_DIR).forEach((name) => {
  fs.rmSync(path.join(DATA_DIR, name), { recursive: true, force: true });
});

// No UPnP/NAT-PMP: there's no router inside the VPN to ask, the
// forwarded port is already open.
const client = new WebTorrent({
  torrentPort: forwardedPort || 0,
  maxConns: MAX_CONNS,
  natUpnp: false,
  natPmp: false
});
client.on('error', (err) => log('client error:', err.message));

// infoHash -> { torrent, active, lastUsed }
const entries = new Map();

function trackersFrom(params) {
  const list = [];
  params.getAll('tr').forEach((t) => {
    const url = t.replace(/^tracker:/, '');
    if (/^(udp|https?|wss?):\/\//i.test(url)) list.push(url);
  });
  DEFAULT_TRACKERS.forEach((t) => { if (!list.includes(t)) list.push(t); });
  return list;
}

function getEntry(infoHash, params) {
  let entry = entries.get(infoHash);
  if (entry) return entry;
  const magnet = `magnet:?xt=urn:btih:${infoHash}` +
    trackersFrom(params).map((t) => `&tr=${encodeURIComponent(t)}`).join('');
  const torrent = client.add(magnet, {
    path: path.join(DATA_DIR, infoHash),
    deselect: true,
    destroyStoreOnDestroy: true
  });
  entry = { torrent, active: 0, lastUsed: Date.now() };
  entries.set(infoHash, entry);
  torrent.on('error', (err) => {
    log('torrent error', infoHash, err.message);
    entries.delete(infoHash);
  });
  torrent.once('ready', () => log('metadata', infoHash, torrent.name, `${torrent.files.length} files`));
  log('added', infoHash);
  return entry;
}

function whenReady(torrent) {
  if (torrent.ready) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`no metadata after ${METADATA_TIMEOUT_MS / 1000}s (${torrent.numPeers} peers)`));
    }, METADATA_TIMEOUT_MS);
    function onReady() { cleanup(); resolve(); }
    function onError(err) { cleanup(); reject(err); }
    function cleanup() {
      clearTimeout(timer);
      torrent.removeListener('ready', onReady);
      torrent.removeListener('error', onError);
    }
    torrent.once('ready', onReady);
    torrent.once('error', onError);
  });
}

// fileMustInclude (f=) comes from Stremio addons as patterns such as
// "S01E02"; treat each as a case-insensitive regex, falling back to a
// plain substring when it isn't valid regex.
function matcher(pattern) {
  try {
    const re = new RegExp(pattern, 'i');
    return (name) => re.test(name);
  } catch (e) {
    const needle = pattern.toLowerCase();
    return (name) => name.toLowerCase().includes(needle);
  }
}

function pickFile(torrent, idx, mustInclude) {
  if (idx >= 0) return torrent.files[idx] || null;
  let candidates = torrent.files;
  if (mustInclude.length) {
    const tests = mustInclude.map(matcher);
    const matching = candidates.filter((f) => tests.some((t) => t(f.path)));
    if (matching.length) candidates = matching;
  }
  const videos = candidates.filter((f) => VIDEO_EXT.test(f.name));
  if (videos.length) candidates = videos;
  return candidates.reduce((best, f) => (!best || f.length > best.length ? f : best), null);
}

function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header || '');
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start;
  let end;
  if (m[1] === '') {
    start = Math.max(0, size - parseInt(m[2], 10));
    end = size - 1;
  } else {
    start = parseInt(m[1], 10);
    end = m[2] === '' ? size - 1 : Math.min(parseInt(m[2], 10), size - 1);
  }
  return start <= end && start < size ? { start, end } : 'invalid';
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(body));
}

function torrentStats(infoHash, entry) {
  const t = entry.torrent;
  // Which way each connected peer came: incoming ones found us through
  // the forwarded port, so they show whether it's doing its job.
  const incoming = t.wires.filter((w) => /Incoming/.test(w.type || '')).length;
  return {
    infoHash,
    name: t.name || null,
    ready: t.ready,
    peers: t.numPeers,
    incoming,
    outgoing: t.numPeers - incoming,
    // Addresses heard of (trackers, DHT, peer exchange), connected or not.
    // Private in webtorrent, hence the fallback.
    knownPeers: typeof t._peersLength === 'number' ? t._peersLength : null,
    downloadSpeed: Math.round(t.downloadSpeed),
    uploadSpeed: Math.round(t.uploadSpeed),
    downloaded: t.downloaded,
    progress: t.progress,
    activeStreams: entry.active,
    forwardedPort
  };
}

async function serveFile(req, res, infoHash, idx, params) {
  const entry = getEntry(infoHash, params);
  entry.active++;
  entry.lastUsed = Date.now();
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    entry.active--;
    entry.lastUsed = Date.now();
  };
  res.on('close', release);

  try {
    await whenReady(entry.torrent);
  } catch (err) {
    release();
    if (!res.headersSent) sendJson(res, 504, { error: err.message });
    return;
  }
  if (res.destroyed) return;

  const file = pickFile(entry.torrent, idx, params.getAll('f'));
  if (!file) {
    sendJson(res, 404, { error: `no file ${idx} in that torrent` });
    return;
  }
  file.select();

  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const headers = {
    'Accept-Ranges': 'bytes',
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Access-Control-Allow-Origin': '*'
  };
  const range = parseRange(req.headers.range, file.length);
  if (range === 'invalid') {
    res.writeHead(416, { 'Content-Range': `bytes */${file.length}` });
    res.end();
    return;
  }
  const start = range ? range.start : 0;
  const end = range ? range.end : file.length - 1;
  headers['Content-Length'] = end - start + 1;
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${file.length}`;
  res.writeHead(range ? 206 : 200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  const stream = file.createReadStream({ start, end });
  stream.on('error', (err) => {
    log('stream error', infoHash, err.message);
    res.destroy();
  });
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { error: 'GET or HEAD only' });
    return;
  }
  if (url.pathname === '/stats.json') {
    sendJson(res, 200, {
      forwardedPort,
      listeningPort: client.torrentPort || null,
      torrents: [...entries].map(([hash, e]) => torrentStats(hash, e))
    });
    return;
  }
  let m = /^\/([0-9a-f]{40})\/stats\.json$/i.exec(url.pathname);
  if (m) {
    const entry = entries.get(m[1].toLowerCase());
    if (!entry) sendJson(res, 404, { error: 'not running' });
    else sendJson(res, 200, torrentStats(m[1].toLowerCase(), entry));
    return;
  }
  m = /^\/([0-9a-f]{40})\/(-1|\d+)$/i.exec(url.pathname);
  if (m) {
    serveFile(req, res, m[1].toLowerCase(), parseInt(m[2], 10), url.searchParams).catch((err) => {
      log('request failed', m[1], err.message);
      if (!res.headersSent) sendJson(res, 500, { error: err.message });
      else res.destroy();
    });
    return;
  }
  sendJson(res, 404, { error: 'not found' });
});

// Dropped when idle, files and all.
setInterval(() => {
  const now = Date.now();
  entries.forEach((entry, infoHash) => {
    if (entry.active > 0 || now - entry.lastUsed < IDLE_MS) return;
    entries.delete(infoHash);
    entry.torrent.destroy({ destroyStore: true });
    log('dropped idle torrent', infoHash);
  });
}, 60000).unref();

server.listen(PORT, () => log(`torrent server on :${PORT}, data in ${DATA_DIR}`));

function shutdown() {
  server.close();
  client.destroy(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
