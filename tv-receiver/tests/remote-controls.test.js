'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

function setup() {
  const nodes = {};
  const timers = new Map();
  const calls = [];
  const statuses = [];
  let timerId = 0;
  let command, keydown, listener, prepare;
  let state = 'NONE';
  let position = 30000;
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  for (const match of html.matchAll(/id="([^"]+)"/g)) {
    const classes = new Set();
    nodes[match[1]] = {
      textContent: '', disabled: false, handlers: {},
      classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c), toggle: (c, on) => on ? classes.add(c) : classes.delete(c) },
      addEventListener(type, fn) { this.handlers[type] = fn; }
    };
  }
  const avplay = {
    open() { state = 'IDLE'; },
    close() { state = 'NONE'; },
    stop() { calls.push('stop'); state = 'IDLE'; },
    setListener(value) { listener = value; },
    setDisplayRect() {},
    prepareAsync(fn) { prepare = () => { state = 'READY'; fn(); }; },
    play() { calls.push('play'); state = 'PLAYING'; },
    pause() { calls.push('pause'); state = 'PAUSED'; },
    getState: () => state,
    getDuration: () => 60000,
    getCurrentTime: () => position,
    seekTo(target, ok) { calls.push(target); position = target; if (ok) ok(); }
  };
  const context = vm.createContext({
    document: { getElementById: id => nodes[id], addEventListener(type, fn) { if (type === 'keydown') keydown = fn; } },
    navigator: { userAgent: 'test' }, APP_CONFIG: {},
    createLogger: () => ({ info() {}, warn() {}, error() {} }),
    createRelayClient(config, handlers) { command = handlers.onCommand; return { connect() {}, sendStatus(s) { statuses.push(s); } }; },
    webapis: { avplay },
    setTimeout(fn, delay) { timers.set(++timerId, { fn, delay }); return timerId; },
    clearTimeout(id) { timers.delete(id); }
  });
  for (const file of ['player.js', 'playback-history.js', 'app.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', file), 'utf8'), context);
  }
  return {
    nodes, calls, statuses, avplay,
    command,
    start() { command({ action: 'play', payload: { url: 'test.mp4', title: 'Test title' } }); },
    prepared() { prepare(); },
    get listener() { return listener; },
    key(code, repeat = false) { keydown({ keyCode: code, repeat, preventDefault() {} }); },
    flushSeek() { for (const [id, timer] of [...timers]) { if (timer.delay === 250) { timers.delete(id); timer.fn(); } } },
    expire() { for (const [id, timer] of [...timers]) { if (timer.delay === 4000) { timers.delete(id); timer.fn(); } } },
    hidden() { return nodes['player-controls'].classList.contains('hidden'); }
  };
}

test('OK reveals without pausing, then toggles; overlay and title auto-hide', () => {
  const app = setup();
  app.key(13);
  assert.equal(app.hidden(), true);
  app.start(); app.prepared();
  assert.equal(app.hidden(), false);
  app.expire();
  assert.equal(app.hidden(), true);
  app.key(13);
  assert.deepEqual(app.calls, ['play']);
  assert.equal(app.hidden(), false);
  app.key(13);
  assert.equal(app.nodes['play-pause'].textContent, 'Play');
  app.key(13, true);
  assert.deepEqual(app.calls, ['play', 'pause']);
  app.key(13);
  assert.deepEqual(app.calls, ['play', 'pause', 'play']);
  app.expire();
  assert.equal(app.hidden(), true);
});

test('arrows seek ten seconds, clamp at stream boundaries, and preserve pause', () => {
  const app = setup(); app.start(); app.prepared(); app.expire();
  app.key(37); app.flushSeek();
  assert.equal(app.hidden(), false);
  assert.equal(app.calls.at(-1), 20000);
  app.key(39); app.flushSeek();
  assert.equal(app.calls.at(-1), 30000);
  app.key(13);
  app.key(39); app.flushSeek();
  app.listener.onbufferingstart();
  app.listener.onbufferingcomplete();
  app.listener.oncurrentplaytime(40000);
  assert.equal(app.statuses.at(-1).state, 'paused');
  assert.equal(app.nodes['play-pause'].textContent, 'Play');
  for (let i = 0; i < 10; i++) { app.key(39); app.flushSeek(); }
  assert.equal(app.calls.at(-1), 59000);
  for (let i = 0; i < 10; i++) { app.key(37); app.flushSeek(); }
  assert.equal(app.calls.at(-1), 0);
  app.avplay.seekTo = () => { throw Error('Not seekable'); };
  assert.doesNotThrow(() => app.key(39));
});

test('loading ignores transport; buttons, media keys, Back and stop work', () => {
  const app = setup(); app.start();
  app.key(13); app.key(415);
  assert.deepEqual(app.calls, []);
  app.prepared();
  app.nodes['rewind'].handlers.click(); app.flushSeek();
  assert.equal(app.calls.at(-1), 20000);
  app.nodes['forward'].handlers.click(); app.flushSeek();
  assert.equal(app.calls.at(-1), 30000);
  app.nodes['play-pause'].handlers.click();
  assert.equal(app.calls.at(-1), 'pause');
  app.key(415); app.key(19); app.key(10252);
  assert.deepEqual(app.calls.slice(-3), ['play', 'pause', 'play']);
  app.key(40);
  assert.equal(app.hidden(), true);
  app.key(417); app.flushSeek(); app.key(412); app.flushSeek();
  assert.equal(app.calls.at(-1), 30000);
  app.key(413);
  assert.equal(app.hidden(), true);
  const count = app.calls.length;
  app.key(13); app.key(39);
  assert.equal(app.calls.length, count);
});

test('skips during buffering wait for playback and rapid skips coalesce', () => {
  const app = setup(); app.start();
  app.key(39); app.key(39);
  assert.deepEqual(app.calls, []);
  app.prepared(); app.flushSeek();
  assert.equal(app.calls.at(-1), 50000);
  app.key(37); app.key(37); app.flushSeek();
  assert.equal(app.calls.at(-1), 30000);
});


test('seeks arriving during an outstanding operation accumulate and failure retains target', () => {
  const app = setup(); app.start(); app.prepared();
  const pending = [];
  app.avplay.seekTo = (target, ok, fail) => { pending.push({target, ok, fail}); };
  app.command({action:'seek', payload:{deltaSec:10}}); app.flushSeek();
  assert.equal(pending[0].target, 40000);
  app.command({action:'seek', payload:{deltaSec:10}});
  app.command({action:'seek', payload:{deltaSec:10}});
  assert.equal(pending.length, 1);
  pending[0].ok();
  assert.equal(pending[1].target, 59000);
  pending[1].fail(new Error('Busy'));
  assert.equal(app.statuses.at(-1).pendingSeek.targetSec, 59);
  app.command({action:'seek', payload:{deltaSec:-20}}); app.flushSeek();
  assert.equal(pending[2].target, 39000);
  app.command({action:'stop'});
  pending[2].ok();
  assert.equal(app.statuses.at(-1).state, 'stopped');
});

test('new media invalidates old prepare callbacks', () => {
  const app = setup(); app.start(); app.command({action:'stop'}); app.prepared();
  assert.equal(app.calls.includes('play'), false);
});

test('Back returns straight to the menu while playing, paused, loading or controls hidden', () => {
  for (const phase of ['playing', 'paused', 'loading', 'hidden']) {
    const app = setup(); app.start();
    if (phase !== 'loading') app.prepared();
    if (phase === 'paused') app.key(19);
    if (phase === 'hidden') app.expire();
    app.key(10009);
    assert.equal(app.calls.at(-1), 'stop');
    assert.equal(app.nodes['idle-screen'].classList.contains('hidden'), false);
    assert.equal(app.nodes['player-screen'].classList.contains('hidden'), true);
    assert.equal(app.statuses.at(-1).state, 'stopped');
    const count = app.calls.length;
    app.key(10009, true); app.key(10009);
    assert.equal(app.calls.length, count);
    if (phase === 'loading') { app.prepared(); assert.equal(app.calls.includes('play'), false); }
    app.start(); app.prepared();
    assert.equal(app.nodes['player-screen'].classList.contains('hidden'), false);
  }
});

test('TV status exposes caption choices and companion commands update them', () => {
  const app = setup();
  app.avplay.getTotalTrackInfo = () => [{type:'TEXT',index:2,extra_info:'{"track_lang":"en"}'}];
  app.avplay.setSilentSubtitle = () => {};
  app.avplay.setSelectTrack = (type, index) => app.calls.push([type,index]);
  app.start(); app.prepared();
  const captions = app.statuses.at(-1).captions;
  assert.equal(captions.tracks[0].id, 'embedded:2');
  app.command({action:'captions',payload:{mediaId:captions.mediaId,trackId:'embedded:2'}});
  assert.deepEqual(app.calls.at(-1), ['TEXT',2]);
  assert.equal(app.statuses.at(-1).captions.selectedId, 'embedded:2');
  app.key(10009);
  assert.equal(app.statuses.at(-1).captions.mediaId, null);
});
