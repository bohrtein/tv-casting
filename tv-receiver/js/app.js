'use strict';

(function () {
  var elements = {
    idleScreen: document.getElementById('idle-screen'),
    playerScreen: document.getElementById('player-screen'),
    qrHolder: document.getElementById('qr-holder'),
    roomCode: document.getElementById('room-code'),
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

  function renderQr(code) {
    var url = APP_CONFIG.COMPANION_BASE_URL + '?code=' + encodeURIComponent(code);
    var qr = qrcode(0, 'M'); // typeNumber 0 = auto-pick the smallest size that fits
    qr.addData(url);
    qr.make();
    elements.qrHolder.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2 });
  }

  function showIdleScreen() {
    elements.playerScreen.classList.add('hidden');
    elements.idleScreen.classList.remove('hidden');
  }

  function showPlayerScreen() {
    elements.idleScreen.classList.add('hidden');
    elements.playerScreen.classList.remove('hidden');
  }

  function onRegistered(code) {
    elements.roomCode.textContent = code;
    elements.connectionNote.textContent = '';
    renderQr(code);
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
})();
