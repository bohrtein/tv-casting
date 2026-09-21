'use strict';

(function () {
  var elements = {
    idleScreen: document.getElementById('idle-screen'),
    playerScreen: document.getElementById('player-screen'),
    connectionNote: document.getElementById('connection-note'),
    nowPlayingTitle: document.getElementById('now-playing-title'),
    nowPlayingState: document.getElementById('now-playing-state'),
    errorBanner: document.getElementById('error-banner')
  };

  var currentTitle = '';
  var currentPlaybackState = 'idle';
  var errorBannerTimer = null;
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

  var idleBgVideo = document.getElementById('idle-bg-video');
  var idleBgDebug = document.getElementById('idle-bg-debug');

  // No devtools/console reachable on a production TV -- this is the only
  // feedback channel available for debugging idle-bg-video failures, so
  // surface everything we can get our hands on directly on screen.
  var MEDIA_ERROR_NAMES = {
    1: 'MEDIA_ERR_ABORTED',
    2: 'MEDIA_ERR_NETWORK',
    3: 'MEDIA_ERR_DECODE',
    4: 'MEDIA_ERR_SRC_NOT_SUPPORTED'
  };

  function describeVideoError() {
    if (!idleBgVideo) return 'idle-bg-video: element missing';
    var err = idleBgVideo.error;
    var bits = [
      'networkState=' + idleBgVideo.networkState,
      'readyState=' + idleBgVideo.readyState
    ];
    if (err) bits.unshift('error=' + (MEDIA_ERROR_NAMES[err.code] || err.code));
    return 'idle-bg-video: ' + bits.join(' ');
  }

  if (idleBgVideo && idleBgDebug) {
    idleBgVideo.addEventListener('error', function () {
      idleBgDebug.textContent = describeVideoError();
    });
    idleBgVideo.addEventListener('stalled', function () {
      idleBgDebug.textContent = describeVideoError();
    });
    // canplay means the browser is confident it can decode this file --
    // clear any earlier error text once/if that actually happens.
    idleBgVideo.addEventListener('canplay', function () {
      idleBgDebug.textContent = '';
    });
  }

  function showIdleScreen() {
    elements.playerScreen.classList.add('hidden');
    elements.idleScreen.classList.remove('hidden');
    // Resumes decoding the idle background; harmless if it's already
    // playing (autoplay) or if the element isn't there in some
    // stripped-down test harness. play() returns a Promise on modern
    // engines but not on older WebKit builds -- guard the .catch().
    if (idleBgVideo) {
      var playResult = idleBgVideo.play();
      if (playResult && playResult.catch) {
        playResult.catch(function (err) {
          if (idleBgDebug) idleBgDebug.textContent = describeVideoError() + ' play() rejected: ' + err;
        });
      }
    }
  }

  function showPlayerScreen() {
    elements.idleScreen.classList.add('hidden');
    elements.playerScreen.classList.remove('hidden');
    // No reason to keep decoding the idle background while a real
    // stream is playing.
    if (idleBgVideo) idleBgVideo.pause();
  }

  function onRegistered() {
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
    if (typeof console !== 'undefined') {
      console.log('relay error', msg.code, msg.message);
    }
  }

  function onCommand(msg) {
    switch (msg.action) {
      case 'play':
        currentTitle = (msg.payload && msg.payload.title) || '';
        elements.nowPlayingTitle.textContent = currentTitle;
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
        break;
    }
  }

  function onPlaybackStateChange(state) {
    currentPlaybackState = state;
    elements.nowPlayingState.textContent = state;
    var durationSec = player.getDurationSec();
    var status = { state: state, title: currentTitle };
    if (durationSec > 0) status.durationSec = durationSec;
    relay.sendStatus(status);
    if (state === 'stopped') {
      showIdleScreen();
    }
  }

  function onPlayTime(positionSec) {
    var status = { state: 'playing', title: currentTitle, positionSec: positionSec };
    var durationSec = player.getDurationSec();
    if (durationSec > 0) status.durationSec = durationSec;
    relay.sendStatus(status);
  }

  function onPlaybackError(error) {
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
    if (currentPlaybackState === 'playing' || currentPlaybackState === 'buffering') {
      player.pause();
    } else {
      player.resume();
    }
  }

  function registerHardwareKeys() {
    // Samsung TVs route the remote's buttons through here; without an
    // explicit handler, unregistered keys either no-op or fall through
    // to inconsistent platform defaults depending on the TV model.
    if (typeof tizen === 'undefined' || !tizen.tvinputdevice) return;
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
      try {
        tizen.tvinputdevice.registerKey(key);
      } catch (e) {
        // Not every key is supported on every TV model/emulator version
        // -- skip it rather than failing registration for the rest.
      }
    });
    document.addEventListener('keydown', function (e) {
      switch (e.keyCode) {
        case KEYCODE_RETURN:
          tizen.application.getCurrentApplication().exit();
          break;
        case KEYCODE_MEDIA_PLAY_PAUSE:
          togglePlayPause();
          break;
        case KEYCODE_MEDIA_PLAY:
          player.resume();
          break;
        case KEYCODE_MEDIA_PAUSE:
          player.pause();
          break;
        case KEYCODE_MEDIA_STOP:
          player.stop();
          relay.sendStatus({ state: 'stopped' });
          showIdleScreen();
          break;
        case KEYCODE_MEDIA_REWIND:
          player.seekBy(-SEEK_STEP_SEC);
          break;
        case KEYCODE_MEDIA_FAST_FORWARD:
          player.seekBy(SEEK_STEP_SEC);
          break;
        default:
          break;
      }
    });
  }

  registerHardwareKeys();
  showIdleScreen();
  relay.connect();

  // No 'error' event necessarily means nothing went wrong -- an engine
  // that just silently no-ops the <video> tag entirely wouldn't fire one
  // either. Report actual state a few seconds in regardless, so a
  // "nothing happened at all" failure is visible too, not just explicit
  // decode/network errors.
  if (idleBgVideo && idleBgDebug) {
    setTimeout(function () {
      if (idleBgVideo.readyState < 2 || idleBgVideo.paused) {
        idleBgDebug.textContent = describeVideoError() + ' paused=' + idleBgVideo.paused;
      }
    }, 4000);
  }
})();
