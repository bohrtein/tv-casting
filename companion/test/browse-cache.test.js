'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const createCache = require('../js/stremio-browse-cache');

test('browse results survive reopening and stay separate by section, addons, and query', () => {
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, value)
  };
  let time = 1000;
  let cache = createCache(storage, () => time);
  cache.put('search', 'normal', 'addon-a', 'film', [{ name: 'Film' }]);
  cache = createCache(storage, () => time);
  assert.deepEqual(cache.get('search', 'normal', 'addon-a', 'film'), [{ name: 'Film' }]);
  assert.equal(cache.get('search', 'plus18', 'addon-a', 'film'), null);
  assert.equal(cache.get('search', 'normal', 'addon-b', 'film'), null);
  assert.equal(cache.get('search', 'normal', 'addon-a', 'series'), null);
  cache.remove('search', 'normal', 'addon-a', 'film');
  assert.equal(createCache(storage, () => time).get('search', 'normal', 'addon-a', 'film'), null);
  cache.put('search', 'normal', 'addon-a', 'film', [{ name: 'New film' }]);
  time += 24 * 60 * 60 * 1000;
  assert.equal(createCache(storage, () => time).get('search', 'normal', 'addon-a', 'film'), null);
});

test('browse cache keeps only the newest entries', () => {
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, value)
  };
  const cache = createCache(storage, () => 1000);
  for (let i = 0; i < 31; i++) cache.put('search', 'normal', 'addon', String(i), [i]);
  assert.equal(cache.get('search', 'normal', 'addon', '0'), null);
  assert.deepEqual(cache.get('search', 'normal', 'addon', '30'), [30]);
});
