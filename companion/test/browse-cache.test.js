'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const createStore = require('../browse-store');
const createCache = require('../js/stremio-browse-cache');

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

test('the server keeps results per key, expires them, and survives a restart', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'browse-store-'));
  const file = path.join(dir, 'cache.json');
  let time = 1000;
  const store = createStore(file, () => time);
  store.put('a', [{ name: 'Film' }]);
  assert.deepEqual(store.get('a').data, [{ name: 'Film' }]);
  assert.equal(store.get('b'), null);
  await new Promise((resolve) => setTimeout(resolve, 1300));
  assert.deepEqual(createStore(file, () => time).get('a').data, [{ name: 'Film' }]);
  time += 24 * 60 * 60 * 1000;
  assert.equal(createStore(file, () => time).get('a'), null);
  assert.equal(store.get('a'), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the server keeps only the newest entries', () => {
  const store = createStore(null, () => 1000);
  for (let i = 0; i < 301; i++) store.put(String(i), [i]);
  assert.equal(store.get('0'), null);
  assert.deepEqual(store.get('300').data, [300]);
});

test('pages share results through the server, separated by section, addons and query', async () => {
  const store = createStore(null);
  const server = http.createServer((req, res) => store.handle(req, res));
  const port = await listen(server);
  const endpoint = `http://127.0.0.1:${port}/`;
  const phone = createCache(fetch, endpoint);
  const computer = createCache(fetch, endpoint);
  await phone.put('search', 'normal', 'addon-a', 'film', [{ name: 'Film' }]);
  assert.deepEqual(await computer.get('search', 'normal', 'addon-a', 'film'), [{ name: 'Film' }]);
  assert.equal(await computer.get('search', 'plus18', 'addon-a', 'film'), null);
  assert.equal(await computer.get('search', 'normal', 'addon-b', 'film'), null);
  assert.equal(await computer.get('search', 'normal', 'addon-a', 'series'), null);
  const bad = await fetch(endpoint, { method: 'POST', body: '{"action":"delete","key":"x"}' });
  assert.equal(bad.status, 400);
  await new Promise((resolve) => server.close(resolve));
  // No server: every read is a miss, so the page falls back to the addons.
  assert.equal(await computer.get('search', 'normal', 'addon-a', 'film'), null);
});
