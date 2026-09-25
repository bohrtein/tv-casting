'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('Stremio and Plus18 addons remain separate in shared settings', async () => {
  const stored = new Map();
  let shared = { addons: null, plus18: [] };
  const context = vm.createContext({
    URL, AbortController, setTimeout, clearTimeout,
    localStorage: {
      getItem: key => stored.has(key) ? stored.get(key) : null,
      setItem: (key, value) => stored.set(key, value)
    },
    fetch: async (url, options = {}) => {
      if (url === 'api/stremio-settings') {
        if (options.method === 'POST') shared = JSON.parse(options.body);
        return { ok: true, json: async () => shared };
      }
      return { ok: true, json: async () => ({ id: String(url), name: String(url), resources: [] }) };
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'stremio-client.js'), 'utf8'), context);
  const client = context.createStremioClient({ STREMIO_ADDONS: ['https://normal.example/manifest.json'] });
  assert.equal((await client.loadAddons('normal')).length, 1);
  assert.equal((await client.loadAddons('plus18')).length, 0);
  await client.addAddon('https://adult.example/manifest.json', 'plus18');
  assert.deepEqual(shared.addons, ['https://normal.example/manifest.json']);
  assert.deepEqual(shared.plus18, ['https://adult.example/manifest.json']);
  assert.equal((await client.loadAddons('normal')).length, 1);
  assert.equal((await client.loadAddons('plus18')).length, 1);
  await client.removeAddon('https://adult.example/manifest.json', 'plus18');
  assert.deepEqual(shared.addons, ['https://normal.example/manifest.json']);
  assert.deepEqual(shared.plus18, []);
});
