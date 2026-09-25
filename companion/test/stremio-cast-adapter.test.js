'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const createAdapter = require('../js/stremio-cast-adapter');

const server = 'http://192.168.2.31:11470';
const hash = 'A'.repeat(40);

test('selected direct and YouTube streams keep their existing playback route', () => {
  const adapter = createAdapter(() => server);
  assert.deepEqual(adapter.toCastable({ url: 'https://video.example/movie.mp4' }),
    { kind: 'direct', url: 'https://video.example/movie.mp4' });
  assert.deepEqual(adapter.toCastable({ ytId: 'a-b_c' }),
    { kind: 'resolve', url: 'https://www.youtube.com/watch?v=a-b_c' });
});

test('header-proxied streams and torrents use the configured streaming server', () => {
  const adapter = createAdapter(() => server + '/');
  const proxied = adapter.toCastable({ url: 'https://video.example/movie.mp4?part=1',
    behaviorHints: { proxyHeaders: { request: { Referer: 'https://site.example/' } } } });
  assert.equal(proxied.kind, 'direct');
  assert.equal(proxied.viaServer, true);
  assert.match(proxied.url, /^http:\/\/192\.168\.2\.31:11470\/proxy\//);
  assert.match(proxied.url, /movie\.mp4\?part=1$/);

  const torrent = adapter.toCastable({ infoHash: hash, fileIdx: 2, sources: ['tracker:https://tracker.example'] });
  assert.deepEqual(torrent, { kind: 'direct', viaServer: true, torrent: true,
    url: server + '/' + hash.toLowerCase() + '/2?tr=tracker%3Ahttps%3A%2F%2Ftracker.example' });
  const magnet = adapter.toCastable({ url: 'magnet:?xt=urn:btih:' + hash });
  assert.equal(magnet.url, server + '/' + hash.toLowerCase() + '/-1');
});

test('unsupported sources remain uncastable', () => {
  const adapter = createAdapter(() => '');
  assert.equal(adapter.toCastable({ infoHash: hash }).kind, 'unsupported');
  assert.equal(adapter.toCastable({ externalUrl: 'https://site.example/watch' }).kind, 'unsupported');
  assert.equal(adapter.toCastable({ infoHash: 'bad' }).reason, 'unreadable torrent hash');
});
