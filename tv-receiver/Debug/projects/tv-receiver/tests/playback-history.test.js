'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../js/playback-history.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup() {
  const requests = [];
  function XMLHttpRequest() { requests.push(this); }
  XMLHttpRequest.prototype.open = function (method, url) { this.url = url; };
  XMLHttpRequest.prototype.setRequestHeader = function () {};
  XMLHttpRequest.prototype.send = function (body) { this.body = JSON.parse(body); };
  const ctx = vm.createContext({ XMLHttpRequest }); vm.runInContext(source, ctx);
  return { history: ctx.createPlaybackHistory(), requests, reply(i, value) { const r = requests[i]; r.status = 200; r.responseText = JSON.stringify(value); r.onload(); } };
}
test('resume lookup and progress run on TV and natural completion advances once', async () => {
  const { history, requests, reply } = setup(); const plays = [];
  history.start({ url: 'http://resolver/media/a.mp4' }, p => plays.push(p)); await tick();
  reply(0, { startPositionSec: 42 }); await tick(); assert.equal(plays[0].startPositionSec, 42);
  history.time(123, 900); history.flush(); await tick();
  assert.equal(requests[1].body.positionSec, 123); reply(1, {}); await tick();
  history.completed(p => plays.push(p)); history.completed(p => plays.push(p)); await tick();
  assert.equal(requests[2].body.event, 'completed');
  reply(2, { next: { url: 'http://resolver/media/b.mp4' } }); await tick();
  assert.equal(plays.length, 2);
});
test('stop during lookup or completion cancels late playback; manual stop never completes', async () => {
  const { history, requests, reply } = setup(); const plays = [];
  history.start({ url: 'http://resolver/media/a.mp4' }, p => plays.push(p)); await tick();
  history.stop(); reply(0, { startPositionSec: 42 }); await tick(); assert.equal(plays.length, 0);
  history.start({ url: 'http://resolver/media/b.mp4' }, p => plays.push(p)); await tick(); reply(1, {}); await tick();
  history.time(10, 100); history.completed(p => plays.push(p)); await tick(); history.stop();
  reply(2, { next: { url: 'http://resolver/media/c.mp4' } }); await tick(); assert.equal(plays.length, 1);
  assert.equal(requests.filter(r => r.body.event === 'completed').length, 1);
});
test('failed history service falls back to playback and direct URLs do not contact it', async () => {
  const { history, requests } = setup(); const plays = [];
  history.start({ url: 'http://resolver/media/a.mp4' }, p => plays.push(p)); await tick();
  requests[0].ontimeout(); await tick(); assert.equal(plays[0].startPositionSec, 0);
  history.start({ url: 'https://video.example/movie.mp4' }, p => plays.push(p));
  assert.equal(plays.length, 2); assert.equal(requests.length, 1);
});

test('repeated play while resume lookup is pending does not bypass the saved position', async () => {
  const { history, requests, reply } = setup(); const plays = [];
  const payload = { url: 'http://resolver/media/a.mp4' };
  history.start(payload, p => plays.push(p)); history.start(payload, p => plays.push(p)); await tick();
  assert.equal(plays.length, 0); assert.equal(requests.length, 1);
  reply(0, { startPositionSec: 77 }); await tick();
  assert.equal(plays.length, 1); assert.equal(plays[0].startPositionSec, 77);
});
