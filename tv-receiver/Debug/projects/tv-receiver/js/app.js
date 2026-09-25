'use strict';

(function () {
  var log = createLogger('app');

  var elements = {
    idleScreen: document.getElementById('idle-screen'),
    playerScreen: document.getElementById('player-screen'),
    connectionNote: document.getElementById('connection-note'),
    nowPlayingTitle: document.getElementById('now-playing-title'),
    nowPlayingState: document.getElementById('now-playing-state'),
    controls: document.getElementById('player-controls'),
    playPause: document.getElementById('play-pause'),
    rewind: document.getElementById('rewind'),
    forward: document.getElementById('forward'),
    errorBanner: document.getElementById('error-banner')
  };

  var currentTitle = '';
  var currentPlaybackState = 'idle';
  var errorBannerTimer = null;
  var controlsTimer = null;
  var CONTROLS_TIMEOUT_MS = 4000;
  var SEEK_STEP_SEC = 10; // matches companion's own <<10s/10s>> buttons

  var relay = createRelayClient(APP_CONFIG, {
    onRegistered: onRegistered,
    onCommand: onCommand,
    onRelayError: onRelayError,
    onDisconnected: onDisconnected,
    onReconnecting: onReconnecting
  });

  var player = createPlayer({
    onStateChange: onPlaybackStateChange,
    onPlayTime: onPlayTime,
    onError: onPlaybackError
  });

  function showIdleScreen() {
    log.info('screen -> idle');
    currentPlaybackState = 'idle';
    hideControls();
    elements.playerScreen.classList.add('hidden');
    elements.idleScreen.classList.remove('hidden');
  }

  function showPlayerScreen() {
    log.info('screen -> player');
    elements.idleScreen.classList.add('hidden');
    elements.playerScreen.classList.remove('hidden');
    showControls();
  }

  function hideControls() {
    clearTimeout(controlsTimer);
    elements.controls.classList.add('hidden');
  }

  function showControls() {
    if (elements.playerScreen.classList.contains('hidden')) return;
    elements.controls.classList.remove('hidden');
    clearTimeout(controlsTimer);
    controlsTimer = setTimeout(hideControls, CONTROLS_TIMEOUT_MS);
  }

  function canControlPlayback() {
    return currentPlaybackState === 'playing' || currentPlaybackState === 'paused';
  }

  function updateControls() {
    elements.playPause.textContent = currentPlaybackState === 'paused' ? 'Play' : 'Pause';
    elements.playPause.disabled = !canControlPlayback();
    elements.rewind.disabled = !canControlPlayback();
    elements.forward.disabled = !canControlPlayback();
  }

  function skipBy(seconds) {
    showControls();
    if (canControlPlayback()) player.seekBy(seconds);
  }

  function onRegistered() {
    log.info('registered with relay as tv');
    elements.connectionNote.textContent = 'Waiting for a companion…';
  }

  function onDisconnected() {
    elements.connectionNote.textContent = 'Reconnecting to relay…';
  }

  function onReconnecting() {
    elements.connectionNote.textContent = 'Reconnecting to relay…';
  }

  function onRelayError(msg) {
    // Malformed/unexpected messages from the relay aren't user-facing --
    // the relay only ever sends us commands we asked to receive.
    log.error('relay error', msg.code, msg.message);
  }

  function onCommand(msg) {
    log.info('command: ' + msg.action, msg.payload || '');
    switch (msg.action) {
      case 'play':
        currentTitle = (msg.payload && msg.payload.title) || '';
        elements.nowPlayingTitle.textContent = currentTitle;
        currentPlaybackState = 'buffering';
        elements.nowPlayingState.textContent = 'Loading';
        updateControls();
        showPlayerScreen();
        player.play(msg.payload.url, msg.payload.startPositionSec || 0);
        break;
      case 'pause':
        player.pause();
        break;
      case 'stop':
        player.stop();
        relay.sendStatus({ state: 'stopped' });
        showIdleScreen();
        break;
      case 'seek':
        player.seek(msg.payload.positionSec);
        break;
      default:
        log.warn('unknown command action', msg.action);
        break;
    }
  }

  function onPlaybackStateChange(state) {
    log.info('playback state: ' + currentPlaybackState + ' -> ' + state);
    currentPlaybackState = state;
    elements.nowPlayingState.textContent = state;
    updateControls();
    if (state === 'paused') showControls();
    var durationSec = player.getDurationSec();
    var status = { state: state, title: currentTitle };
    if (durationSec > 0) status.durationSec = durationSec;
    relay.sendStatus(status);
    if (state === 'stopped') {
      showIdleScreen();
    }
  }

  function onPlayTime(positionSec) {
    var status = { state: currentPlaybackState, title: currentTitle, positionSec: positionSec };
    var durationSec = player.getDurationSec();
    if (durationSec > 0) status.durationSec = durationSec;
    relay.sendStatus(status);
  }

  function onPlaybackError(error) {
    log.error('playback error ' + error.code + ': ' + error.message);
    relay.sendStatus({ state: 'error', error: error });
    elements.errorBanner.textContent = error.message;
    elements.errorBanner.classList.remove('hidden');
    clearTimeout(errorBannerTimer);
    errorBannerTimer = setTimeout(function () {
      elements.errorBanner.classList.add('hidden');
    }, 5000);
    showIdleScreen();
  }

  // Standard Tizen TV input device key names/codes for the remote's own
  // media buttons -- separate from and in addition to the companion's
  // on-screen transport controls, for whoever's holding the remote
  // instead of a phone.
  var KEYCODE_RETURN = 10009;
  var KEYCODE_MEDIA_PLAY_PAUSE = 10252;
  var KEYCODE_MEDIA_PLAY = 415;
  var KEYCODE_MEDIA_PAUSE = 19;
  var KEYCODE_MEDIA_STOP = 413;
  var KEYCODE_MEDIA_REWIND = 412;
  var KEYCODE_MEDIA_FAST_FORWARD = 417;

  function togglePlayPause() {
    if (!canControlPlayback()) return;
    if (currentPlaybackState === 'playing') {
      player.pause();
    } else {
      player.resume();
    }
  }

  function registerHardwareKeys() {
    // Samsung TVs route the remote's buttons through here; without an
    // explicit handler, unregistered keys either no-op or fall through
    // to inconsistent platform defaults depending on the TV model.
    if (typeof tizen === 'undefined' || !tizen.tvinputdevice) {
      log.warn('tizen.tvinputdevice unavailable -- remote media keys not registered');
    }
    var keys = [
      'Return',
      'MediaPlayPause',
      'MediaPlay',
      'MediaPause',
      'MediaStop',
      'MediaRewind',
      'MediaFastForward'
    ];
    keys.forEach(function (key) {
      if (typeof tizen === 'undefined' || !tizen.tvinputdevice) return;
      try {
        tizen.tvinputdevice.registerKey(key);
        log.info('registered key ' + key);
      } catch (e) {
        // Not every key is supported on every TV model/emulator version
        // -- skip it rather than failing registration for the rest.
        log.warn('could not register key ' + key, e);
      }
    });
    document.addEventListener('keydown', function (e) {
      log.info('keydown keyCode=' + e.keyCode + ' key=' + e.key);
      if (e.keyCode === KEYCODE_RETURN) {
        e.preventDefault();
        if (!elements.controls.classList.contains('hidden')) {
          hideControls();
        } else if (typeof tizen !== 'undefined' && tizen.application) {
          tizen.application.getCurrentApplication().exit();
        }
        return;
      }
      if (elements.playerScreen.classList.contains('hidden')) return;
      switch (e.keyCode) {
        case 40: // Down dismisses the overlay without changing playback.
          e.preventDefault();
          hideControls();
          break;
        case 13: // OK / Enter is delivered without Tizen key registration.
          e.preventDefault();
          if (e.repeat) return;
          if (!elements.controls.classList.contains('hidden')) togglePlayPause();
          showControls();
          break;
        case KEYCODE_MEDIA_PLAY_PAUSE:
          e.preventDefault();
          if (e.repeat) return;
          togglePlayPause();
          showControls();
          break;
        case KEYCODE_MEDIA_PLAY:
          e.preventDefault();
          if (canControlPlayback()) player.resume();
          showControls();
          break;
        case KEYCODE_MEDIA_PAUSE:
          e.preventDefault();
          if (canControlPlayback()) player.pause();
          showControls();
          break;
        case KEYCODE_MEDIA_STOP:
          e.preventDefault();
          player.stop();
          relay.sendStatus({ state: 'stopped' });
          showIdleScreen();
          break;
        case KEYCODE_MEDIA_REWIND:
        case 37:
          e.preventDefault();
          skipBy(-SEEK_STEP_SEC);
          break;
        case KEYCODE_MEDIA_FAST_FORWARD:
        case 39:
          e.preventDefault();
          skipBy(SEEK_STEP_SEC);
          break;
        default:
          break;
      }
    });
  }

  log.info('starting, relay=' + APP_CONFIG.RELAY_URL + ' ua=' + navigator.userAgent);
  elements.playPause.addEventListener('click', function () {
    togglePlayPause();
    showControls();
  });
  elements.rewind.addEventListener('click', function () { skipBy(-SEEK_STEP_SEC); });
  elements.forward.addEventListener('click', function () { skipBy(SEEK_STEP_SEC); });
  registerHardwareKeys();
  showIdleScreen();
  relay.connect();
})();
