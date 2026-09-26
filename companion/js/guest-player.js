'use strict';

// For guests (guest-gateway.js): "This device" under Play on, a player
// over the page. relay-client.js sends it the commands meant for this
// device (its localTarget), and it reports status like a receiver does, so
// the remote at the bottom works for it too. Progress goes to the
// guest door like the receiver's does (playback-history.js), so each
// person resumes where they stopped and moves on to the next saved episode.
function createGuestPlayer(handlers) {
  handlers = handlers || {};
  var root = document.createElement('div');
  root.className = 'cn-gp';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Player');
  root.innerHTML =
    '<div class="cn-gp-bar">' +
      '<span class="cn-gp-title"></span>' +
      '<button type="button" class="mx-btn mx-sm cn-gp-close">close</button>' +
    '</div>' +
    '<video class="cn-gp-video" controls playsinline preload="metadata"></video>' +
    '<p class="cn-gp-status" role="status" aria-live="polite"></p>';
  document.body.appendChild(root);
  var video = root.querySelector('video');
  var titleEl = root.querySelector('.cn-gp-title');
  var statusEl = root.querySelector('.cn-gp-status');
  var hls = null, loadedUrl = '', generation = 0, hlsScript = null;

  var playback = createPlaybackHistory({
    onWaiting: function () { say('Looking up the next episode…'); },
    onIdle: function () { close(); },
    onError: function (message) { say(message); }
  });

  function say(text) { statusEl.textContent = text || ''; }
  var lastReport = 0;
  function report(state) {
    lastReport = Date.now();
    if (handlers.onStatus) handlers.onStatus({ type: 'status', state: state, title: titleEl.textContent,
      positionSec: Number.isFinite(video.currentTime) ? video.currentTime : 0,
      durationSec: Number.isFinite(video.duration) ? video.duration : 0 });
  }
  function loadHls() {
    if (typeof Hls !== 'undefined') return Promise.resolve();
    if (!hlsScript) {
      hlsScript = new Promise(function (resolve, reject) {
        var script = document.createElement('script');
        script.src = 'vendor/hls.min.js';
        script.onload = resolve;
        script.onerror = function () { reject(new Error('The player could not load.')); };
        document.head.appendChild(script);
      });
    }
    return hlsScript;
  }
  function unload() {
    generation++;
    loadedUrl = '';
    video.pause();
    if (hls) { hls.destroy(); hls = null; }
    video.removeAttribute('src');
    video.load();
  }
  function begin(payload) {
    if (loadedUrl === payload.url) { video.play().catch(function () {}); return; }
    unload();
    loadedUrl = payload.url;
    var token = generation;
    titleEl.textContent = payload.title || '';
    say('Loading…');
    video.onloadedmetadata = function () {
      if (token !== generation) return;
      if (payload.startPositionSec) video.currentTime = payload.startPositionSec;
      video.play().then(function () { say(''); }, function () { say('Press play to start.'); });
    };
    if (/\.m3u8(?:[?#]|$)/i.test(payload.url) && !video.canPlayType('application/vnd.apple.mpegurl')) {
      loadHls().then(function () {
        if (token !== generation) return;
        if (!Hls.isSupported()) { say("This browser can't play this video."); return; }
        hls = new Hls();
        hls.loadSource(payload.url);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, function (_, data) { if (data.fatal && token === generation) say('Playback failed: ' + data.details); });
      }, function (err) { say(err.message); });
    } else {
      video.src = payload.url;
    }
  }
  function play(payload) {
    root.hidden = false;
    document.body.classList.add('cn-gp-open');
    playback.start(payload, begin, unload);
  }
  function close() {
    playback.stop();
    unload();
    root.hidden = true;
    document.body.classList.remove('cn-gp-open');
    say('');
    report('stopped');
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {});
    if (handlers.onStopped) handlers.onStopped();
  }

  root.querySelector('.cn-gp-close').addEventListener('click', close);
  document.addEventListener('keydown', function (event) { if (event.key === 'Escape' && !root.hidden) close(); });
  video.addEventListener('timeupdate', function () {
    if (!loadedUrl) return;
    playback.time(video.currentTime, Number.isFinite(video.duration) ? video.duration : 0);
    if (Date.now() - lastReport > 1000) report(video.paused ? 'paused' : 'playing');
  });
  video.addEventListener('pause', function () { if (loadedUrl && !video.ended) { playback.flush(); report('paused'); } });
  video.addEventListener('waiting', function () { if (loadedUrl) { say('Loading…'); report('buffering'); } });
  video.addEventListener('playing', function () { say(''); report('playing'); });
  video.addEventListener('seeked', function () { if (loadedUrl) report(video.paused ? 'paused' : 'playing'); });
  video.addEventListener('ended', function () {
    if (!loadedUrl) return;
    loadedUrl = '';
    playback.completed(play);
  });
  video.addEventListener('error', function () { if (loadedUrl) say("This video can't play here."); });
  window.addEventListener('pagehide', function () { playback.flush(); });

  return {
    sendCommand: function (action, payload) {
      if (action === 'play' && payload) play(payload);
      else if (action === 'pause') video.pause();
      else if (action === 'resume') video.play().catch(function () {});
      else if (action === 'stop') close();
      else if (action === 'seek' && payload) {
        var target = typeof payload.deltaSec === 'number' ? video.currentTime + payload.deltaSec : payload.positionSec;
        if (Number.isFinite(target)) video.currentTime = Math.max(0, target);
      }
      return true;
    }
  };
}

if (typeof module !== 'undefined') module.exports = createGuestPlayer;
