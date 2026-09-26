'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function setup() {
  const calls = [], downloads = [], timers = new Map();
  let prepared, state = 'NONE', serial = 0;
  const avplay = {
    open() { state = 'IDLE'; }, close() { state = 'NONE'; }, stop() { calls.push('stop'); },
    play() { state = 'PLAYING'; }, pause() { state = 'PAUSED'; }, getState() { return state; },
    getDuration() { return 100000; }, setListener() {}, setDisplayRect() {}, setDisplayMethod() {},
    prepareAsync(ok) { prepared = ok; },
    getTotalTrackInfo() { return [{ type: 'TEXT', index: 2, extra_info: '{"track_lang":"en"}' }, { type: 'TEXT', index: 3, extra_info: 'broken metadata' }]; },
    setSilentSubtitle(off) { calls.push(['hidden', off]); },
    setSelectTrack(type, index) { calls.push([type, index]); },
    setExternalSubtitlePath(p) { calls.push(['external', p]); }
  };
  const context = vm.createContext({ webapis: { avplay },
    tizen: { DownloadRequest: function (url) { this.url = url; }, download: { start(req, cb) { downloads.push(cb); } } },
    createLogger: () => ({ info() {}, warn() {}, error() {} }),
    setTimeout(fn) { timers.set(++serial, fn); return serial; }, clearTimeout(id) { timers.delete(id); }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/player.js'), 'utf8'), context);
  const player = context.createPlayer({ onStateChange() {}, onPlayTime() {}, onError(e) { throw new Error(e.message); } });
  player.play('movie.mp4'); prepared();
  return { player, calls, downloads, avplay, timers, prepared: () => prepared(),
    select(payload) { player.setCaptions({ mediaId: player.getCaptions().mediaId, ...payload }); } };
}

test('discovers caption languages, changes tracks, and hides captions without stopping playback', () => {
  const app = setup();
  assert.equal(app.player.getCaptions().tracks[0].label, 'en (track 3)');
  assert.equal(app.player.getCaptions().tracks.length, 2);
  app.select({ trackId: 'embedded:2' });
  assert.deepEqual(app.calls.slice(-2), [['TEXT', 2], ['hidden', false]]);
  assert.equal(app.player.getCaptions().selectedId, 'embedded:2');
  app.player.pause(); app.select({ trackId: null });
  assert.deepEqual(app.calls.at(-1), ['hidden', true]);
  assert.equal(app.player.getCaptions().selectedId, null);
  assert.equal(app.avplay.getState(), 'PAUSED');
  assert.equal(app.calls.includes('stop'), false);
});

test('caption failures leave the video running and preserve the selected track', () => {
  const app = setup(); app.select({ trackId: 'embedded:2' });
  app.avplay.setSelectTrack = () => { throw Error('Unsupported track'); };
  app.select({ trackId: 'embedded:3' });
  assert.match(app.player.getCaptions().error, /Unsupported track/);
  assert.equal(app.player.getCaptions().selectedId, 'embedded:2');
  app.select({ subtitleUrl: 'http://local/captions.smi' });
  app.downloads[0].onfailed(1, Error('Download failed'));
  assert.match(app.player.getCaptions().error, /Download failed/);
  assert.equal(app.avplay.getState(), 'PLAYING');
});

test('live external subtitles preserve playback and ignore downloads superseded by Off or Stop', () => {
  const app = setup(); app.player.pause();
  app.select({ subtitleUrl: 'http://local/captions.smi' });
  app.downloads[0].oncompleted(1, '/local/captions.smi');
  assert.equal(app.player.getCaptions().selectedId, 'external');
  assert.equal(app.avplay.getState(), 'PAUSED');
  app.select({ subtitleUrl: 'http://local/other.smi' });
  app.select({ trackId: null });
  const count = app.calls.length;
  app.downloads[1].oncompleted(2, '/local/stale.smi');
  assert.equal(app.calls.length, count);
  app.select({ subtitleUrl: 'http://local/third.smi' });
  const oldMediaId = app.player.getCaptions().mediaId;
  app.player.stop(); app.downloads[2].oncompleted(3, '/local/stale.smi');
  app.player.play('new.mp4'); app.prepared();
  app.player.setCaptions({ mediaId: oldMediaId, trackId: 'embedded:2' });
  assert.equal(app.player.getCaptions().selectedId, null);
  assert.equal(app.player.getCaptions().tracks.some(t => t.id === 'external'), false);
});

test('caption download timeout ignores a late success', () => {
  const app = setup(); app.select({ subtitleUrl: 'http://local/slow.smi' });
  for (const fn of [...app.timers.values()]) fn();
  assert.match(app.player.getCaptions().error, /timed out/);
  app.downloads[0].oncompleted(1, '/local/late.smi');
  assert.equal(app.player.getCaptions().selectedId, null);
});

test('missing or malformed caption metadata cannot break playback preparation', () => {
  const app = setup();
  for (const tracks of [null, [{type:'TEXT',index:2,extra_info:'null'}, null]]) {
    app.player.stop();
    app.avplay.getTotalTrackInfo = () => tracks;
    app.player.play('other.mp4');
    assert.doesNotThrow(app.prepared);
    assert.equal(app.avplay.getState(), 'PLAYING');
  }
});
