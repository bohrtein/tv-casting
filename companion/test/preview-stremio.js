// Disposable preview of stremio.html with a synthetic addon and library, for
// manual browser checks without the home server. Nothing is downloaded or
// cast. Start with node companion/test/preview-stremio.js (port 18080).
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const browseStore = require('../browse-store')(null);

const PORT = Number(process.env.PORT) || 18080;
const ROOT = path.join(__dirname, '..');
const ORIGIN = `http://127.0.0.1:${PORT}`;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json' };
let settings = { addons: [ORIGIN + '/addon/manifest.json'], plus18: [ORIGIN + '/adult/manifest.json'] };

const month = new Date().toISOString().slice(0, 8);
const movies = ['Neon Drift', 'Signal Lost', 'The Quiet Grid', 'Paper Orbit', 'Night Shift', 'Glass Harbor', 'Low Tide', 'Wireframe',
  'Static Bloom', 'Northern Code', 'Hollow Sun', 'Last Relay', 'Cold Start', 'Deep Field', 'Echo Park', 'Soft Reset']
  .map((name, i) => ({ id: 'ttm' + i, type: 'movie', name, poster: `${ORIGIN}/art/${i}.svg?t=${encodeURIComponent(name)}`,
    background: `${ORIGIN}/art/bg${i}.svg?t=${encodeURIComponent(name)}&w=1`, releaseInfo: String(2010 + i), imdbRating: (6 + (i % 4) * 0.7).toFixed(1),
    genres: [i % 2 ? 'Drama' : 'Action', 'Sci-Fi'], runtime: 90 + i + ' min',
    description: 'A synthetic title for previewing the Stremio layout. Nothing here plays.' }));
const shows = ['Phosphor', 'Terminal City', 'The Operators', 'Green Rain'].map((name, i) => ({
  id: 'tts' + i, type: 'series', name, poster: `${ORIGIN}/art/s${i}.svg?t=${encodeURIComponent(name)}`,
  background: `${ORIGIN}/art/sbg${i}.svg?t=${encodeURIComponent(name)}&w=1`, releaseInfo: '2024-', imdbRating: '8.1', genres: ['Drama'],
  description: 'A synthetic series with two seasons.', cast: ['A. Person', 'B. Person'], director: ['C. Person'],
  videos: [1, 2].flatMap((season) => [1, 2, 3, 4, 5, 6].map((episode) => ({
    id: `tts${i}:${season}:${episode}`, season, episode, name: `Episode ${episode}`,
    released: season === 2 ? `${month}${String(episode * 4).padStart(2, '0')}T00:00:00.000Z` : '2024-01-0' + episode + 'T00:00:00.000Z',
    thumbnail: `${ORIGIN}/art/t${season}${episode}.svg?t=S${season}E${episode}&w=1` }))) }));
const adult = [{ id: 'adult1', type: 'movie', name: 'Restricted Preview', poster: `${ORIGIN}/art/a.svg?t=18%2B`, genres: ['Adult'] }];

function manifest(id, name, metas) {
  const types = [...new Set(metas.map((m) => m.type))];
  return { id, version: '1.0.0', name, description: 'Synthetic addon for previews.', types,
    resources: ['catalog', 'meta', 'stream'], idPrefixes: [...new Set(metas.map((m) => m.id.slice(0, 3)))],
    catalogs: types.flatMap((type) => [
      { type, id: 'top', name: 'Popular', extra: [{ name: 'genre', options: ['Action', 'Drama', 'Sci-Fi'] }, { name: 'skip' }] },
      { type, id: 'search', name: 'Search', extra: [{ name: 'search', isRequired: true }] }]) };
}
function addon(route, metas, info) {
  const m = /^\/(catalog|meta|stream)\/(\w+)\/([^/]+?)(?:\/(.+))?\.json$/.exec(route);
  if (route === '/manifest.json') return manifest(info[0], info[1], metas);
  if (!m) return null;
  const [, resource, type, id, extraText] = m;
  const extra = Object.fromEntries(new URLSearchParams(extraText || ''));
  if (resource === 'catalog') {
    let list = metas.filter((x) => x.type === type);
    if (extra.search) list = list.filter((x) => x.name.toLowerCase().includes(extra.search.toLowerCase()));
    if (extra.genre) list = list.filter((x) => (x.genres || []).includes(extra.genre));
    const skip = Number(extra.skip || 0);
    return { metas: list.slice(skip, skip + 10).map(({ videos, ...rest }) => rest) };
  }
  const meta = metas.find((x) => x.id === id.split(':')[0]);
  if (resource === 'meta') return { meta: meta || null };
  return { streams: [
    { url: 'https://video.example/preview.mp4', name: 'Preview\n1080p', title: 'Preview.Release.1080p.WEB-DL.x264\n💾 2.1 GB ⚙️ Example' },
    { infoHash: '0123456789abcdef0123456789abcdef01234567', fileIdx: 0, name: 'Preview\n4K', title: 'Preview.Release.2160p.HDR.x265\n👤 42 💾 18 GB' },
    { url: 'https://video.example/preview-720.mp4', name: 'Other\n720p', title: 'Preview.Release.720p' }] };
}

function library() {
  const show = shows[0];
  const ep = (season, episode, extra) => Object.assign({ kind: 'torrents', key: `s${season}e${episode}`, category: 'series',
    streamUrl: ORIGIN + '/nothing.mp4', bytes: 1.4e9, createdAt: Date.now() - 86400000 * episode, thumbUrl: show.poster,
    metadata: Object.assign({}, show, { videoId: `${show.id}:${season}:${episode}`, season, episode, episodeTitle: 'Episode ' + episode }) }, extra);
  const watched = { positionSec: 2700, durationSec: 2700, watched: true, updatedAt: Date.now() - 3600000 };
  return {
    entries: [{ kind: 'media', key: 'clip', category: 'youtube', title: 'A saved YouTube clip', thumbUrl: `${ORIGIN}/art/y.svg?t=YouTube&w=1`,
      streamUrl: ORIGIN + '/nothing.mp4', bytes: 8e7, createdAt: Date.now() - 7200000, sourceUrl: 'https://www.youtube.com/watch?v=example',
      progress: { positionSec: 120, durationSec: 600, watched: false, updatedAt: Date.now() - 7200000 } },
    { kind: 'media', key: 'clip2', category: 'youtube', title: 'A much longer YouTube video title that has to wrap onto a second line and then some more',
      thumbUrl: `${ORIGIN}/art/y2.svg?t=Video&w=1`, streamUrl: ORIGIN + '/nothing2.mp4', bytes: 3e8, createdAt: Date.now() - 86400000 * 4,
      progress: { positionSec: 3725, durationSec: 3725, watched: true, updatedAt: Date.now() - 86400000 } },
    { kind: 'media', key: 'clip3', category: 'youtube', title: 'Never played yet', thumbUrl: `${ORIGIN}/art/y3.svg?t=New&w=1`,
      streamUrl: ORIGIN + '/nothing3.mp4', bytes: 1e8, createdAt: Date.now() - 86400000 * 2 }],
    torrents: [
      Object.assign({ kind: 'torrents', key: 'movie', category: 'movies', streamUrl: ORIGIN + '/nothing.mp4', bytes: 3.2e9, height: 2160,
        needsTvCopy: false, originalUrl: ORIGIN + '/4k.m3u8', createdAt: Date.now() - 86400000 * 3, metadata: movies[1],
        progress: { positionSec: 3100, durationSec: 5400, watched: false, updatedAt: Date.now() - 86400000 } }),
      ep(1, 1, { progress: watched }), ep(1, 2, { partial: true, canResume: true, savedSec: 900, durationSec: 2700 })],
    titles: [Object.assign({}, show, { videos: show.videos.map((v) => Object.assign({}, v, {
      progress: v.id === `${show.id}:1:1` ? watched : { positionSec: 0, durationSec: 0, watched: false } })) })]
  };
}

function art(query) {
  const t = query.get('t') || '', wide = query.get('w');
  const [w, h] = wide ? [640, 360] : [300, 450];
  const hue = [...t].reduce((n, c) => n + c.charCodeAt(0), 0) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},60%,22%)"/><stop offset="1" stop-color="#000"/></linearGradient></defs>` +
    `<rect width="100%" height="100%" fill="url(#g)"/><text x="50%" y="55%" fill="#b9ffcf" font-family="monospace" font-size="${wide ? 36 : 30}" text-anchor="middle">${t.replace(/[<&]/g, '')}</text></svg>`;
}

http.createServer((req, res) => {
  const url = new URL(req.url, ORIGIN);
  const send = (status, body, type) => { res.writeHead(status, { 'Content-Type': type || 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(body); };
  if (url.pathname === '/js/config.js') {
    return send(200, 'var APP_CONFIG = ' + JSON.stringify({ RELAY_URL: 'ws://127.0.0.1:9', RECONNECT_BASE_DELAY_MS: 5000, RECONNECT_MAX_DELAY_MS: 60000,
      RESOLVER_URL: ORIGIN + '/resolver', STREMIO_ADDONS: settings.addons, STREMIO_SERVER_URL: '' }) + ';', MIME['.js']);
  }
  if (url.pathname === '/sw.js') return send(404, '');
  if (url.pathname === '/api/stremio-settings') {
    if (req.method === 'POST') { let body = ''; req.on('data', (c) => { body += c; }); req.on('end', () => { settings = JSON.parse(body); send(200, JSON.stringify(settings)); }); return; }
    return send(200, JSON.stringify(settings));
  }
  if (url.pathname === '/api/stremio-browse') return browseStore.handle(req, res);
  if (url.pathname.startsWith('/art/')) return send(200, art(url.searchParams), 'image/svg+xml');
  if (url.pathname === '/resolver/cache') return send(200, JSON.stringify(library()));
  if (url.pathname === '/resolver/jobs') return send(200, '{"jobs":[]}');
  if (url.pathname.startsWith('/resolver/')) return send(400, JSON.stringify({ error: 'The preview resolver does not download or cast.' }));
  for (const [prefix, metas, info] of [['/addon', movies.concat(shows), ['org.preview.addon', 'Preview Addon']], ['/adult', adult, ['org.preview.adult', 'Preview Adult']]]) {
    if (url.pathname.startsWith(prefix + '/')) {
      const body = addon(decodeURIComponent(url.pathname.slice(prefix.length)), metas, info);
      return body ? send(200, JSON.stringify(body)) : send(404, '{}');
    }
  }
  const file = path.join(ROOT, path.normalize(url.pathname === '/' ? '/stremio.html' : url.pathname));
  if (!file.startsWith(ROOT)) return send(403, '');
  fs.readFile(file, (err, data) => err ? send(404, '') : send(200, data, MIME[path.extname(file)] || 'application/octet-stream'));
}).listen(PORT, '127.0.0.1', () => console.log('Stremio preview: ' + ORIGIN + '/stremio.html'));
