'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createShares, mediaPathOf } = require('../src/share');

const FILE = '/media/0123456789abcdef.mp4';
const HASH = 'a'.repeat(40);
const PLAYLIST = `/media/torrents/${HASH}-0/index.m3u8`;

function shares(at = 1_000_000_000_000) {
  let clock = at;
  const s = createShares({ secret: Buffer.from('test secret'), ttlMs: 60_000, now: () => clock });
  s.advance = (ms) => { clock += ms; };
  return s;
}

test('a signed link opens its own video until it expires', () => {
  const s = shares();
  const link = s.sign(FILE);
  assert.match(link.path, /^\/s\/[0-9a-z]+\/[A-Za-z0-9_-]{43}\/media\/0123456789abcdef\.mp4$/);
  assert.strictEqual(s.open(link.path), FILE);
  s.advance(59_000);
  assert.strictEqual(s.open(link.path), FILE);
  s.advance(1_000);
  assert.strictEqual(s.open(link.path), null);
});

test('a link cannot be moved to another video', () => {
  const s = shares();
  const link = s.sign(FILE).path;
  assert.strictEqual(s.open(link.replace('0123456789abcdef', 'fedcba9876543210')), null);
  assert.strictEqual(s.open(link.replace(FILE, PLAYLIST)), null);
});

test('a changed signature or expiry is refused', () => {
  const s = shares();
  const link = s.sign(FILE).path;
  const [, , expiry, sig] = link.split('/');
  const flipped = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
  assert.strictEqual(s.open(link.replace(sig, flipped)), null);
  assert.strictEqual(s.open(link.replace('/' + expiry + '/', '/' + (parseInt(expiry, 36) + 3600).toString(36) + '/')), null);
});

test('another secret (a restarted resolver) refuses old links', () => {
  const link = shares().sign(FILE).path;
  const other = createShares({ secret: Buffer.from('another secret'), ttlMs: 60_000, now: () => 1_000_000_000_000 });
  assert.strictEqual(other.open(link), null);
});

test('a saved torrent link covers its segments and original copy, not other torrents', () => {
  const s = shares();
  const link = s.sign(PLAYLIST).path;
  const base = link.slice(0, link.lastIndexOf('/') + 1);
  assert.strictEqual(s.open(base + 'seg00042.ts'), `/media/torrents/${HASH}-0/seg00042.ts`);
  assert.strictEqual(s.open(base + 'original/index.m3u8'), `/media/torrents/${HASH}-0/original/index.m3u8`);
  assert.strictEqual(s.open(base.replace(`${HASH}-0`, `${HASH}-1`) + 'seg00001.ts'), null);
  assert.strictEqual(s.open(base + '../../library-state.json'), null);
});

test('only saved videos can be signed', () => {
  const s = shares();
  for (const path of ['/media/library-state.json', '/media/subtitle-0123456789abcdef.smi', '/jobs', '/cache',
    `/media/torrents/${HASH}-0/../../x.mp4`, '/media/0123456789abcdef.mp4/../x']) {
    assert.strictEqual(s.sign(path), null, path);
  }
});

test('the media path is found whichever address the video came through', () => {
  assert.strictEqual(mediaPathOf('http://192.168.2.31:8788' + FILE), FILE);
  assert.strictEqual(mediaPathOf('https://home.example.ts.net/resolver' + PLAYLIST), PLAYLIST);
  assert.strictEqual(mediaPathOf('https://cdn.example.com/video.mp4'), null);
  assert.strictEqual(mediaPathOf('not a url'), null);
});
