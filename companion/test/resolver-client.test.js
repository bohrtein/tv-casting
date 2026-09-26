'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const createResolverClient = require('../js/resolver-client');

const hash = 'a'.repeat(40);

function capture(config) {
  const sent = [];
  global.fetch = (url, options) => {
    sent.push({ url, body: JSON.parse(options.body) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'job' }) });
  };
  return { client: createResolverClient(config), sent };
}

test('torrents started through the HTTPS proxy reach the resolver as LAN Stremio URLs', async () => {
  const { client, sent } = capture({
    LAN_HOST: '192.168.2.31',
    RESOLVER_URL: 'https://home.example/resolver',
    STREMIO_SERVER_URL: 'https://home.example/stremio'
  });
  await client.startDownload('https://home.example/stremio/' + hash + '/2?tr=x', { title: 'Film' }, true);
  assert.equal(sent[0].url, 'https://home.example/resolver/torrent');
  assert.deepEqual(sent[0].body, { url: 'http://192.168.2.31:11470/' + hash + '/2?tr=x', title: 'Film' });
});

test('LAN and third-party URLs are sent unchanged', async () => {
  const { client, sent } = capture({
    LAN_HOST: '192.168.2.31',
    RESOLVER_URL: 'http://192.168.2.31:8788',
    STREMIO_SERVER_URL: 'http://192.168.2.31:11470'
  });
  await client.startDownload('http://192.168.2.31:11470/' + hash + '/-1', {}, true);
  await client.startDownload('https://video.example/stremio/movie', {});
  assert.equal(sent[0].body.url, 'http://192.168.2.31:11470/' + hash + '/-1');
  assert.equal(sent[1].body.url, 'https://video.example/stremio/movie');
});
