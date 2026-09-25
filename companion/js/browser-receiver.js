'use strict';
(function () {
  var video = document.getElementById('receiver-video');
  var status = document.getElementById('receiver-status');
  var title = document.getElementById('receiver-title');
  var tap = document.getElementById('receiver-play');
  var stopButton = document.getElementById('receiver-stop');
  var connectedName = document.getElementById('receiver-connected-name');
  var socket, hls, loadedUrl = '', generation = 0, enabled = false, retry, activeName = '', announced = false;
  var receiverId, channel;
  try {
    receiverId = sessionStorage.getItem('tvc.receiverId');
    var savedName = sessionStorage.getItem('tvc.receiverName');
    if (savedName) document.getElementById('receiver-name').value = savedName;
    if (!receiverId) {
      receiverId = crypto.randomUUID();
      sessionStorage.setItem('tvc.receiverId', receiverId);
    }
  } catch (_) { receiverId = undefined; }
  if (typeof BroadcastChannel !== 'undefined') channel = new BroadcastChannel('tvc.receiver');
  var state = 'idle';
  var playback = createPlaybackHistory({
    onWaiting: function () { report('buffering', 'Looking up next episode…'); stopButton.hidden = false; },
    onIdle: function () { report('stopped'); stopButton.hidden = true; },
    onError: fail
  });
  function report(nextState, message, error) {
    state = nextState;
    status.textContent = message || state;
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({
      type: 'status', state: state, title: title.textContent,
      positionSec: Number.isFinite(video.currentTime) ? video.currentTime : 0,
      durationSec: Number.isFinite(video.duration) ? video.duration : 0,
      error: error ? { code: 'BROWSER_PLAYBACK_FAILED', message: error } : undefined
    }));
  }
  function fail(message) {
    playback.stop();
    report('error', message, message);
  }
  function resume() {
    var token = generation;
    video.play().then(function () { if (token === generation) tap.hidden = true; }).catch(function (err) {
      if (token !== generation) return;
      if (err.name === 'NotAllowedError') {
        tap.hidden = false; report('paused', 'Tap to start playback on this device.');
      } else fail('This browser could not play the media: ' + err.message);
    });
  }
  function unload() {
    generation++; loadedUrl = ''; video.pause();
    if (hls) { hls.destroy(); hls = null; }
    video.removeAttribute('src'); video.load(); tap.hidden = true;
  }
  function begin(payload) {
    if (loadedUrl === payload.url) { resume(); return; }
    unload(); loadedUrl = payload.url;
    var token = generation;
    title.textContent = payload.title || 'Video'; stopButton.hidden = false;
    report('buffering');
    function ready() {
      if (token !== generation) return;
      if (payload.startPositionSec) video.currentTime = payload.startPositionSec;
      resume();
    }
    video.onloadedmetadata = ready;
    if (/\.m3u8(?:[?#]|$)/i.test(payload.url) && !video.canPlayType('application/vnd.apple.mpegurl')) {
      if (typeof Hls === 'undefined' || !Hls.isSupported()) { fail('HLS playback is unavailable in this browser.'); return; }
      hls = new Hls(); hls.loadSource(payload.url); hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, function (_, data) { if (data.fatal && token === generation) fail('HLS playback failed: ' + data.details); });
    } else video.src = payload.url;
  }
  function play(payload) { playback.start(payload, begin, unload); }
  function stop() { playback.stop(); unload(); stopButton.hidden = true; report('stopped'); }
  function command(msg) {
    var p = msg.payload || {};
    try {
      if (msg.action === 'play') play(p);
      else if (msg.action === 'stop') stop();
      else if (msg.action === 'pause') video.pause();
      else if (msg.action === 'resume' && loadedUrl) resume();
      else if (msg.action === 'seek' && loadedUrl) {
        var target = typeof p.deltaSec === 'number' ? video.currentTime + p.deltaSec : p.positionSec;
        if (Number.isFinite(target)) video.currentTime = Math.max(0, Math.min(target, Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.1) : target));
      }
    } catch (err) { fail(err.message); }
  }
  function connect() {
    clearTimeout(retry);
    if (!enabled || socket && socket.readyState < 2) return;
    status.textContent = 'Connecting to relay…';
    try { socket = new WebSocket(APP_CONFIG.RELAY_URL); }
    catch (err) { status.textContent = 'Could not connect to relay: ' + err.message; retry = setTimeout(connect, 2000); return; }
    socket.onopen = function () {
      status.textContent = 'Registering receiver…';
      activeName = document.getElementById('receiver-name').value.trim() || 'Browser receiver';
      socket.send(JSON.stringify({ type: 'register', role: 'receiver', name: activeName, receiverId: receiverId }));
    };
    socket.onmessage = function (event) {
      var msg; try { msg = JSON.parse(event.data); } catch (_) { return; }
      if (msg.type === 'registered') {
        connectedName.textContent = 'This device: ' + activeName;
        connectedName.hidden = false;
        report(state, 'Connected as ' + activeName + '. Ready to receive video.');
        if (channel && !announced) {
          channel.postMessage({ type: 'select-receiver', targetId: msg.targetId });
          announced = true;
        }
      }
      else if (msg.type === 'command') command(msg);
      else if (msg.type === 'error') status.textContent = msg.message;
    };
    socket.onclose = function () {
      playback.stop(); // A disconnected session cannot automatically launch another episode.
      if (enabled) {
        connectedName.hidden = true;
        status.textContent = 'Relay disconnected. Reconnecting…';
        retry = setTimeout(connect, 2000);
      }
    };
  }
  document.getElementById('receiver-join').addEventListener('submit', function (event) {
    event.preventDefault(); enabled = true;
    try { sessionStorage.setItem('tvc.receiverName', document.getElementById('receiver-name').value.trim()); } catch (_) {}
    if (socket && socket.readyState === WebSocket.OPEN && activeName !== document.getElementById('receiver-name').value.trim()) socket.close();
    else connect();
  });
  tap.addEventListener('click', resume);
  stopButton.addEventListener('click', stop);
  video.addEventListener('playing', function () { if (loadedUrl) report('playing'); });
  video.addEventListener('pause', function () { if (loadedUrl && !video.ended) { playback.flush(); report('paused'); } });
  video.addEventListener('waiting', function () { if (loadedUrl) report('buffering'); });
  video.addEventListener('timeupdate', function () { if (loadedUrl) { playback.time(video.currentTime, Number.isFinite(video.duration) ? video.duration : 0); report(state); } });
  video.addEventListener('seeked', function () { if (loadedUrl) report(video.paused ? 'paused' : 'playing'); });
  video.addEventListener('ended', function () {
    if (!loadedUrl) return;
    loadedUrl = ''; report('ended'); playback.completed(play);
  });
  video.addEventListener('error', function () { if (loadedUrl) fail('Unsupported media or an unreachable media server.'); });
  window.addEventListener('pagehide', function () { enabled = false; playback.stop(); if (socket) socket.close(); });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') connect(); });
})();
