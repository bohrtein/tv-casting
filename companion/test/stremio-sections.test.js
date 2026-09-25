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
  for (const file of ['stremio-settings.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8'), context);
  }
  const settings = context.createStremioSettings({ STREMIO_ADDONS: ['https://normal.example/manifest.json'] });
  await settings.sync();
  assert.equal(settings.getUrls('normal').length, 1);
  assert.equal(settings.getUrls('plus18').length, 0);
  await settings.change('plus18', urls => urls.concat(['https://adult.example/manifest.json']));
  assert.deepEqual(shared.addons, ['https://normal.example/manifest.json']);
  assert.deepEqual(shared.plus18, ['https://adult.example/manifest.json']);
  assert.equal(settings.getUrls('normal').length, 1);
  assert.equal(settings.getUrls('plus18').length, 1);
  await settings.change('plus18', urls => urls.filter(url => url !== 'https://adult.example/manifest.json'));
  assert.deepEqual(shared.addons, ['https://normal.example/manifest.json']);
  assert.deepEqual(shared.plus18, []);
});
