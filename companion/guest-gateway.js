'use strict';

// The guest door: a second listener for people with an account
// (accounts.js), meant to be put on the internet with Tailscale Funnel.
// You keep using the normal listener with no login; everything here needs
// one, and is narrowed to what a guest may do:
//
// - Board, Discover, Search and Library for Movies and Series only: no
//   Plus18, no addons or settings changes, no tools, and never your TV or
//   relay. They cast only to their own receiver pages (guest-cast.js).
// - Their own library. Saving downloads onto the server as usual (or
//   reuses the file if it's already there) and adds it to their list;
//   removing only takes it off their list, the file stays.
// - Their own watch progress, kept here, so yours on the resolver is
//   never touched.
//
// The resolver is reached only through the routes below, each checked
// against the person's library, and a guest can't make the server fetch
// an address of its choosing: torrents always go to your own Stremio
// server and links to private-network addresses are refused.
const fs = require('fs');
const path = require('path');
const http = require('http');
const dns = require('dns').promises;
const net = require('net');
const { createGuestCast } = require('./guest-cast');
const ContentPolicy = require('./js/content-policy');

const COOKIE = 'tvc_guest';
const MAX_BODY = 4 * 1024 * 1024;
const FOLLOW_MS = 3000;
const FOLLOW_FOR_MS = 12 * 60 * 60 * 1000;
const GUEST_TYPES = ['movie', 'series'];

// Pages and files a guest's browser may load. Everything else in the
// companion folder (tools, the receiver, the server's own code) is not
// served here at all.
const OPEN_FILES = /^\/(login\.html|icon-(192|512)\.png|manifest\.webmanifest|css\/[\w.-]+\.css|matrix\/[\w./-]+\.(css|js|ttf|txt|json))$/;
const PAGE_FILES = /^\/(stremio\.html|receiver\.html|js\/[\w.-]+\.js|vendor\/[\w./-]+\.(js|wasm))$/;

function createGuestGateway(opts) {
  const { accounts, root, mime, browseStore, readStremioSettings } = opts;
  const readAirplaySettings = opts.readAirplaySettings || (() => ({ publicUrl: '' }));
  const resolver = new URL(opts.resolverUrl || 'http://127.0.0.1:8788');
  const stremioServer = String(opts.stremioServerUrl || 'http://127.0.0.1:11470').replace(/\/+$/, '');
  const receiverDir = opts.receiverDir;
  const following = new Map();
  const cast = createGuestCast();

  // --- small helpers -------------------------------------------------

  function sendJson(res, status, body, headers) {
    res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, headers));
    res.end(JSON.stringify(body));
  }
  function readBody(req, limit) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > limit) { reject(new Error('Too large.')); req.destroy(); return; }
        chunks.push(chunk);
      });
      req.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
        catch (_) { reject(new Error('Body must be JSON.')); }
      });
      req.on('error', reject);
    });
  }
  function cookieToken(req) {
    const match = new RegExp('(?:^|;\\s*)' + COOKIE + '=([^;]+)').exec(req.headers.cookie || '');
    return match ? decodeURIComponent(match[1]) : '';
  }
  function clientKey(req) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    return forwarded || req.socket.remoteAddress || '';
  }
  // Another site's page can't post here with the guest's cookie.
  function sameOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return true;
    try { return new URL(origin).host === req.headers.host; } catch (_) { return false; }
  }

  // One request to the resolver. The guest's Host goes along, so the
  // URLs it builds point back at this door.
  function toResolver(req, method, pathname, body) {
    return new Promise((resolve, reject) => {
      const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
      const headers = { host: req ? req.headers.host : resolver.host, accept: 'application/json' };
      if (data) { headers['content-type'] = 'application/json'; headers['content-length'] = data.length; }
      const up = http.request({ hostname: resolver.hostname, port: resolver.port, method, path: pathname, headers }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_) {}
          resolve({ status: res.statusCode, json });
        });
      });
      up.on('error', reject);
      if (data) up.write(data);
      up.end();
    });
  }
  // A media file, streamed straight through (ranges and all).
  function pipeFromResolver(req, res, pathname) {
    const headers = { host: req.headers.host };
    if (req.headers.range) headers.range = req.headers.range;
    const up = http.request({ hostname: resolver.hostname, port: resolver.port, method: 'GET', path: pathname, headers }, (upRes) => {
      const pass = {};
      ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control'].forEach((h) => {
        if (upRes.headers[h]) pass[h] = upRes.headers[h];
      });
      res.writeHead(upRes.statusCode, pass);
      upRes.pipe(res);
    });
    up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.on('close', () => up.destroy());
    up.end();
  }

  // "/media/..." (any prefix before it) -> the library item it belongs to.
  function itemOf(url) {
    let pathname = String(url || '');
    try { pathname = new URL(pathname, 'http://x').pathname; } catch (_) { return null; }
    const at = pathname.indexOf('/media/');
    if (at === -1) return null;
    const rest = pathname.slice(at);
    let m = /^\/media\/([0-9a-f]{16}\.mp4)$/.exec(rest);
    if (m) return 'media:' + m[1];
    m = /^\/media\/torrents\/([0-9a-f]{40}-(?:-1|\d+))\/(?:original\/)?(?:index\.m3u8|seg\d{5}\.ts)$/.exec(rest);
    return m ? 'torrents:' + m[1] : null;
  }

  // Refuse links that lead into the home network (or this machine).
  function privateAddress(address) {
    if (net.isIPv4(address)) {
      const [a, b] = address.split('.').map(Number);
      return a === 10 || a === 127 || a === 0 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 ||
        a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127;
    }
    const lower = address.toLowerCase();
    if (lower.startsWith('::ffff:')) return privateAddress(lower.slice(7));
    return lower === '::' || lower === '::1' || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower);
  }
  async function publicLink(value) {
    let url;
    try { url = new URL(value); } catch (_) { return false; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(host)) return !privateAddress(host);
    try {
      const found = await dns.lookup(host, { all: true });
      return found.length > 0 && found.every((a) => !privateAddress(a.address));
    } catch (_) { return false; }
  }

  // --- downloads a guest started ----------------------------------------

  // Watch a download on the server until it can play, then add it to the
  // person's library, whether or not their page is still open.
  function follow(name, id, started = Date.now()) {
    const key = name + '|' + id;
    if (following.has(key)) return;
    following.set(key, true);
    const tick = () => {
      toResolver(null, 'GET', '/resolve/' + encodeURIComponent(id)).then(({ status, json }) => {
        if (status === 404 || !json) { accounts.dropJob(name, id); following.delete(key); return; }
        if (json.status === 'ready' && json.streamUrl) {
          const item = itemOf(json.streamUrl);
          try { if (item) accounts.add(name, item); } catch (_) { /* account removed meanwhile */ }
          try { accounts.dropJob(name, id); } catch (_) {}
          following.delete(key);
          return;
        }
        if (json.status === 'error' || json.status === 'cancelled' || Date.now() - started > FOLLOW_FOR_MS) {
          try { accounts.dropJob(name, id); } catch (_) {}
          following.delete(key);
          return;
        }
        setTimeout(tick, FOLLOW_MS).unref();
      }, () => setTimeout(tick, FOLLOW_MS * 5).unref());
    };
    tick();
  }
  // Pick up where we left off after a restart.
  accounts.list().forEach((u) => accounts.jobs(u.name).forEach((id) => follow(u.name, id)));

  // --- the guest's view of the library ------------------------------------

  function allowedEntry(entry) {
    return entry && !ContentPolicy.restricted(entry) &&
      (!entry.metadata || GUEST_TYPES.indexOf(entry.metadata.type) !== -1);
  }
  function titleKey(m) { return JSON.stringify([m.type, m.addon || '', m.id]); }
  // The resolver's /cache names every saved file by "key"; its torrents
  // have no fileName at all.
  function fileOf(entry) { return entry.key || entry.fileName; }

  // The resolver's library, cut down to this person's items, with their
  // own progress in place of yours.
  function guestLibrary(name, snapshot) {
    const own = (kind, entry) => accounts.has(name, kind + ':' + fileOf(entry)) && allowedEntry(entry);
    const clean = (kind) => (entry) => {
      const item = kind + ':' + fileOf(entry);
      const copy = Object.assign({}, entry, { progress: accounts.progress(name, item) });
      delete copy.sourceUrl;
      return copy;
    };
    const entries = (snapshot.entries || []).filter((e) => own('media', e)).map(clean('media'));
    const torrents = (snapshot.torrents || []).filter((e) => own('torrents', e)).map(clean('torrents'));
    const mine = entries.concat(torrents);
    const episodeProgress = {};
    mine.forEach((e) => { if (e.metadata && e.metadata.videoId) episodeProgress[titleKey(e.metadata) + e.metadata.videoId] = e.progress; });
    const wanted = new Set(mine.filter((e) => e.metadata).map((e) => titleKey(e.metadata)));
    const titles = (snapshot.titles || []).filter((m) => wanted.has(titleKey(m))).map((m) => Object.assign({}, m, {
      videos: (m.videos || []).map((v) => Object.assign({}, v, {
        progress: episodeProgress[titleKey(m) + v.id] || { positionSec: 0, durationSec: 0, watched: false }
      }))
    }));
    return { entries, torrents, titles };
  }

  // The next saved episode in this person's library, if any.
  function nextEpisode(name, item, snapshot) {
    const lib = guestLibrary(name, snapshot);
    const all = lib.entries.map((e) => ['media:' + fileOf(e), e]).concat(lib.torrents.map((e) => ['torrents:' + fileOf(e), e]));
    const current = all.find(([key]) => key === item);
    const m = current && current[1].metadata;
    if (!m || m.type !== 'series' || !m.season) return null;
    const after = all.filter(([, e]) => e.metadata && titleKey(e.metadata) === titleKey(m) && !e.partial &&
      (e.metadata.season > m.season || e.metadata.season === m.season && e.metadata.episode > m.episode))
      .sort((a, b) => a[1].metadata.season - b[1].metadata.season || a[1].metadata.episode - b[1].metadata.episode);
    if (!after.length) return null;
    const [key, e] = after[0];
    const mediaPath = key.startsWith('media:') ? '/media/' + fileOf(e) : '/media/torrents/' + fileOf(e) + '/index.m3u8';
    return { url: 'http://guest' + mediaPath, title: e.title || m.name };
  }

  // --- routes -----------------------------------------------------------

  async function resolverRoute(req, res, name, pathname) {
    const method = req.method;

    if (method === 'GET' && (pathname === '/cache' || pathname === '/library')) {
      const { status, json } = await toResolver(req, 'GET', '/cache');
      if (status !== 200 || !json) return sendJson(res, 502, { error: 'The library is unavailable.' });
      return sendJson(res, 200, guestLibrary(name, json));
    }

    if (method === 'GET' && pathname === '/jobs') {
      const mine = new Set(accounts.jobs(name));
      const { status, json } = await toResolver(req, 'GET', '/jobs');
      if (status !== 200 || !json) return sendJson(res, 502, { error: 'Downloads are unavailable.' });
      return sendJson(res, 200, { jobs: (json.jobs || []).filter((j) => mine.has(j.id)).map((j) => { const c = Object.assign({}, j); delete c.sourceUrl; return c; }) });
    }

    if (method === 'POST' && (pathname === '/torrent' || pathname === '/resolve')) {
      const body = await readBody(req, MAX_BODY);
      const m = body.metadata;
      if (!m || ContentPolicy.restricted(body) || GUEST_TYPES.indexOf(m.type) === -1) {
        return sendJson(res, 403, { error: 'Only movies and series can be saved.' });
      }
      // Always your own streaming server, never an address from the page.
      m.streamingServer = stremioServer;
      if (pathname === '/torrent') {
        let u;
        try { u = new URL(body.url); } catch (_) { return sendJson(res, 400, { error: 'Not a torrent stream.' }); }
        const t = /^\/([0-9a-f]{40})\/(-1|\d+)$/i.exec(u.pathname.replace(/^\/stremio(?=\/)/, ''));
        if (!t) return sendJson(res, 400, { error: 'Not a torrent stream.' });
        body.url = stremioServer + '/' + t[1].toLowerCase() + '/' + t[2] + u.search;
      } else if (!(await publicLink(body.url))) {
        return sendJson(res, 403, { error: "That link can't be saved from here." });
      }
      const { status, json } = await toResolver(req, 'POST', pathname, body);
      if (json && json.id && status < 300) {
        accounts.addJob(name, json.id);
        follow(name, json.id);
      }
      return sendJson(res, status, json || { error: 'The server did not answer.' });
    }

    let match = /^\/resolve\/([0-9a-f]{16})$/.exec(pathname);
    if (method === 'GET' && match) {
      const { status, json } = await toResolver(req, 'GET', pathname);
      if (!json) return sendJson(res, 502, { error: 'The server did not answer.' });
      const item = json.streamUrl && itemOf(json.streamUrl);
      // Only your own downloads, or one that's already in your library.
      if (accounts.jobs(name).indexOf(match[1]) === -1 && !(item && accounts.has(name, item))) {
        return sendJson(res, 404, { error: 'No such download.' });
      }
      if (item && json.status === 'ready') { accounts.add(name, item); accounts.dropJob(name, match[1]); }
      delete json.sourceUrl;
      return sendJson(res, status, json);
    }

    match = /^\/cache\/(media|torrents)\/([^/]+)\/(delete|resume)$/.exec(pathname);
    if (method === 'POST' && match) {
      const item = match[1] + ':' + match[2];
      if (!accounts.has(name, item)) return sendJson(res, 404, { error: 'Not in your library.' });
      // Removing takes it off your list; the file stays for everyone else.
      if (match[3] === 'delete') { accounts.drop(name, item); return sendJson(res, 200, { ok: true }); }
      const { status, json } = await toResolver(req, 'POST', pathname, {});
      return sendJson(res, status, json || {});
    }

    // AirPlay: a key for one video in this person's library, for the TV
    // (which can't log in) to fetch it through the public AirPlay address.
    if (method === 'POST' && pathname === '/share') {
      const body = await readBody(req, 4096);
      const item = itemOf(body.url);
      if (!item || !accounts.has(name, item)) return sendJson(res, 404, { error: 'Not in your library.' });
      const { status, json } = await toResolver(req, 'POST', '/share', { url: new URL(body.url, 'http://x').pathname });
      return sendJson(res, status, json || { error: 'The server did not answer.' });
    }

    if (method === 'POST' && pathname === '/playback') {
      const body = await readBody(req, 16384);
      const item = itemOf(body.url);
      if (!item || !accounts.has(name, item)) return sendJson(res, 404, { error: 'Media is not in your library.' });
      if (body.event === 'progress' || body.event === 'completed') {
        accounts.setProgress(name, item, { positionSec: body.positionSec, durationSec: body.durationSec, completed: body.event === 'completed' });
      } else if (body.event !== 'start') return sendJson(res, 400, { error: 'Unknown playback event.' });
      const progress = accounts.progress(name, item);
      let next = null;
      if (body.event === 'completed') {
        const { json } = await toResolver(req, 'GET', '/cache');
        next = json ? nextEpisode(name, item, json) : null;
      }
      return sendJson(res, 200, { progress, startPositionSec: progress.watched ? 0 : progress.positionSec, next });
    }

    match = /^\/thumb\/(media|torrents)\/([^/]+)\.jpg$/.exec(pathname);
    if (method === 'GET' && match) {
      const own = match[1] === 'media' ? 'media:' + match[2] : 'torrents:' + match[2];
      if (!accounts.has(name, own)) { res.writeHead(404); res.end(); return; }
      return pipeFromResolver(req, res, pathname);
    }
    // Artwork is named by its content's hash, pictures by random names.
    if (method === 'GET' && (/^\/library-art\/[0-9a-f]{64}\.(jpg|png|webp)$/.test(pathname) ||
        /^\/media\/[0-9a-f]{16}\.(jpg|png|webp)$/.test(pathname))) {
      return pipeFromResolver(req, res, pathname);
    }
    const item = itemOf(pathname);
    if (method === 'GET' && item && pathname.startsWith('/media/')) {
      if (!accounts.has(name, item)) { res.writeHead(404); res.end(); return; }
      return pipeFromResolver(req, res, pathname);
    }

    return sendJson(res, 403, { error: 'Not available with a guest account.' });
  }

  function serveFile(res, rel, extra) {
    const file = path.join(root, rel);
    if (!file.startsWith(root + path.sep)) { res.writeHead(404); res.end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      if (extra) data = Buffer.concat([data, Buffer.from(extra)]);
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  }

  async function handle(req, res) {
    let url;
    try { url = new URL(req.url, 'http://guest'); } catch (_) { res.writeHead(400); res.end(); return; }
    const pathname = url.pathname;
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');

    if (req.method === 'POST' && !sameOrigin(req)) return sendJson(res, 403, { error: 'Wrong origin.' });

    if (pathname === '/api/login' && req.method === 'POST') {
      const body = await readBody(req, 4096);
      try {
        const token = accounts.login(body.name, body.password, clientKey(req));
        return sendJson(res, 200, { name: accounts.session(token) }, {
          'Set-Cookie': `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}`
        });
      } catch (err) { return sendJson(res, 401, { error: err.message }); }
    }
    if (req.method === 'GET' && OPEN_FILES.test(pathname)) return serveFile(res, pathname.slice(1));

    const name = accounts.session(cookieToken(req));
    if (!name) {
      if (pathname.startsWith('/api/') || pathname.startsWith('/resolver/')) return sendJson(res, 401, { error: 'Log in first.' });
      res.writeHead(302, { Location: '/login.html' });
      res.end();
      return;
    }

    if (pathname === '/api/logout' && req.method === 'POST') {
      accounts.logout(cookieToken(req));
      return sendJson(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` });
    }
    if (pathname === '/api/me') return sendJson(res, 200, { name });
    // Casting between this account's own pages (guest-cast.js).
    if (pathname === '/api/cast/stream' && req.method === 'GET') return cast.stream(req, res, name);
    if (pathname === '/api/cast/send' && req.method === 'POST') {
      const result = cast.receive(name, await readBody(req, 32 * 1024));
      return sendJson(res, result.status, result.error ? { error: result.error } : { ok: true });
    }
    if (pathname === '/api/stremio-settings') {
      if (req.method !== 'GET') return sendJson(res, 403, { error: 'Only the owner changes addons.' });
      return sendJson(res, 200, { addons: readStremioSettings().addons || [], plus18: [] });
    }
    if (pathname === '/api/airplay-settings') {
      if (req.method !== 'GET') return sendJson(res, 403, { error: 'Only the owner changes this.' });
      return sendJson(res, 200, { publicUrl: readAirplaySettings().publicUrl || '' });
    }
    if (pathname === '/api/stremio-browse') {
      // Guests read the shared catalog cache but don't write to it.
      const body = await readBody(req, 64 * 1024).catch(() => ({}));
      if (body.action === 'get' && typeof body.key === 'string') return sendJson(res, 200, browseStore.get(body.key) || { data: null });
      return sendJson(res, 200, { ok: true });
    }
    if (pathname.startsWith('/resolver/')) return resolverRoute(req, res, name, pathname.slice('/resolver'.length));
    // The resolver writes its own addresses (http://<this door>/media/...);
    // the page moves them under /resolver over https, but take them as is too.
    if (/^\/(media|thumb|library-art)\//.test(pathname) || pathname === '/playback') return resolverRoute(req, res, name, pathname);

    if (req.method !== 'GET') return sendJson(res, 405, { error: 'Not allowed.' });
    if (pathname === '/' || pathname === '/index.html') {
      res.writeHead(302, { Location: '/stremio.html#/' });
      res.end();
      return;
    }
    // The page's settings, pointed at this door, and who's logged in.
    if (pathname === '/js/config.js') {
      return serveFile(res, 'js/config.js', '\n// Guest door (guest-gateway.js).\n' +
        'APP_CONFIG.GUEST = ' + JSON.stringify({ name }) + ';\n' +
        "APP_CONFIG.RESOLVER_URL = location.origin + '/resolver';\n" +
        "APP_CONFIG.STREMIO_SERVER_URL = location.origin + '/stremio';\n" +
        "APP_CONFIG.RELAY_URL = 'guest';\n");
    }
    if (pathname === '/js/playback-history.js' && receiverDir) {
      return fs.readFile(path.join(receiverDir, 'playback-history.js'), (err, data) => {
        if (err) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': mime['.js'], 'Cache-Control': 'no-cache' });
        res.end(data);
      });
    }
    if (PAGE_FILES.test(pathname)) return serveFile(res, pathname.slice(1));
    res.writeHead(404);
    res.end('Not found');
  }

  return function (req, res) {
    handle(req, res).catch((err) => {
      if (!res.headersSent) sendJson(res, 400, { error: err.message });
      else res.end();
    });
  };
}

module.exports = { createGuestGateway };
