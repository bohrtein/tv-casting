'use strict';

// Plain static file server, no framework/deps -- matches relay/ and
// resolver/'s "no dependencies beyond what the task needs" convention.
// Just serves companion/ as-is over plain http on the home LAN
// (decision #4 in PLAN.md: no TLS, LAN-only).
const http = require('http');
const fs = require('fs');
const path = require('path');

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

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://internal');
  // ?code=XXXXXX (the TV's QR payload) is handled client-side by
  // app.js reading location.search -- always serve index.html for a
  // bare path or /pair, never a 404, so that link always works.
  let reqPath = url.pathname === '/' || url.pathname === '/pair' ? '/index.html' : url.pathname;

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
