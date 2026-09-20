'use strict';

// Plain static file server, no framework/deps -- matches relay/ and
// resolver/'s "no dependencies beyond what the task needs" convention.
// Just serves companion/ as-is over plain http on the home LAN
// (decision #4 in PLAN.md: no TLS, LAN-only).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8'
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

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://internal');
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
