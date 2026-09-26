'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createShares } = require('../src/share');

const FILE = '/media/0123456789abcdef.mp4';
const OTHER = '/media/fedcba9876543210.mp4';
const HASH = 'a'.repeat(40);
const SEGMENT = `/media/torrents/${HASH}-0/seg00042.ts`;
const HOURS = 60 * 60 * 1000;

function shares(at = 1_000_000_000_000) {
  let clock = at;
  const s = createShares({ secret: Buffer.from('test secret'), now: () => clock });
  s.advance = (ms) => { clock += ms; };
  return s;
}

test('a key opens any saved video for three hours', () => {
  const s = shares();
  const key = s.issue();
  assert.match(key.prefix, /^\/s\/[0-9a-z]+\/[A-Za-z0-9_-]{43}$/);
  assert.strictEqual(key.expiresAt, 1_000_000_000_000 + 3 * HOURS);
  assert.strictEqual(key.expiresIn, 3 * HOURS);
  for (const path of [FILE, OTHER, SEGMENT, `/media/torrents/${HASH}-0/original/index.m3u8`]) {
    assert.strictEqual(s.open(key.prefix + path), path);
  }
  s.advance(3 * HOURS - 1000);
  assert.strictEqual(s.open(key.prefix + FILE), FILE);
  s.advance(1000);
  assert.strictEqual(s.open(key.prefix + FILE), null);
});

test('a changed signature or a later expiry is refused', () => {
  const s = shares();
  const { prefix } = s.issue();
  const [, , expiry, sig] = prefix.split('/');
  const flipped = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
  assert.strictEqual(s.open(prefix.replace(sig, flipped) + FILE), null);
  const later = (parseInt(expiry, 36) + 3600).toString(36);
  assert.strictEqual(s.open(prefix.replace('/' + expiry + '/', '/' + later + '/') + FILE), null);
});

test('another secret (a restarted resolver) refuses old keys', () => {
  const { prefix } = shares().issue();
  const other = createShares({ secret: Buffer.from('another secret'), now: () => 1_000_000_000_000 });
  assert.strictEqual(other.open(prefix + FILE), null);
});

test('a key opens nothing but saved videos', () => {
  const s = shares();
  const { prefix } = s.issue();
  for (const path of ['/media/library-state.json', '/media/subtitle-0123456789abcdef.smi', '/jobs', '/cache',
    '/media/cache-index.json', `/media/torrents/${HASH}-0/../../library-state.json`, `/media/torrents/${HASH}/index.m3u8`]) {
    assert.strictEqual(s.open(prefix + path), null, path);
  }
  assert.strictEqual(s.open(FILE), null);
});

test('a key for one video opens only that video', () => {
  const s = shares();
  const { prefix } = s.issue(FILE);
  assert.strictEqual(s.open(prefix + FILE), FILE);
  assert.strictEqual(s.open(prefix + OTHER), null);
  assert.strictEqual(s.open(prefix + SEGMENT), null);
  const torrent = s.issue(`/media/torrents/${HASH}-0/index.m3u8`).prefix;
  assert.strictEqual(s.open(torrent + SEGMENT), SEGMENT, 'its segments');
  assert.strictEqual(s.open(torrent + `/media/torrents/${HASH}-0/original/index.m3u8`), `/media/torrents/${HASH}-0/original/index.m3u8`);
  assert.strictEqual(s.open(torrent + `/media/torrents/${HASH}-1/seg00001.ts`), null, 'not another file of the torrent');
  assert.strictEqual(s.open(torrent + FILE), null);
  s.advance(3 * HOURS);
  assert.strictEqual(s.open(prefix + FILE), null, 'and it expires too');
});

test('a one-video key is only made for saved videos', () => {
  const s = shares();
  assert.strictEqual(s.issue('/media/library-state.json'), null);
  assert.strictEqual(s.issue(''), null);
});
