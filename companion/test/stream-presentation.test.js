'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const createStremioStreamPresentation = require('../js/stremio-stream-presentation.js');

test('describes direct links, magnets and torrents', () => {
  const display = createStremioStreamPresentation();
  assert.equal(display.describeStream({ url: 'https://video.example/a.mp4', title: 'A.1080p' }).infoHash, null);
  const hash = '0123456789abcdef0123456789abcdef01234567';
  assert.equal(display.describeStream({ url: 'magnet:?xt=urn:btih:' + hash + '&dn=a' }).infoHash, hash);
  assert.equal(display.describeStream({ infoHash: hash, fileIdx: 2 }).fileIdx, 2);
});
