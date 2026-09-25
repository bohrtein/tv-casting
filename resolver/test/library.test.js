'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { once } = require('events');
const { MediaCache } = require('../src/cache');
const { libraryFields, classify, saveThumbnail } = require('../src/library');

test('library retains more than five downloads, metadata, and old indexed files across restart', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'casting-library-'));
  const old = { sourceUrl: 'https://example.com/old', fileName: 'old.mp4', title: 'Old download', lastUsedAt: 1 };
  fs.writeFileSync(path.join(dir, old.fileName), 'video');
  fs.writeFileSync(path.join(dir, 'cache-index.json'), JSON.stringify([old]));
  const cache = new MediaCache(dir, Infinity);
  for (let i = 0; i < 8; i++) {
    fs.writeFileSync(path.join(dir, `${i}.mp4`), 'video');
    assert.deepEqual(cache.add({ sourceUrl: `https://example.com/${i}`, fileName: `${i}.mp4`, title: 'Episode', category: 'series',
      metadata: { id: 'tt2861424', season: 1, episode: i } }), []);
  }
  const reloaded = new MediaCache(dir, Infinity);
  assert.equal(reloaded.list().length, 9);
  assert.equal(reloaded.find('https://example.com/3').metadata.episode, 3);
  reloaded.update('3.mp4', { category: 'movies' });
  assert.equal(new MediaCache(dir, Infinity).find('https://example.com/3').category, 'movies');
  fs.unlinkSync(path.join(dir, '0.mp4'));
  assert.equal(reloaded.list().length, 8);
  for (const file of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, file));
  fs.rmdirSync(dir);
});

test('classification and metadata validation avoid treating any age restriction as porn', () => {
  assert.equal(classify('https://youtu.be/abc', {}), 'youtube');
  assert.equal(classify('https://www.pornhub.com/view_video.php?id=test', {}), 'porn');
  assert.equal(classify('https://example.com/film', { age_limit: 18 }), 'other');
  assert.throws(() => libraryFields({ category: 'invalid' }));
  assert.throws(() => libraryFields({ metadata: { type: 'series', id: 'tt123', name: 'Show' } }));
  const fields = libraryFields({ metadata: { type: 'series', id: 'tt123', name: 'Show', videoId: 'tt123:1:2', season: 1, episode: 2, fileName: '../bad' } });
  assert.equal(fields.category, 'series');
  assert.equal(fields.metadata.fileName, undefined);
});

test('thumbnail is saved locally; invalid image content is rejected', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'casting-art-'));
  const server = http.createServer((req, res) => { res.setHeader('Content-Type', req.url === '/good' ? 'image/jpeg' : 'text/html'); res.end('fixture'); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const root = `http://127.0.0.1:${server.address().port}`;
    assert.equal(await saveThumbnail(root + '/good', dir, 'test'), 'test.jpg');
    assert.equal(fs.readFileSync(path.join(dir, 'test.jpg'), 'utf8'), 'fixture');
    assert.equal(await saveThumbnail(root + '/bad', dir, 'bad'), null);
  } finally {
    server.closeAllConnections(); server.close();
    for (const file of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, file)); fs.rmdirSync(dir);
  }
});

test('resolver persists downloads, deduplicates jobs, validates updates and serves ranges', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'casting-api-'));
  const reservation = http.createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port; await new Promise((ok) => reservation.close(ok));
  // Replace only the external downloader; exercise the real HTTP server and persistent index.
  const script = `const fs = require('fs'); const yt = require('./src/ytdlp');
    yt.getInfo = async () => ({ title: 'Fixture', extractor: 'Youtube' });
    yt.download = async (url, dest) => { await new Promise(r => setTimeout(r, 100)); fs.writeFileSync(dest + '.mp4', '0123456789'); };
    const torrent = require('./src/torrent');
    torrent.frameSize = async () => null;
    torrent.download = async (url, dir, opts) => {
      fs.writeFileSync(require('path').join(dir, 'index.m3u8'), '#EXTM3U\\n#EXT-X-ENDLIST\\n');
      opts.onReady();
    };
    require('./src/index');`;
  let child;
  async function start() {
    child = spawn(process.execPath, ['-e', script], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), MEDIA_DIR: dir } });
    await Promise.race([once(child.stdout, 'data'), once(child, 'exit').then(() => { throw new Error('Resolver exited early'); })]);
  }
  async function stop() { const closed = once(child, 'exit'); child.kill(); await closed; }
  const root = `http://127.0.0.1:${port}`;
  async function post(url, body) { return fetch(root + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
  try {
    await start();
    const metadata = { id: 'tt123', type: 'series', name: 'Fixture Show', videoId: 'tt123:1:2', season: 1, episode: 2, videos: [{ id: 'tt123:1:1', season: 1, episode: 1 }, { id: 'tt123:1:2', season: 1, episode: 2 }, { id: 'tt123:2:1', season: 2, episode: 1 }] };
    const first = await (await post('/resolve', { url: 'https://example.com/test', metadata })).json();
    const duplicate = await (await post('/resolve', { url: 'https://example.com/test' })).json();
    assert.equal(first.id, duplicate.id);
    let job;
    for (let n = 0; n < 50; n++) {
      job = await (await fetch(root + '/resolve/' + first.id)).json();
      if (job.status === 'ready' || job.status === 'error') break;
      await new Promise((ok) => setTimeout(ok, 25));
    }
    assert.equal(job.status, 'ready');
    let { entries } = await (await fetch(root + '/library')).json();
    assert.equal(entries.length, 1); assert.equal(entries[0].metadata.episode, 2); assert.equal(entries[0].category, 'series');
    const catalog = await (await fetch(root + '/library')).json();
    assert.equal(catalog.titles[0].videos.length, 3);
    const position = await (await post('/playback', { url: entries[0].streamUrl, event: 'progress', positionSec: 87, durationSec: 900 })).json();
    assert.equal(position.progress.positionSec, 87);
    assert.equal((await post('/playback', { url: entries[0].streamUrl, event: 'progress', positionSec: -1, durationSec: 900 })).status, 400);
    assert.equal((await post('/playback', { url: root + '/media/missing.mp4', event: 'start' })).status, 404);
    const range = await fetch(entries[0].streamUrl, { headers: { Range: 'bytes=2-5' } });
    assert.equal(range.status, 206); assert.equal(await range.text(), '2345');
    assert.equal((await post('/library/media/' + entries[0].fileName, { category: 'porn' })).status, 200);
    assert.equal((await post('/resolve', { url: 'https://example.com/bad', category: 'bad' })).status, 400);
    await stop(); await start();
    ({ entries } = await (await fetch(root + '/library')).json());
    assert.equal(entries[0].category, 'porn');
    assert.equal(entries[0].progress.positionSec, 87);
    const resumed = await (await post('/playback', { url: entries[0].streamUrl, event: 'start' })).json();
    assert.equal(resumed.startPositionSec, 87);
    const completed = await (await post('/playback', { url: entries[0].streamUrl, event: 'completed', positionSec: 900, durationSec: 900 })).json();
    assert.equal(completed.progress.watched, true);
    assert.equal(completed.next, null);
    const replay = await (await post('/playback', { url: entries[0].streamUrl, event: 'start' })).json();
    assert.equal(replay.startPositionSec, 0);
    const cached = await (await post('/resolve', { url: 'https://example.com/test' })).json();
    assert.equal(cached.status, 'ready');
    const torrentUrl = 'http://example.com/' + 'a'.repeat(40) + '/0';
    const downloaded = await post('/torrent', { url: torrentUrl, title: 'Episode', metadata });
    assert.equal(downloaded.status, 202);
    const library = await (await fetch(root + '/library')).json();
    assert.equal(library.torrents[0].metadata.episode, 2);
    assert.equal(library.torrents[0].category, 'series');
    await stop(); await start();
    const afterRestart = await (await fetch(root + '/library')).json();
    assert.equal(afterRestart.torrents[0].metadata.name, 'Fixture Show');
  } finally {
    if (child && child.exitCode === null) await stop();
    const target = path.resolve(dir);
    assert.ok(target.startsWith(path.resolve(os.tmpdir()) + path.sep + 'casting-api-'));
    fs.rmSync(target, { recursive: true, force: true });
  }
});
