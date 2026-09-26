'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAccounts } = require('../accounts');
const { createGuestGateway } = require('../guest-gateway');

const HASH = 'b'.repeat(40);
const MINE = 'aaaaaaaaaaaaaaaa.mp4';
const YOURS = 'cccccccccccccccc.mp4';

// A stand-in resolver: two saved videos, one torrent, and whatever it's asked.
function fakeResolver() {
  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : null;
      seen.push({ method: req.method, url: req.url, body });
      const json = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.url === '/cache') {
        return json({
          entries: [
            { fileName: MINE, key: MINE, title: 'Mine', sourceUrl: 'http://secret', progress: { positionSec: 999 }, metadata: { type: 'movie', id: 'tt1' } },
            { fileName: YOURS, key: YOURS, title: 'Owner only', metadata: { type: 'movie', id: 'tt2' } }
          ],
          // As the real resolver sends them: torrents are named by key only.
          torrents: [{ key: HASH + '-0', title: 'Adult', category: 'plus18', metadata: { type: 'movie', id: 'x' } },
            { key: HASH + '-1', title: 'Saved film', metadata: { type: 'movie', id: 'tt3' } },
            // Theirs, but you filed it under Porn afterwards.
            { key: HASH + '-2', title: 'Refiled', category: 'porn', metadata: { type: 'movie', id: 'tt4' } }],
          titles: [{ type: 'movie', id: 'tt1', videos: [] }, { type: 'movie', id: 'tt2', videos: [] }, { type: 'movie', id: 'tt3', videos: [] }]
        });
      }
      if (req.url === '/share') return json({ prefix: '/s/key/' + 'k'.repeat(43), expiresIn: 1000, asked: body });
      if (req.url === '/torrent' || req.url === '/resolve') return json({ id: '0123456789abcdef', status: 'starting' });
      if (req.url === '/resolve/0123456789abcdef') return json({ id: '0123456789abcdef', status: 'ready', streamUrl: `http://${req.headers.host}/media/torrents/${HASH}-1/index.m3u8` });
      if (req.url.startsWith('/media/')) { res.writeHead(200, { 'Content-Type': 'video/mp4' }); return res.end('VIDEO'); }
      res.writeHead(404); res.end();
    });
  });
  return { server, seen };
}

async function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guest-'));
  const accounts = createAccounts(path.join(dir, 'accounts.json'));
  accounts.create('guest', 'guest password');
  accounts.add('guest', 'media:' + MINE);
  accounts.add('guest', `torrents:${HASH}-2`);
  const resolver = fakeResolver();
  await new Promise((r) => resolver.server.listen(0, '127.0.0.1', r));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guest-root-'));
  fs.writeFileSync(path.join(root, 'login.html'), 'LOGIN');
  fs.writeFileSync(path.join(root, 'stremio.html'), 'APP');
  fs.writeFileSync(path.join(root, 'tools.html'), 'TOOLS');
  fs.writeFileSync(path.join(root, 'serve.js'), 'SERVER CODE');
  fs.mkdirSync(path.join(root, 'js'));
  fs.writeFileSync(path.join(root, 'js', 'config.js'), 'var APP_CONFIG = {};');
  const gateway = http.createServer(createGuestGateway({
    accounts, root, mime: {}, readStremioSettings: () => ({ addons: ['https://addon/manifest.json'], plus18: ['https://adult/manifest.json'] }),
    browseStore: { get: () => null }, readAirplaySettings: () => ({ publicUrl: 'https://door.example:8443' }), resolverUrl: 'http://127.0.0.1:' + resolver.server.address().port,
    stremioServerUrl: 'http://127.0.0.1:11470'
  }));
  await new Promise((r) => gateway.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + gateway.address().port;
  let cookie = '';
  async function call(pathname, options = {}) {
    const res = await fetch(base + pathname, { redirect: 'manual', ...options,
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...options.headers } });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch (_) {}
    return { status: res.status, text, json, headers: res.headers };
  }
  async function login() {
    const res = await call('/api/login', { method: 'POST', body: JSON.stringify({ name: 'guest', password: 'guest password' }) });
    cookie = res.headers.get('set-cookie').split(';')[0];
    return res;
  }
  const close = () => { gateway.close(); resolver.server.close(); };
  return { call, login, accounts, seen: resolver.seen, close };
}

test('nothing but the login page without logging in', async () => {
  const g = await setup();
  try {
    assert.strictEqual((await g.call('/login.html')).text, 'LOGIN');
    assert.strictEqual((await g.call('/stremio.html')).status, 302);
    assert.strictEqual((await g.call('/resolver/cache')).status, 401);
    assert.strictEqual((await g.call('/api/stremio-settings')).status, 401);
    const wrong = await g.call('/api/login', { method: 'POST', body: JSON.stringify({ name: 'guest', password: 'nope nope' }) });
    assert.strictEqual(wrong.status, 401);
    const ok = await g.login();
    assert.match(ok.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Lax/);
    assert.strictEqual((await g.call('/stremio.html')).text, 'APP');
  } finally { g.close(); }
});

test('guests never get the owner pages or the server code', async () => {
  const g = await setup();
  try {
    await g.login();
    assert.strictEqual((await g.call('/tools.html')).status, 404);
    assert.strictEqual((await g.call('/serve.js')).status, 404);
    assert.strictEqual((await g.call('/api/accounts')).status, 404);
    const config = await g.call('/js/config.js');
    assert.match(config.text, /APP_CONFIG.GUEST = {"name":"guest"}/);
    assert.match(config.text, /RELAY_URL = 'guest'/);
  } finally { g.close(); }
});

test('addons are read-only and Plus18 is hidden', async () => {
  const g = await setup();
  try {
    await g.login();
    assert.deepStrictEqual((await g.call('/api/stremio-settings')).json, { addons: ['https://addon/manifest.json'], plus18: [] });
    assert.strictEqual((await g.call('/api/stremio-settings', { method: 'POST', body: '{}' })).status, 403);
  } finally { g.close(); }
});

test('the library shows only this person\'s items, with their own progress', async () => {
  const g = await setup();
  try {
    await g.login();
    const lib = (await g.call('/resolver/cache')).json;
    assert.deepStrictEqual(lib.entries.map((e) => e.fileName), [MINE]);
    assert.strictEqual(lib.entries[0].sourceUrl, undefined);
    assert.strictEqual(lib.entries[0].progress.positionSec, 0);
    assert.deepStrictEqual(lib.torrents, []);
    assert.deepStrictEqual(lib.titles.map((t) => t.id), ['tt1']);
    assert.strictEqual((await g.call('/resolver/media/' + MINE)).text, 'VIDEO');
    assert.strictEqual((await g.call('/resolver/media/' + YOURS)).status, 404);
  } finally { g.close(); }
});

test('removing takes it off their list without deleting the file', async () => {
  const g = await setup();
  try {
    await g.login();
    assert.strictEqual((await g.call('/resolver/cache/media/' + MINE + '/delete', { method: 'POST', body: '{}' })).status, 200);
    assert.ok(!g.accounts.has('guest', 'media:' + MINE));
    assert.ok(!g.seen.some((r) => r.url.includes('/delete')), 'nothing deleted on the resolver');
    assert.strictEqual((await g.call('/resolver/cache/media/' + YOURS + '/delete', { method: 'POST', body: '{}' })).status, 404);
  } finally { g.close(); }
});

test('saving a torrent always uses your own streaming server and lands in their library', async () => {
  const g = await setup();
  try {
    await g.login();
    const res = await g.call('/resolver/torrent', { method: 'POST', body: JSON.stringify({
      url: `http://192.168.1.1:9999/${HASH.toUpperCase()}/1?tr=udp%3A%2F%2Ft`, title: 'Film',
      metadata: { type: 'movie', id: 'tt9', streamingServer: 'http://evil' } }) });
    assert.strictEqual(res.status, 200);
    const sent = g.seen.find((r) => r.url === '/torrent').body;
    assert.strictEqual(sent.url, `http://127.0.0.1:11470/${HASH}/1?tr=udp%3A%2F%2Ft`);
    assert.strictEqual(sent.metadata.streamingServer, 'http://127.0.0.1:11470');
    await new Promise((r) => setTimeout(r, 200));
    assert.ok(g.accounts.has('guest', `torrents:${HASH}-1`), 'added once it can play');
    const lib = (await g.call('/resolver/cache')).json;
    assert.deepStrictEqual(lib.torrents.map((e) => e.key), [HASH + '-1'], 'and shows in their library');
    assert.deepStrictEqual(lib.titles.map((t) => t.id).sort(), ['tt1', 'tt3']);
  } finally { g.close(); }
});

test('guests can only save movies and series, and no links into the home network', async () => {
  const g = await setup();
  try {
    await g.login();
    const post = (p, body) => g.call(p, { method: 'POST', body: JSON.stringify(body) });
    assert.strictEqual((await post('/resolver/torrent', { url: `http://x/${HASH}/0`, metadata: { type: 'movie' }, category: 'plus18' })).status, 403);
    assert.strictEqual((await post('/resolver/torrent', { url: `http://x/${HASH}/0`, metadata: { type: 'movie' }, category: 'porn' })).status, 403);
    assert.strictEqual((await post('/resolver/resolve', { url: 'https://example.com/v.mp4', metadata: { type: 'channel' } })).status, 403);
    for (const url of ['http://192.168.2.1/admin', 'http://127.0.0.1:8788/cache', 'http://localhost/', 'http://[::1]/', 'file:///etc/passwd', 'http://100.101.102.103/']) {
      assert.strictEqual((await post('/resolver/resolve', { url, metadata: { type: 'movie' } })).status, 403, url);
    }
    assert.ok(!g.seen.some((r) => r.url === '/resolve'), 'none reached the resolver');
  } finally { g.close(); }
});

test('other resolver routes are closed, and posts from other sites are refused', async () => {
  const g = await setup();
  try {
    await g.login();
    assert.strictEqual((await g.call('/resolver/subtitle', { method: 'POST', body: '{}' })).status, 403);
    assert.strictEqual((await g.call('/resolver/cache/torrents/' + HASH + '-0/optimize', { method: 'POST', body: '{}' })).status, 403);
    assert.strictEqual((await g.call('/resolver/resolve/0123456789abcdef')).status, 404, 'not their download');
    const cross = await g.call('/api/logout', { method: 'POST', body: '{}', headers: { origin: 'https://evil.example' } });
    assert.strictEqual(cross.status, 403);
  } finally { g.close(); }
});

test('watch progress is kept per person and never sent to the resolver', async () => {
  const g = await setup();
  try {
    await g.login();
    const play = (event, positionSec) => g.call('/resolver/playback', { method: 'POST',
      body: JSON.stringify({ url: 'https://guest.example/resolver/media/' + MINE, event, positionSec, durationSec: 100 }) });
    await play('progress', 42);
    assert.strictEqual((await play('start')).json.startPositionSec, 42);
    assert.ok(!g.seen.some((r) => r.url === '/playback'));
    assert.strictEqual((await g.call('/resolver/playback', { method: 'POST', body: JSON.stringify({ url: 'http://x/media/' + YOURS, event: 'start' }) })).status, 404);
  } finally { g.close(); }
});

test('AirPlay: a key only for a video in their own library, and the public address', async () => {
  const g = await setup();
  try {
    await g.login();
    assert.deepStrictEqual((await g.call('/api/airplay-settings')).json, { publicUrl: 'https://door.example:8443' });
    assert.strictEqual((await g.call('/api/airplay-settings', { method: 'POST', body: '{}' })).status, 403);
    const share = (url) => g.call('/resolver/share', { method: 'POST', body: JSON.stringify({ url }) });
    const mine = await share('https://door.example/resolver/media/' + MINE);
    assert.strictEqual(mine.status, 200);
    assert.deepStrictEqual(g.seen.find((r) => r.url === '/share').body, { url: '/resolver/media/' + MINE }, 'asks for that one video');
    assert.strictEqual((await share('https://door.example/resolver/media/' + YOURS)).status, 404);
    assert.strictEqual((await g.call('/resolver/share', { method: 'POST', body: '{}' })).status, 404, 'never a key for everything');
  } finally { g.close(); }
});
