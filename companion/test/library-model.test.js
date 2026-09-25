'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
global.ContentPolicy = require('../js/content-policy.js');
const LibraryModel = require('../js/library-model.js');

const show = { type: 'series', id: 'tt1', name: 'Show', poster: 'p.jpg' };
function episode(season, episode, extra) {
  return Object.assign({ kind: 'torrents', key: 's' + season + 'e' + episode, category: 'series',
    metadata: Object.assign({}, show, { videoId: 'tt1:' + season + ':' + episode, season, episode }) }, extra);
}
const cache = {
  entries: [
    { kind: 'media', key: 'yt', category: 'youtube', title: 'Clip', thumbUrl: 't.jpg', createdAt: 5,
      progress: { positionSec: 30, durationSec: 100, watched: false, updatedAt: 50 } },
    { kind: 'media', key: 'x', category: 'porn', title: 'Hidden' }
  ],
  torrents: [
    { kind: 'torrents', key: 'film', category: 'movies', createdAt: 10,
      metadata: { type: 'movie', id: 'tt9', name: 'Film' }, progress: { positionSec: 0, durationSec: 0, watched: true, updatedAt: 20 } },
    episode(1, 1, { progress: { positionSec: 3000, durationSec: 3000, watched: true, updatedAt: 90 } }),
    episode(1, 2, { partial: true }),
    { kind: 'torrents', key: 'adult', category: 'plus18', metadata: { type: 'movie', id: 'a1', name: 'Adult', addon: 'plus18' } }
  ],
  titles: [Object.assign({}, show, { videos: [
    { id: 'tt1:1:2', season: 1, episode: 2, released: '2026-09-03T00:00:00Z', progress: { positionSec: 0, durationSec: 0, watched: false } },
    { id: 'tt1:1:1', season: 1, episode: 1, released: '2026-09-01T00:00:00Z', progress: { positionSec: 3000, durationSec: 3000, watched: true, updatedAt: 90 } },
    { id: 'tt1:0:1', season: 0, episode: 1 }
  ] })]
};

test('builds one item per title and keeps sections apart', () => {
  const normal = LibraryModel.build(cache, 'normal');
  assert.deepEqual(normal.map((item) => item.name).sort(), ['Clip', 'Film', 'Show']);
  const series = LibraryModel.findTitle(normal, 'series', 'tt1');
  assert.equal(series.files.length, 2);
  assert.equal(series.saved, 1);
  assert.deepEqual(series.videos.map((v) => v.id), ['tt1:1:1', 'tt1:1:2', 'tt1:0:1']);
  assert.deepEqual(LibraryModel.build(cache, 'plus18').map((item) => item.name).sort(), ['Adult', 'Hidden']);
  assert.deepEqual(LibraryModel.types(normal).map((t) => t.value), ['movie', 'series', 'youtube']);
});

test('filters, sorts and finds episode files', () => {
  const items = LibraryModel.build(cache, 'normal');
  assert.deepEqual(LibraryModel.filter(items, { sort: 'az' }).map((i) => i.name), ['Clip', 'Film', 'Show']);
  assert.deepEqual(LibraryModel.filter(items, { sort: 'lastwatched' }).map((i) => i.name), ['Show', 'Clip', 'Film']);
  assert.deepEqual(LibraryModel.filter(items, { type: 'movie' }).map((i) => i.name), ['Film']);
  assert.deepEqual(LibraryModel.filter(items, { text: 'cli' }).map((i) => i.name), ['Clip']);
  const series = LibraryModel.findTitle(items, 'series', 'tt1');
  assert.equal(LibraryModel.episodeStatus(series, series.videos[0]).saved, 'saved');
  assert.equal(LibraryModel.episodeStatus(series, series.videos[1]).saved, 'partial');
  assert.equal(LibraryModel.filesFor(LibraryModel.findTitle(items, 'movie', 'tt9')).length, 1);
});

test('continue watching offers the next episode and unfinished files', () => {
  const next = LibraryModel.continueWatching(LibraryModel.build(cache, 'normal'));
  assert.equal(next[0].item.name, 'Show');
  assert.equal(next[0].video.id, 'tt1:1:2');
  assert.equal(next[1].item.name, 'Clip');
  assert.equal(LibraryModel.progressRatio(next[1].progress), 0.3);
});

test('calendar lists library episodes by release day', () => {
  const days = LibraryModel.calendar(LibraryModel.build(cache, 'normal'), 2026, 8);
  assert.deepEqual(Object.keys(days), ['1', '3']);
  assert.equal(days[3][0].video.id, 'tt1:1:2');
});
