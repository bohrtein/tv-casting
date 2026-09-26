'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'stremio-core-client.js'), 'utf8');

function makeClient(fetchImpl) {
  const context = vm.createContext({
    AbortController, setTimeout, clearTimeout, fetch: fetchImpl,
    createStremioSettings: () => ({ getServerUrl: () => '' }),
    createStremioStreamPresentation: () => ({}),
    createStremioCastAdapter: () => ({ toCastable: (value) => value })
  });
  vm.runInContext(source, context);
  return context.createStremioCoreClient({});
}

function delayedFetch(delays, completed) {
  return (url, options = {}) => new Promise((resolve, reject) => {
    const provider = new URL(url).hostname.split('.')[0];
    let settled = false;
    const finishAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      completed.push(provider);
      resolve({
        ok: true,
        json: async () => ({ metas: [{ id: provider, type: 'movie', name: provider }] })
      });
    }, delays[provider]);
    if (options.signal) {
      if (options.signal.aborted) finishAbort();
      else options.signal.addEventListener('abort', finishAbort, { once: true });
    }
  });
}

test('catalog searches resolve independently so fast providers appear first', async () => {
  const completed = [];
  const client = makeClient(delayedFetch({ slow: 120, fast: 5 }, completed));
  const slow = client.searchCatalog('https://slow.example/manifest.json', 'movie', 'search', 'film');
  const fast = client.searchCatalog('https://fast.example/manifest.json', 'movie', 'search', 'film');

  const fastResult = await fast;
  assert.deepEqual(fastResult.map((item) => item.name), ['fast']);
  assert.deepEqual(completed, ['fast']);

  const slowResult = await slow;
  assert.deepEqual(slowResult.map((item) => item.name), ['slow']);
  assert.deepEqual(completed, ['fast', 'slow']);
});

test('catalog search aborts stale provider work', async () => {
  const completed = [];
  const client = makeClient(delayedFetch({ slow: 120 }, completed));
  const controller = new AbortController();
  const pending = client.searchCatalog(
    'https://slow.example/manifest.json', 'movie', 'search', 'old query', controller.signal
  );
  controller.abort();

  await assert.rejects(pending, (error) => error && error.name === 'AbortError' && error.message === 'Search cancelled.');
  assert.deepEqual(completed, []);
});
