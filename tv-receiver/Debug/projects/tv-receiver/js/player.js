'use strict';

// Thin wrapper around Samsung's webapis.avplay (loaded via the
// $WEBAPIS/webapis/webapis.js bridge in index.html — only resolves on a
// real Tizen TV or the Tizen Studio TV emulator, not a desktop browser).
function createPlayer(handlers) {
  var currentUrl = null;

  function isAvailable() {
    return typeof webapis !== 'undefined' && !!webapis.avplay;
  }

  function attachListeners() {
    webapis.avplay.setListener({
      onbufferingstart: function () {
        handlers.onStateChange('buffering');
      },
      onbufferingprogress: function () {},
      onbufferingcomplete: function () {
        handlers.onStateChange('playing');
      },
      onstreamcompleted: function () {
        stop();
        handlers.onStateChange('stopped');
      },
      oncurrentplaytime: function (currentTime) {
        handlers.onPlayTime(Math.floor(currentTime / 1000));
      },
      onerror: function (eventType) {
        handlers.onError({ code: 'PLAYBACK_FAILED', message: String(eventType) });
      },
      onevent: function () {},
      ondrmevent: function () {}
    });
  }

  function openAndPlay(url, startPositionSec) {
    currentUrl = url;
    webapis.avplay.open(url);
    attachListeners();
    webapis.avplay.setDisplayRect(0, 0, 1920, 1080);
    webapis.avplay.prepareAsync(
      function () {
        if (startPositionSec) {
          webapis.avplay.seekTo(startPositionSec * 1000);
        }
        webapis.avplay.play();
        handlers.onStateChange('playing');
      },
      function (err) {
        currentUrl = null;
        handlers.onError({ code: 'PREPARE_FAILED', message: String(err) });
      }
    );
  }

  function play(url, startPositionSec) {
    if (!isAvailable()) {
      handlers.onError({ code: 'AVPLAY_UNAVAILABLE', message: 'webapis.avplay is not available on this device.' });
      return;
    }
    // The protocol has no separate "resume" action (see PROTOCOL.md) --
    // a companion resuming from pause just resends "play" with the same
    // url. Reopening/re-preparing that stream from scratch would lose
    // position and add latency, so treat "same url, already loaded" as
    // resume instead of a fresh open.
    if (currentUrl === url) {
      webapis.avplay.play();
      handlers.onStateChange('playing');
      return;
    }
    stop();
    openAndPlay(url, startPositionSec);
  }

  function pause() {
    if (!isAvailable() || !currentUrl) return;
    webapis.avplay.pause();
    handlers.onStateChange('paused');
  }

  // Local un-pause, distinct from play(url, ...): the TV remote's own
  // Play button has no url to hand us, it just means "un-pause whatever
  // is already loaded" -- unlike a companion's resume, which resends
  // "play" with the url because it has no other way to identify the
  // stream (see the comment on play() above).
  function resume() {
    if (!isAvailable() || !currentUrl) return;
    webapis.avplay.play();
    handlers.onStateChange('playing');
  }

  function seek(positionSec) {
    if (!isAvailable() || !currentUrl) return;
    webapis.avplay.seekTo(positionSec * 1000);
  }

  // Rewind/fast-forward from the TV remote's own media keys, relative to
  // wherever playback actually is right now (getCurrentTime is a plain
  // synchronous AVPlay getter, no need to track position ourselves).
  function seekBy(deltaSec) {
    if (!isAvailable() || !currentUrl) return;
    var current = webapis.avplay.getCurrentTime();
    webapis.avplay.seekTo(Math.max(0, current + deltaSec * 1000));
  }

  function stop() {
    if (!isAvailable() || !currentUrl) return;
    try {
      webapis.avplay.stop();
      webapis.avplay.close();
    } catch (e) {
      // Already stopped/closed -- nothing to clean up.
    }
    currentUrl = null;
  }

  return {
    play: play,
    pause: pause,
    resume: resume,
    seek: seek,
    seekBy: seekBy,
    stop: stop
  };
}
