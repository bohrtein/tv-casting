'use strict';
(function () {
  function $(id) { return document.getElementById(id); }
  var video = $('receiver-video');
  var status = $('receiver-status');
  var title = $('receiver-title');
  var tap = $('receiver-play');
  var unmuteButton = $('receiver-unmute');
  var airplayButton = $('receiver-airplay');
  var remoteButton = $('receiver-remote');
  var fullscreenButton = $('receiver-fullscreen');
  var toggle = $('receiver-enabled');
  var nameInput = $('receiver-name');
  var renameButton = $('receiver-rename');
  var screen = document.querySelector('.rc-screen');
  var idle = $('receiver-idle'), idleText = $('receiver-idle-text');
  var chip = $('receiver-chip'), chipLabel = $('receiver-chip-label');
  var socket, hls, loadedUrl = '', generation = 0, enabled = false, retry, activeName = '', announced = false;
  var receiverId, channel, targetId = '', wireless = false;
  var LOCAL_TAB = 'tvc-receiver'; // window name the companion opens this page under

  // The id is per tab (sessionStorage) so two receiver tabs are two
  // targets; the name is per browser so it survives closing the tab.
  function storage(kind, key, value) {
    try {
      var s = window[kind];
      if (value === undefined) return s.getItem(key);
      if (value === null) s.removeItem(key); else s.setItem(key, value);
    } catch (_) {}
    return null;
  }
  receiverId = storage('sessionStorage', 'tvc.receiverId');
  if (!receiverId) {
    if (window.crypto && typeof crypto.randomUUID === 'function') {
      receiverId = crypto.randomUUID();
    } else {
      // Plain HTTP/LAN pages may not expose crypto.randomUUID().
      receiverId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0;
        var v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
    }
    storage('sessionStorage', 'tvc.receiverId', receiverId);
  }
  var savedName = storage('localStorage', 'tvc.receiverName') || storage('sessionStorage', 'tvc.receiverName');
  if (savedName) nameInput.value = savedName;
  if (typeof BroadcastChannel !== 'undefined') channel = new BroadcastChannel('tvc.receiver');

  var state = 'idle';
  var playback = createPlaybackHistory({
    onWaiting: function () { report('buffering', 'Looking up the next episode…'); },
    onIdle: function () { report('stopped'); showIdle(); },
    onError: fail
  });

  function currentName() { return nameInput.value.trim() || 'Browser receiver'; }

  function setChip(chipState, label) {
    chip.setAttribute('data-mx-state', chipState);
    chipLabel.textContent = label;
  }

  function renderIdle() {
    screen.setAttribute('data-on', String(enabled && !!targetId));
    if (!enabled) idleText.innerHTML = 'Turn the receiver on, then pick it under <strong>Play on</strong> in the companion.';
    else if (!targetId) idleText.textContent = 'Connecting…';
    else idleText.textContent = 'Ready as “' + activeName + '”. Choose it under Play on in the companion to play here.';
  }

  function showIdle() {
    idle.hidden = !!loadedUrl;
    fullscreenButton.hidden = !loadedUrl;
    unmuteButton.hidden = !loadedUrl || !video.muted;
    if (!loadedUrl) title.textContent = '';
    renderIdle();
  }

  function report(nextState, message, error) {
    state = nextState;
    var text = message || describe(state);
    if (wireless && (state === 'playing' || state === 'paused')) text += ' · on AirPlay';
    status.textContent = text;
    var msg = {
      type: 'status', state: state, title: title.textContent,
      positionSec: Number.isFinite(video.currentTime) ? video.currentTime : 0,
      durationSec: Number.isFinite(video.duration) ? video.duration : 0,
      error: error ? { code: 'BROWSER_PLAYBACK_FAILED', message: error } : undefined
    };
    controls.render(msg);
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
  }
  function describe(s) {
    return { idle: 'Waiting for something to play.', buffering: 'Loading…', playing: 'Playing.',
      paused: 'Paused.', stopped: 'Stopped.', ended: 'Finished.' }[s] || s;
  }
  function fail(message) {
    playback.stop();
    report('error', message, message);
  }

  // Browsers only autoplay with sound after the user touched this page.
  // A video sent from the companion usually arrives without that, so
  // fall back to muted autoplay and offer an unmute button.
  function resume() {
    var token = generation;
    video.play().then(function () { if (token === generation) tap.hidden = true; }).catch(function (err) {
      if (token !== generation) return;
      if (err.name !== 'NotAllowedError') { fail('This browser could not play the media: ' + err.message); return; }
      if (video.muted) { tap.hidden = false; report('paused', 'Tap to start playback on this device.'); return; }
      video.muted = true;
      video.play().then(function () {
        if (token !== generation) return;
        tap.hidden = true; unmuteButton.hidden = false;
      }).catch(function () {
        if (token !== generation) return;
        video.muted = false; tap.hidden = false; report('paused', 'Tap to start playback on this device.');
      });
    });
  }
  // AirPlay to a TV outside the home: the public link while AirPlay is on
  // (away-links.js). Guests' keys open only the video they're playing.
  var away = createAwayLinks({
    video: video, resolverUrl: APP_CONFIG.RESOLVER_URL, perVideo: !!APP_CONFIG.GUEST,
    loadedUrl: function () { return loadedUrl; }, usable: function () { return !hls; },
    resume: function () { resume(); }, generation: function () { return generation; }
  });

  function unload() {
    generation++; loadedUrl = ''; video.pause();
    if (hls) { hls.destroy(); hls = null; }
    video.removeAttribute('src'); video.load(); tap.hidden = true;
    showIdle();
  }
  function begin(payload) {
    if (loadedUrl === payload.url) { resume(); return; }
    unload(); loadedUrl = payload.url;
    var token = generation;
    title.textContent = payload.title || 'Video';
    showIdle();
    report('buffering');
    video.onloadedmetadata = function () {
      if (token !== generation) return;
      if (payload.startPositionSec) video.currentTime = payload.startPositionSec;
      resume();
    };
    if (/\.m3u8(?:[?#]|$)/i.test(payload.url) && !video.canPlayType('application/vnd.apple.mpegurl')) {
      if (typeof Hls === 'undefined' || !Hls.isSupported()) { fail('HLS playback is unavailable in this browser.'); return; }
      hls = new Hls(); hls.loadSource(payload.url); hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, function (_, data) { if (data.fatal && token === generation) fail('HLS playback failed: ' + data.details); });
    } else {
      video.src = payload.url;
      away.loaded();
    }
  }
  function play(payload) { playback.start(payload, begin, unload); }
  function stop() { playback.stop(); unload(); report('stopped'); }
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

  // The companion remote's controls, pointed at this page's video: the same
  // commands the relay would deliver go straight to command().
  var controls = createRemoteControls(
    { sendCommand: function (action, payload) { command({ action: action, payload: payload }); } },
    { clear: function () {} }
  );

  function announce() {
    if (channel && targetId) channel.postMessage({ type: 'select-receiver', targetId: targetId, name: activeName, local: window.name === LOCAL_TAB });
  }

  function connect() {
    clearTimeout(retry);
    if (!enabled || socket && socket.readyState < 2) return;
    setChip('busy', 'connecting'); status.textContent = 'Connecting to the relay…';
    try { socket = new (APP_CONFIG.RELAY_SOCKET || WebSocket)(APP_CONFIG.RELAY_URL); }
    catch (err) { status.textContent = 'Could not connect to the relay: ' + err.message; retry = setTimeout(connect, 2000); return; }
    var own = socket;
    socket.onopen = function () {
      status.textContent = 'Registering…';
      activeName = currentName();
      var registration = {
        type: 'register', role: 'receiver', name: activeName,
        resolverUrl: APP_CONFIG.RESOLVER_URL,
        stremioUrl: APP_CONFIG.STREMIO_SERVER_URL
      };
      if (receiverId) registration.receiverId = receiverId;
      own.send(JSON.stringify(registration));
    };
    socket.onmessage = function (event) {
      var msg; try { msg = JSON.parse(event.data); } catch (_) { return; }
      if (msg.type === 'registered') {
        targetId = msg.targetId;
        setChip('ok', 'on');
        renderIdle(); renderRename();
        report(state, loadedUrl ? undefined : 'On as ' + activeName + '. Ready to receive video.');
        // Hand this receiver to a companion open in this browser -- once
        // per enable, so a later reconnect doesn't steal its selection.
        if (!announced) { announce(); announced = true; }
      }
      else if (msg.type === 'command') command(msg);
      else if (msg.type === 'error') status.textContent = msg.message;
    };
    socket.onclose = function () {
      if (own !== socket) return;
      targetId = '';
      playback.stop(); // A disconnected session cannot automatically launch another episode.
      if (enabled) {
        setChip('busy', 'reconnecting');
        status.textContent = 'Relay disconnected. Reconnecting…';
        retry = setTimeout(connect, 2000);
      } else setChip('err', 'off');
      renderIdle();
    };
  }

  function setEnabled(on) {
    enabled = on;
    toggle.checked = on;
    $('receiver-enabled-label').textContent = on ? 'on' : 'off';
    storage('sessionStorage', 'tvc.receiverEnabled', on ? '1' : null);
    if (on) {
      announced = false;
      connect();
    } else {
      clearTimeout(retry);
      if (loadedUrl) stop();
      targetId = '';
      if (socket) socket.close(1000, 'Receiver turned off');
      setChip('err', 'off');
      status.textContent = 'Receiver is off. The companion won\'t list it until you turn it back on.';
    }
    renderIdle(); renderRename();
  }

  function renderRename() {
    var name = currentName();
    renameButton.disabled = !nameInput.value.trim() || name === (enabled && targetId ? activeName : storage('localStorage', 'tvc.receiverName') || 'Browser receiver');
  }

  toggle.addEventListener('change', function () { setEnabled(toggle.checked); });
  nameInput.addEventListener('input', renderRename);
  $('receiver-name-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var name = currentName();
    storage('localStorage', 'tvc.receiverName', name);
    // Re-register under the new name; the relay keeps the same target id.
    if (enabled && socket && socket.readyState === WebSocket.OPEN && activeName !== name) {
      status.textContent = 'Renaming…';
      socket.close(1000, 'Renaming');
      connect();
    } else if (!enabled) status.textContent = 'Saved. Turn the receiver on to use “' + name + '”.';
    renderRename();
  });

  tap.addEventListener('click', resume);
  unmuteButton.addEventListener('click', function () { video.muted = false; unmuteButton.hidden = true; });
  video.addEventListener('volumechange', function () { if (!video.muted) unmuteButton.hidden = true; });

  // Keep the browser's normal video UI visible. AirPlay remains available
  // through Safari's native controls as well as the separate AirPlay button.
  var hasWebKitAirPlay = !!(window.WebKitPlaybackTargetAvailabilityEvent && video.webkitShowPlaybackTargetPicker);
  video.controls = true;

  fullscreenButton.addEventListener('click', function () {
    if (video.requestFullscreen) video.requestFullscreen().catch(function () {});
    else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
  });

  // AirPlay (Safari) and the Remote Playback API (Chrome, for Cast devices).
  if (window.WebKitPlaybackTargetAvailabilityEvent && video.webkitShowPlaybackTargetPicker) {
    $('receiver-airplay-note').textContent = 'Play something here, then press AirPlay under the video to send it to an Apple TV or AirPlay speaker. The companion keeps controlling it.';
    video.addEventListener('webkitplaybacktargetavailabilitychanged', function (event) {
      airplayButton.hidden = event.availability !== 'available';
    });
    video.addEventListener('webkitcurrentplaybacktargetiswirelesschanged', function () {
      wireless = !!video.webkitCurrentPlaybackTargetIsWireless;
      airplayButton.textContent = wireless ? 'AirPlay · on' : 'AirPlay';
      away.setWireless(wireless);
      if (loadedUrl) report(state);
    });
    airplayButton.addEventListener('click', function () { video.webkitShowPlaybackTargetPicker(); });
  } else if (video.remote && video.remote.watchAvailability) {
    video.remote.watchAvailability(function (available) { remoteButton.hidden = !available; }).catch(function () {});
    remoteButton.addEventListener('click', function () {
      video.remote.prompt().catch(function (err) {
        if (err.name !== 'NotAllowedError' && err.name !== 'AbortError') status.textContent = 'Could not send to that device: ' + err.message;
      });
    });
  }

  video.addEventListener('playing', function () { if (loadedUrl) report('playing'); });
  video.addEventListener('pause', function () { if (loadedUrl && !video.ended) { playback.flush(); report('paused'); } });
  video.addEventListener('waiting', function () { if (loadedUrl) report('buffering'); });
  video.addEventListener('timeupdate', function () { if (loadedUrl) { playback.time(video.currentTime, Number.isFinite(video.duration) ? video.duration : 0); report(state); } });
  video.addEventListener('seeked', function () { if (loadedUrl) report(video.paused ? 'paused' : 'playing'); });
  video.addEventListener('ended', function () {
    if (!loadedUrl) return;
    loadedUrl = ''; report('ended'); showIdle(); playback.completed(play);
  });
  video.addEventListener('error', function () { if (loadedUrl) fail('Unsupported media or an unreachable media server.'); });

  if (channel) channel.onmessage = function (event) {
    // "Play on this device" in the companion asks which receiver this tab is.
    if (!event.data || event.data.type !== 'find-receiver' || window.name !== LOCAL_TAB) return;
    if (!enabled) setEnabled(true); // announces once it registers
    else if (targetId) announce();
  };

  window.addEventListener('pagehide', function () { enabled = false; playback.stop(); if (socket) socket.close(); });
  window.addEventListener('pageshow', function (event) {
    if (event.persisted && storage('sessionStorage', 'tvc.receiverEnabled') === '1') setEnabled(true);
  });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') connect(); });

  // ?auto=1 (from "play on this device") or a reload of an enabled tab
  // turns the receiver straight on.
  var params = new URLSearchParams(location.search);
  var auto = params.get('auto') === '1';
  if (auto) history.replaceState(null, '', location.pathname);
  showIdle();
  report('idle', 'Receiver is off.');
  setEnabled(auto || storage('sessionStorage', 'tvc.receiverEnabled') === '1');
})();
