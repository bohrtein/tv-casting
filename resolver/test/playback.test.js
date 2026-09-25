'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { LibraryState } = require('../src/library-state');
const { libraryFields } = require('../src/library');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'casting-history-'));
  t.after(() => { for (const file of fs.readdirSync(dir)) { if (file === 'library-art') fs.rmdirSync(path.join(dir, file)); else fs.unlinkSync(path.join(dir, file)); } fs.rmdirSync(dir); });
  const state = new LibraryState(dir);
  const meta = { id: 'tt123', type: 'series', name: 'A show', videoId: 'a', season: 1, episode: 1,
    videos: [{ id: 'a', season: 1, episode: 1 }, { id: 'b', season: 1, episode: 2 }, { id: 'c', season: 2, episode: 1 }] };
  state.remember(libraryFields({ metadata: meta }).metadata);
  const entries = meta.videos.map(v => ({ key: v.id, kind: 'media', metadata: { ...meta, videoId: v.id, season: v.season, episode: v.episode } }));
  return { state, entries, dir };
}
test('watch position survives restart and is shared across alternative copies of an episode', t => {
  const { state, entries, dir } = fixture(t);
  state.update(entries[0], { positionSec: 123, durationSec: 900 });
  const reloaded = new LibraryState(dir);
  assert.equal(reloaded.progress({ ...entries[0], key: 'other-encode' }).positionSec, 123);
  assert.equal(reloaded.progress(entries[1]).positionSec, 0);
  reloaded.update(entries[0], { positionSec: 900, durationSec: 900, completed: true });
  assert.equal(reloaded.progress(entries[0]).watched, true);
  reloaded.update(entries[0], { positionSec: 15, durationSec: 900 });
  assert.equal(reloaded.progress(entries[0]).watched, false);
  assert.throws(() => state.update(entries[0], { positionSec: -1, durationSec: 10 }));
});
test('autoplay follows immediate episode order across seasons without skipping unavailable episodes', t => {
  const { state, entries } = fixture(t);
  assert.equal(state.next(entries[0], entries), entries[1]);
  assert.equal(state.next(entries[1], entries), entries[2]);
  assert.equal(state.next(entries[2], entries), null);
  assert.equal(state.next(entries[0], [entries[0], entries[2]]), null);
  assert.equal(state.next(entries[0], [entries[0], { ...entries[1], partial: true }, entries[2]]), null);
  assert.equal(state.next(entries[0], [{ ...entries[1], needsTvCopy: true }]), null);
  assert.equal(state.next({ ...entries[0], partial: true }, entries), null);
  assert.equal(state.next({ ...entries[0], metadata: { ...entries[0].metadata, season: 0 } }, entries), null);
});
test('partial-file EOF does not mark watched and catalogs survive legacy updates', t => {
  const { state, entries, dir } = fixture(t);
  state.update({ ...entries[0], partial: true }, { positionSec: 90, durationSec: 900, completed: true });
  assert.equal(state.progress(entries[0]).watched, false);
  const { videos, ...legacy } = entries[0].metadata;
  state.remember(legacy);
  assert.equal(Object.values(new LibraryState(dir).data.titles)[0].videos.length, 3);
});
