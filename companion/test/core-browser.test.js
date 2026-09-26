'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright-core');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const browserAvailable = process.env.TEST_CORE_BROWSER === '1' && fs.existsSync(chromePath);

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}
function close(server) { return new Promise((resolve) => server.close(resolve)); }
async function waitFor(url) {
  for (let i = 0; i < 40; i++) {
    try { const response = await fetch(url); if (response.ok) return; } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Companion did not start.');
}

test('Core installs an addon and supplies catalogs, metadata, search, and streams',
  { skip: !browserAvailable, timeout: 90000 }, async () => {
    const addon = http.createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', 'application/json');
      const pathname = new URL(req.url, 'http://local').pathname;
      const adult = pathname.startsWith('/adult/');
      const route = adult ? pathname.slice('/adult'.length) : pathname;
      const name = adult ? 'Adult Mock Film' : 'Mock Film';
      const id = adult ? 'adult:1' : 'tt0000001';
      let body;
      if (route === '/manifest.json') body = {
        id: adult ? 'org.tvcasting.adultmock' : 'org.tvcasting.mock', version: '1.0.0',
        name: adult ? 'Adult Mock Addon' : 'Mock Addon', description: 'Core integration test',
        resources: ['catalog', 'meta', 'stream', 'subtitles'], types: ['movie'],
        catalogs: [
          { type: 'movie', id: 'top', name: 'Top', extra: [{ name: 'genre', options: ['Action', 'Drama'] }, { name: 'skip' }] },
          { type: 'movie', id: 'curated', name: 'Curated', extra: [{ name: 'genre', isRequired: true, options: ['Action'] }] },
          { type: 'movie', id: 'search', name: 'Search', extra: [{ name: 'search', isRequired: true }] }
        ]
      };
      else if (route === '/catalog/movie/top.json' || route.startsWith('/catalog/movie/search/')) {
        body = { metas: [{ id, type: 'movie', name, poster: 'https://example.com/poster.jpg' }] };
      } else if (route === '/catalog/movie/top/genre=Action.json') {
        body = { metas: [{ id, type: 'movie', name: 'Action Mock Film' }] };
      } else if (route === '/catalog/movie/curated/genre=Action.json') {
        body = { metas: [{ id, type: 'movie', name: 'Curated Mock Film' }] };
      } else if (route === '/catalog/movie/top/skip=1.json') {
        body = { metas: [{ id: adult ? 'adult:2' : 'tt0000002', type: 'movie', name: name + ' 2' }] };
      } else if (route === `/meta/movie/${id}.json`) {
        body = { meta: { id, type: 'movie', name, description: 'A test film', videos: [] } };
      } else if (route === `/stream/movie/${id}.json`) {
        body = { streams: [{ url: 'https://video.example/movie.mp4', name: 'Mock HD',
          behaviorHints: { filename: 'movie.mp4' } }] };
      } else if (route.startsWith(`/subtitles/movie/${id}/`)) {
        body = { subtitles: [{ id: 'en', lang: 'eng', url: 'https://subtitles.example/movie.srt' }] };
      } else { res.statusCode = 404; body = { error: 'Missing mock resource' }; }
      res.end(JSON.stringify(body));
    });
    const addonPort = await listen(addon);
    const addonUrl = `http://127.0.0.1:${addonPort}/manifest.json`;
    const adultUrl = `http://127.0.0.1:${addonPort}/adult/manifest.json`;
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-casting-core-test-'));
    const probe = http.createServer();
    const companionPort = await listen(probe);
    await close(probe);
    const companion = spawn(process.execPath, ['serve.js'], {
      cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(companionPort), DATA_DIR: dataDir },
      stdio: 'pipe'
    });
    let browser;
    try {
      await waitFor(`http://127.0.0.1:${companionPort}/test/core-harness.html`);
      browser = await chromium.launch({ executablePath: chromePath, headless: true });
      const page = await browser.newPage();
      const failures = [];
      page.on('pageerror', (error) => failures.push(error.message));
      await page.goto(`http://127.0.0.1:${companionPort}/test/core-harness.html`);
      const result = await page.evaluate(async ({ manifestUrl, adultManifestUrl }) => {
        await fetch('/api/stremio-settings', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ addons: [manifestUrl], plus18: [adultManifestUrl] }) });
        const client = createStremioCoreClient({ STREMIO_ADDONS: [], STREMIO_SERVER_URL: '' });
        const addons = await client.loadAddons('normal');
        const catalogs = client.browsableCatalogs(addons);
        const metas = await client.getCatalog(catalogs[0].addon, catalogs[0].catalog, 0);
        const next = await client.getCatalog(catalogs[0].addon, catalogs[0].catalog, 1);
        const filtered = await client.getCatalog(catalogs[0].addon, catalogs[0].catalog, 0, { genre: 'Action' });
        const filters = await client.getCatalogFilters();
        const curated = catalogs.find((item) => item.catalog.id === 'curated');
        const required = await client.getCatalog(curated.addon, curated.catalog, 0, { genre: 'Action' });
        // A cached Discover grid can ask for its next page after another catalog was selected.
        const resumed = await client.getCatalog(catalogs[0].addon, catalogs[0].catalog, 1);
        const refreshed = await client.getCatalog(catalogs[0].addon, catalogs[0].catalog, 0);
        const found = await client.search(addons, 'Mock');
        const board = await client.getBoard();
        const searchRows = await client.searchRows('Mock');
        const meta = await client.getMeta(addons, 'movie', 'tt0000001');
        const streams = await client.getStreams(addons, 'movie', 'tt0000001');
        const subtitles = await client.getSubtitles(streams.streams[0], 'movie', 'tt0000001');
        const adultAddons = await client.loadAddons('plus18');
        const adultCatalogs = client.browsableCatalogs(adultAddons);
        const adultMetas = await client.getCatalog(adultCatalogs[0].addon, adultCatalogs[0].catalog, 0);
        return { addons: addons.map((item) => item.manifest && item.manifest.name),
          catalogs: catalogs.map((item) => item.catalog.id), metas: metas.map((item) => item.name),
          next: next.map((item) => item.name),
          filtered: filtered.map((item) => item.name), filters: filters.map((item) => item.name),
          required: required.map((item) => item.name),
          resumed: resumed.map((item) => item.name),
          refreshed: refreshed.map((item) => item.name),
          adultAddons: adultAddons.map((item) => item.manifest && item.manifest.name),
          adultMetas: adultMetas.map((item) => item.name),
          found: found.flatMap((item) => item.metas.map((metaItem) => metaItem.name)),
          board: board.filter((row) => row.state === 'Ready').map((row) => row.id + ':' + row.metas.map((m) => m.name).join(',')),
          searchRows: searchRows.flatMap((row) => row.metas.map((m) => m.name)),
          meta: meta && meta.name, streams: streams.streams.map((stream) => stream.name),
          subtitles: subtitles.map((subtitle) => subtitle.lang),
          castable: client.toCastable(streams.streams[0]) };
      }, { manifestUrl: addonUrl, adultManifestUrl: adultUrl });
      assert.deepEqual(result.addons, ['Mock Addon']);
      assert.ok(result.catalogs.includes('top'));
      assert.ok(result.catalogs.includes('curated'));
      assert.deepEqual(result.metas, ['Mock Film']);
      assert.deepEqual(result.next, ['Mock Film 2']);
      assert.deepEqual(result.filtered, ['Action Mock Film']);
      assert.ok(result.filters.includes('genre'));
      assert.deepEqual(result.required, ['Curated Mock Film']);
      assert.deepEqual(result.resumed, ['Mock Film 2']);
      assert.deepEqual(result.refreshed, ['Mock Film']);
      assert.deepEqual(result.adultAddons, ['Adult Mock Addon']);
      assert.deepEqual(result.adultMetas, ['Adult Mock Film']);
      assert.ok(result.found.includes('Mock Film'));
      assert.deepEqual(result.board, ['top:Mock Film']);
      assert.ok(result.searchRows.includes('Mock Film'));
      assert.equal(result.meta, 'Mock Film');
      assert.deepEqual(result.streams, ['Mock HD']);
      assert.deepEqual(result.subtitles, ['eng']);
      assert.equal(result.castable.url, 'https://video.example/movie.mp4');
      assert.deepEqual(failures, []);
    } finally {
      if (browser) await browser.close();
      companion.kill();
      await close(addon);
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
