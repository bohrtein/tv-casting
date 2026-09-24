'use strict';

// Thin wrapper around Samsung's webapis.avplay (loaded via the
// $WEBAPIS/webapis/webapis.js bridge in index.html — only resolves on a
// real Tizen TV or the Tizen Studio TV emulator, not a desktop browser).
// Requires the tv.avplay privilege in config.xml -- without it, webapis.js
// still loads but webapis.avplay is undefined.
function createPlayer(handlers) {
  var currentUrl = null;
  var log = createLogger('player');
  var lastLoggedPlayTimeSec = -1;

  function isAvailable() {
    return typeof webapis !== 'undefined' && !!webapis.avplay;
  }

  // Tizen WebAPIException stringifies to just its name ("UnknownError"),
  // which hides the message that actually says what went wrong -- spell
  // out name, message and numeric code instead.
  function describeError(err) {
    if (!err || typeof err !== 'object') return String(err);
    var text = err.name || 'Error';
    if (err.message) text += ': ' + err.message;
    if (err.code) text += ' (code ' + err.code + ')';
    return text;
  }

  // Resets AVPlay to NONE after a failed open/prepare. Without this the
  // player stays half-open, and the next open() throws InvalidStateError,
  // so one bad link would break every link after it.
  function resetAfterFailure() {
    currentUrl = null;
    try {
      webapis.avplay.close();
    } catch (e) {
      log.warn('close after failure threw', describeError(e));
    }
  }

  function attachListeners() {
    webapis.avplay.setListener({
      onbufferingstart: function () {
        log.info('buffering start');
        handlers.onStateChange('buffering');
      },
      onbufferingprogress: function (percent) {
        log.info('buffering ' + percent + '%');
      },
      onbufferingcomplete: function () {
        log.info('buffering complete');
        handlers.onStateChange('playing');
      },
      onstreamcompleted: function () {
        log.info('stream completed');
        stop();
        handlers.onStateChange('stopped');
      },
      oncurrentplaytime: function (currentTime) {
        var sec = Math.floor(currentTime / 1000);
        // Fires every ~500ms -- one line per 10s of playback is plenty
        // to confirm it's advancing without flooding the console.
        if (lastLoggedPlayTimeSec < 0 || Math.abs(sec - lastLoggedPlayTimeSec) >= 10) {
          log.info('play time ' + sec + 's');
          lastLoggedPlayTimeSec = sec;
        }
        handlers.onPlayTime(sec);
      },
      onerror: function (eventType) {
        log.error('onerror', eventType, 'url=' + currentUrl);
        handlers.onError({ code: 'PLAYBACK_FAILED', message: String(eventType) });
      },
      onevent: function (eventType, eventData) {
        log.info('onevent', eventType, eventData);
      },
      onsubtitlechange: function (duration, text) {
        log.info('onsubtitlechange', duration, text);
      },
      ondrmevent: function (drmEvent, drmData) {
        log.info('ondrmevent', drmEvent, drmData);
      }
    });
  }

  function openAndPlay(url, startPositionSec) {
    currentUrl = url;
    lastLoggedPlayTimeSec = -1;
    log.info('open', url, 'start=' + (startPositionSec || 0) + 's');
    try {
      webapis.avplay.open(url);
      attachListeners();
      webapis.avplay.setDisplayRect(0, 0, 1920, 1080);
      webapis.avplay.prepareAsync(
        function () {
          log.info('prepared, duration=' + getDurationSec() + 's');
          if (startPositionSec) {
            webapis.avplay.seekTo(startPositionSec * 1000);
          }
          webapis.avplay.play();
          handlers.onStateChange('playing');
        },
        function (err) {
          log.error('prepareAsync failed', describeError(err), 'url=' + url, err);
          resetAfterFailure();
          handlers.onError({ code: 'PREPARE_FAILED', message: describeError(err) });
        }
      );
    } catch (e) {
      // Thrown synchronously (bad URI, wrong player state). Previously
      // uncaught, so the companion never heard anything back at all.
      log.error('open failed', describeError(e), 'url=' + url, e);
      resetAfterFailure();
      handlers.onError({ code: 'OPEN_FAILED', message: describeError(e) });
    }
  }

  function play(url, startPositionSec) {
    if (!isAvailable()) {
      log.error('webapis.avplay unavailable (webapis=' + typeof webapis + ')');
      handlers.onError({ code: 'AVPLAY_UNAVAILABLE', message: 'webapis.avplay is not available on this device.' });
      return;
    }
    // The protocol has no separate "resume" action (see PROTOCOL.md) --
    // a companion resuming from pause just resends "play" with the same
    // url. Reopening/re-preparing that stream from scratch would lose
    // position and add latency, so treat "same url, already loaded" as
    // resume instead of a fresh open.
    if (currentUrl === url) {
      log.info('same url already loaded -- resuming instead of reopening');
      webapis.avplay.play();
      handlers.onStateChange('playing');
      return;
    }
    stop();
    openAndPlay(url, startPositionSec);
  }

  function pause() {
    if (!isAvailable() || !currentUrl) {
      log.warn('pause ignored: nothing loaded');
      return;
    }
    log.info('pause');
    webapis.avplay.pause();
    handlers.onStateChange('paused');
  }

  // Local un-pause, distinct from play(url, ...): the TV remote's own
  // Play button has no url to hand us, it just means "un-pause whatever
  // is already loaded" -- unlike a companion's resume, which resends
  // "play" with the url because it has no other way to identify the
  // stream (see the comment on play() above).
  function resume() {
    if (!isAvailable() || !currentUrl) {
      log.warn('resume ignored: nothing loaded');
      return;
    }
    log.info('resume');
    webapis.avplay.play();
    handlers.onStateChange('playing');
  }

  function seek(positionSec) {
    if (!isAvailable() || !currentUrl) {
      log.warn('seek ignored: nothing loaded');
      return;
    }
    log.info('seek to ' + positionSec + 's');
    webapis.avplay.seekTo(positionSec * 1000);
  }

  // Only valid once prepareAsync's success callback has fired -- AVPlay
  // throws if asked before a stream is loaded, so treat that as "unknown"
  // rather than letting it break status reporting.
  function getDurationSec() {
    if (!isAvailable() || !currentUrl) return 0;
    try {
      return Math.floor(webapis.avplay.getDuration() / 1000);
    } catch (e) {
      log.warn('getDuration threw', e);
      return 0;
    }
  }

  // Rewind/fast-forward from the TV remote's own media keys, relative to
  // wherever playback actually is right now (getCurrentTime is a plain
  // synchronous AVPlay getter, no need to track position ourselves).
  function seekBy(deltaSec) {
    if (!isAvailable() || !currentUrl) {
      log.warn('seekBy ignored: nothing loaded');
      return;
    }
    var current = webapis.avplay.getCurrentTime();
    var target = Math.max(0, current + deltaSec * 1000);
    log.info('seekBy ' + deltaSec + 's: ' + Math.floor(current / 1000) + 's -> ' + Math.floor(target / 1000) + 's');
    webapis.avplay.seekTo(target);
  }

  function stop() {
    if (!isAvailable() || !currentUrl) return;
    log.info('stop + close');
    try {
      webapis.avplay.stop();
      webapis.avplay.close();
    } catch (e) {
      // Already stopped/closed -- nothing to clean up.
      log.warn('stop/close threw (already stopped?)', e);
    }
    currentUrl = null;
  }

  return {
    play: play,
    pause: pause,
    resume: resume,
    seek: seek,
    seekBy: seekBy,
    stop: stop,
    getDurationSec: getDurationSec
  };
}
