'use strict';

// The receiver owns progress and automatic continuation, independent of companions.
function createPlaybackHistory() {
  var current = null;
  var generation = 0;
  var lastSaved = 0;
  var queue = Promise.resolve();
  function request(item, event) {
    return new Promise(function (resolve) {
      var match = /^(https?:\/\/[^/]+)\/media\//.exec(item.url);
      if (!match || typeof XMLHttpRequest === 'undefined') { resolve(null); return; }
      var xhr = new XMLHttpRequest();
      xhr.open('POST', match[1] + '/playback');
      xhr.timeout = 5000;
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.onload = function () {
        try { resolve(xhr.status === 200 ? JSON.parse(xhr.responseText) : null); } catch (_) { resolve(null); }
      };
      xhr.onerror = xhr.ontimeout = function () { resolve(null); };
      xhr.send(JSON.stringify({ url: item.url, event: event, positionSec: item.positionSec, durationSec: item.durationSec }));
    });
  }
  function send(item, event) {
    var snapshot = Object.assign({}, item);
    queue = queue.then(function () { return request(snapshot, event); }).catch(function () { return null; });
    return queue;
  }
  function flush() { if (current && current.started) send(current, 'progress'); }
  return {
    start: function (payload, play, stopPlayer) {
      // Existing loaded URL is a pause/resume command, not a new viewing session.
      if (current && current.url === payload.url) { if (!current.loading) play(payload); return; }
      flush();
      if (stopPlayer) stopPlayer();
      var token = ++generation;
      current = { url: payload.url, positionSec: 0, durationSec: 0, started: false, loading: true };
      lastSaved = Date.now();
      if (!/^https?:\/\/[^/]+\/media\//.test(payload.url)) { current.loading = false; play(payload); return; }
      send(current, 'start').then(function (result) {
        if (token !== generation) return;
        var position = typeof payload.startPositionSec === 'number' ? payload.startPositionSec : (result && result.startPositionSec) || 0;
        current.positionSec = position; current.loading = false;
        play(Object.assign({}, payload, { startPositionSec: position }));
      });
    },
    time: function (position, duration) {
      if (!current) return;
      current.positionSec = position; current.durationSec = duration; current.started = true;
      if (Date.now() - lastSaved >= 5000) { lastSaved = Date.now(); flush(); }
    },
    flush: flush,
    stop: function () { flush(); current = null; generation++; },
    completed: function (playNext) {
      if (!current) return;
      var token = ++generation;
      var ended = current; current = null;
      send(ended, 'completed').then(function (result) {
        if (token === generation && result && result.next) playNext(result.next);
      });
    }
  };
}
