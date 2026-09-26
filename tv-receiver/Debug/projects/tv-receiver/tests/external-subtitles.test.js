'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

test('downloads SAMI before AVPlay prepares and ignores a stale download', () => {
  const order = [];
  const downloads = [];
  let prepared;
  const avplay = {
    open() { order.push('open'); }, stop() {}, close() {}, play() { order.push('play'); },
    setListener() {}, setDisplayRect() {}, setDisplayMethod() {},
    setExternalSubtitlePath(value) { order.push('subtitle:' + value); },
    prepareAsync(ok) { order.push('prepare'); prepared = ok; },
    getDuration() { return 100000; }, getCurrentStreamInfo() { return []; }
  };
  const context = vm.createContext({
    webapis: { avplay }, tizen: {
      DownloadRequest: function (url, directory) { this.url = url; this.directory = directory; },
      download: { start(request, callbacks) { downloads.push({ request, callbacks }); } }
    },
    window: { innerWidth: 1920, innerHeight: 1080, addEventListener() {} },
    document: { getElementById() { return null; }, addEventListener() {} },
    createLogger() { return { info() {}, warn() {}, error() {} }; },
    clearTimeout() {}, setTimeout() {}
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/player.js'), 'utf8'), context);
  const player = context.createPlayer({ onStateChange() {}, onPlayTime() {}, onError(error) { throw Error(error.message); } });
  player.play('http://media/movie.mp4', 0, 'http://media/captions.smi');
  assert.equal(downloads[0].request.directory, 'wgt-private-tmp');
  assert.deepEqual(order, ['open']);
  downloads[0].callbacks.oncompleted(1, '/local/captions.smi');
  assert.deepEqual(order, ['open', 'subtitle:/local/captions.smi', 'prepare']);
  prepared();
  player.play('http://media/other.mp4', 0, 'http://media/other.smi');
  player.stop();
  downloads[1].callbacks.oncompleted(2, '/local/other.smi');
  assert.equal(order.filter((entry) => entry === 'prepare').length, 1);
});
