'use strict';

// Plain static file server, no framework/deps -- matches relay/ and
// resolver/'s "no dependencies beyond what the task needs" convention.
// Just serves companion/ as-is over plain http on the home LAN
// (decision #4 in PLAN.md: no TLS, LAN-only).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const createBrowseStore = require('./browse-store');

const PORT = process.env.PORT || 8080;
const ROOT = __dirname;

// stremio.html's addon list, kept here instead of only in each browser's
// localStorage so the computer and the phone see the same addons. Lives
// outside ROOT so the static handler below can never serve or overwrite
// it by path.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '.companion-data');
const STREMIO_SETTINGS_FILE = path.join(DATA_DIR, 'stremio-settings.json');
const MAX_BODY_BYTES = 64 * 1024;
// Board/Discover/Search results shared by every device (browse-store.js).
const browseStore = createBrowseStore(path.join(DATA_DIR, 'stremio-browse-cache.json'));
const MAX_ADDONS = 100;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm'
};

// sw.js hardcodes __CACHE_VERSION__ as a placeholder; fill it in here
// with a hash of the actual shell files' contents so the cache name
// changes exactly when a shell file changes, instead of relying on
// someone to remember to bump it (see: activity tab going stale/missing
// for anyone with an old service worker installed).
function serveServiceWorker(res) {
  const swPath = path.join(ROOT, 'sw.js');
  fs.readFile(swPath, 'utf8', (err, source) => {
    if (err) {
      res.writeHead(404);
      res.end();
      return;
    }
    const match = /SHELL_FILES\s*=\s*\[([\s\S]*?)\]/.exec(source);
    const files = match
      ? match[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
      : [];
    const hash = crypto.createHash('sha256');
    files.forEach((f) => {
      const rel = f === './' ? 'index.html' : f;
      try {
        hash.update(fs.readFileSync(path.join(ROOT, rel)));
      } catch (e) {
        // Missing file -- still fold its name in so a rename/removal
        // changes the hash rather than silently keeping the old one.
        hash.update(rel);
      }
    });
    const version = hash.digest('hex').slice(0, 10);
    // Global replace: sw.js's own comment about this placeholder also
    // contains the literal token, and a plain (non-regex) replace only
    // touches the first occurrence.
    const body = source.replace(/__CACHE_VERSION__/g, version);
    res.writeHead(200, {
      'Content-Type': MIME['.js'],
      // The service worker script itself must never be cached by the
      // browser's HTTP cache -- that's a second place staleness could
      // hide behind, on top of the Cache Storage sw.js manages itself.
      'Cache-Control': 'no-cache'
    });
    res.end(body);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readStremioSettings() {
  try {
    const saved = JSON.parse(fs.readFileSync(STREMIO_SETTINGS_FILE, 'utf8'));
    return { addons: Array.isArray(saved.addons) ? saved.addons : null,
      plus18: Array.isArray(saved.plus18) ? saved.plus18 : [] };
  } catch (e) {
    // Nothing saved yet (or a corrupt file): null tells the page to seed
    // it from its own list rather than wipe that list out.
    return { addons: null, plus18: [] };
  }
}

// GET returns { addons: [manifest urls] | null }; POST replaces the list
// with { addons: [...] }. Whole-list replace, last write wins -- the page
// re-reads right before every change, and there's one household of users.
function handleStremioSettings(req, res) {
  if (req.method === 'GET') {
    sendJson(res, 200, readStremioSettings());
    return;
  }
  if (req.method !== 'POST') {
    res.writeHead(405, { Allow: 'GET, POST' });
    res.end();
    return;
  }
  let size = 0;
  const chunks = [];
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      sendJson(res, 413, { error: 'too large' });
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (size > MAX_BODY_BYTES) return;
    let addons, plus18;
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      addons = body.addons;
      // Older companion pages still POST only addons; keep the other section.
      plus18 = body.plus18 === undefined ? readStremioSettings().plus18 : body.plus18;
    } catch (e) {
      sendJson(res, 400, { error: 'body must be JSON' });
      return;
    }
    const validList = (list) => Array.isArray(list) && list.length <= MAX_ADDONS &&
      list.every((u) => typeof u === 'string' && /^https?:\/\/\S+$/i.test(u) && u.length <= 2048);
    const valid = validList(addons) && validList(plus18);
    if (!valid) {
      sendJson(res, 400, { error: 'addons must be a list of http(s) URLs' });
      return;
    }
    // Write-then-rename so a crash mid-write can't leave half a file.
    const tmp = STREMIO_SETTINGS_FILE + '.tmp';
    fs.mkdir(DATA_DIR, { recursive: true }, (mkErr) => {
      if (mkErr) return sendJson(res, 500, { error: mkErr.message });
      fs.writeFile(tmp, JSON.stringify({ addons, plus18 }, null, 2), (wErr) => {
        if (wErr) return sendJson(res, 500, { error: wErr.message });
        fs.rename(tmp, STREMIO_SETTINGS_FILE, (rErr) => {
          if (rErr) return sendJson(res, 500, { error: rErr.message });
          sendJson(res, 200, { addons, plus18 });
        });
      });
    });
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://internal');
  if (url.pathname === '/js/config.js' && (process.env.RELAY_URL || process.env.RESOLVER_URL)) {
    let config = fs.readFileSync(path.join(ROOT, 'js/config.js'), 'utf8');
    for (const key of ['RELAY_URL', 'RESOLVER_URL']) if (process.env[key]) config += '\nAPP_CONFIG.' + key + ' = ' + JSON.stringify(process.env[key]) + ';';
    res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-store' }); res.end(config); return;
  }
  if (url.pathname === '/js/playback-history.js') {
    res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-cache' });
    res.end(fs.readFileSync(path.join(ROOT, '../tv-receiver/js/playback-history.js'))); return;
  }
  if (url.pathname === '/api/stremio-settings') {
    handleStremioSettings(req, res);
    return;
  }
  if (url.pathname === '/api/stremio-browse') {
    browseStore.handle(req, res);
    return;
  }
  if (url.pathname === '/sw.js') {
    serveServiceWorker(res);
    return;
  }
  let reqPath = url.pathname === '/' ? '/index.html' : url.pathname;

  const filePath = path.join(ROOT, path.normalize(reqPath).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end();
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(new Date().toISOString(), `companion served on :${PORT}`);
});
