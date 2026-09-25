'use strict';

// Thin wrapper around Samsung's webapis.avplay (loaded via the
// $WEBAPIS/webapis/webapis.js bridge in index.html — only resolves on a
// real Tizen TV or the Tizen Studio TV emulator, not a desktop browser).
// Requires the tv.avplay privilege in config.xml -- without it, webapis.js
// still loads but webapis.avplay is undefined.
function createPlayer(handlers) {
  var currentUrl = null;
  var generation = 0, seekTarget = null, seekBusy = false, seekTimer = null;
  var seekFailures = 0, buffering = false;

  function fitDisplay() {
    if (!isAvailable() || !currentUrl) return;
    try {
      var w = typeof window !== 'undefined' ? window.innerWidth : 1920;
      var h = typeof window !== 'undefined' ? window.innerHeight : 1080;
      w = w || 1920; h = h || 1080;
      var rect = { x: 0, y: 0, width: w, height: h };
      var tracks = [];
      try { tracks = webapis.avplay.getCurrentStreamInfo ? webapis.avplay.getCurrentStreamInfo() : []; } catch (_) {};
      tracks.forEach(function (track) {
        if (track.type !== 'VIDEO') return;
        var info = typeof track.extra_info === 'string' ? JSON.parse(track.extra_info) : track.extra_info || {};
        var vw = Number(info.Width || info.width), vh = Number(info.Height || info.height);
        if (!(vw > 0 && vh > 0)) return;
        var scale = Math.min(w / vw, h / vh);
        rect.width = vw * scale; rect.height = vh * scale;
        rect.x = (w - rect.width) / 2; rect.y = (h - rect.height) / 2;
      });
      // AVPlay uses 1920x1080 coordinates regardless of the CSS viewport.
      webapis.avplay.setDisplayRect(Math.round(rect.x * 1920 / w), Math.round(rect.y * 1080 / h),
        Math.round(rect.width * 1920 / w), Math.round(rect.height * 1080 / h));
      if (webapis.avplay.setDisplayMethod) webapis.avplay.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX');
      var surface = typeof document !== 'undefined' && document.getElementById('av-player');
      if (surface && surface.style) {
        surface.style.left = rect.x + 'px'; surface.style.top = rect.y + 'px';
        surface.style.width = rect.width + 'px'; surface.style.height = rect.height + 'px';
      }
    } catch (e) { log.warn('display metadata unavailable', describeError(e));
      try { webapis.avplay.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX'); } catch (_) {}
    }
  }
  if (typeof window !== 'undefined') window.addEventListener('resize', fitDisplay);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', fitDisplay);

  function reportSeek(error) {
    if (handlers.onSeek) handlers.onSeek({ targetSec: seekTarget, busy: seekBusy, error: error || null });
  }
  function processSeek() {
    if (seekTarget === null || seekBusy || buffering || !currentUrl) return;
    clearTimeout(seekTimer);
    var state = webapis.avplay.getState();
    if (state !== 'PLAYING' && state !== 'PAUSED') return;
    var target = seekTarget, token = generation, settled = false;
    seekBusy = true; reportSeek();
    function failed(err) {
      if (token !== generation || settled) return;
      settled = true;
      clearTimeout(seekTimer); seekBusy = false; seekFailures++;
      log.warn('seek retained for retry', target, describeError(err));
      reportSeek('Seek pending: ' + describeError(err));
      if (seekFailures < 3) seekTimer = setTimeout(processSeek, 750);
    }
    seekTimer = setTimeout(function () { failed('TV did not acknowledge seek'); }, 10000);
    try {
      webapis.avplay.seekTo(target * 1000, function () {
        if (token !== generation || settled) return;
        settled = true;
        clearTimeout(seekTimer); seekBusy = false; seekFailures = 0;
        if (seekTarget === target) seekTarget = null;
        reportSeek(); processSeek();
      }, failed);
    } catch (e) { failed(e); }
  }
  function resetSeek() {
    generation++; clearTimeout(seekTimer); seekTarget = null; seekBusy = false; seekFailures = 0; buffering = false;
    reportSeek();
  }
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

  function hostOf(url) {
    var m = /^[a-z]+:\/\/([^/?#]+)/i.exec(url || '');
    return m ? m[1] : 'an unknown address';
  }

  // Resets AVPlay to NONE after a failed open/prepare. Without this the
  // player stays half-open, and the next open() throws InvalidStateError,
  // so one bad link would break every link after it.
  function resetAfterFailure() {
    resetSeek();
    currentUrl = null;
    try {
      webapis.avplay.close();
    } catch (e) {
      log.warn('close after failure threw', describeError(e));
    }
  }

  function attachListeners() {
    var token = generation;
    var listeners = {
      onbufferingstart: function () {
        buffering = true;
        log.info('buffering start');
        handlers.onStateChange('buffering');
      },
      onbufferingprogress: function (percent) {
        log.info('buffering ' + percent + '%');
      },
      onbufferingcomplete: function () {
        buffering = false; fitDisplay(); processSeek();
        log.info('buffering complete');
        var state = webapis.avplay.getState();
        if (state === 'PAUSED' || state === 'PLAYING') {
          handlers.onStateChange(state === 'PAUSED' ? 'paused' : 'playing');
        }
      },
      onstreamcompleted: function () {
        if (!currentUrl) return;
        log.info('stream completed');
        stop();
        handlers.onStateChange('stopped');
        if (handlers.onCompleted) handlers.onCompleted();
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
        var url = currentUrl;
        log.error('onerror', Array.prototype.slice.call(arguments), 'url=' + url);
        // Some firmware calls this with no argument at all, which used to
        // reach the companion as the bare word "undefined". Name what
        // failed instead: usually the TV couldn't connect to, or read,
        // that server.
        var reason = eventType ? describeError(eventType)
          : 'the TV player gave no reason';
        // Same half-open state as a failed prepare: without the reset,
        // casting the same link again only "resumes" the dead player.
        resetAfterFailure();
        handlers.onError({
          code: 'PLAYBACK_FAILED',
          message: 'Playback failed (' + reason + ') while playing from ' + hostOf(url) +
            '. Check that the TV can reach that server and that the file is a format the TV plays.'
        });
      },
      onevent: function (eventType, eventData) {
        fitDisplay();
        log.info('onevent', eventType, eventData);
      },
      onsubtitlechange: function (duration, text) {
        log.info('onsubtitlechange', duration, text);
      },
      ondrmevent: function (drmEvent, drmData) {
        log.info('ondrmevent', drmEvent, drmData);
      }
    };
    Object.keys(listeners).forEach(function (name) {
      var callback = listeners[name];
      listeners[name] = function () { if (token === generation) callback.apply(null, arguments); };
    });
    webapis.avplay.setListener(listeners);
  }

  function openAndPlay(url, startPositionSec) {
    currentUrl = url;
    lastLoggedPlayTimeSec = -1;
    log.info('open', url, 'start=' + (startPositionSec || 0) + 's');
    try {
      webapis.avplay.open(url);
      attachListeners();
      fitDisplay();
      var token = generation;
      webapis.avplay.prepareAsync(
        function () {
          if (token !== generation) return;
          fitDisplay(); buffering = false;
          log.info('prepared, duration=' + getDurationSec() + 's');
          if (startPositionSec) {
            webapis.avplay.seekTo(startPositionSec * 1000);
          }
          webapis.avplay.play();
          handlers.onStateChange('playing');
          processSeek();
        },
        function (err) {
          if (token !== generation) return;
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

  // Un-pause whatever is already loaded, no url needed: the TV remote's
  // own Play button, and a companion's "resume" command (PROTOCOL.md),
  // which lets any phone resume, not only the one that cast it. Resending
  // "play" with the same url (see play() above) also still resumes.
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
    if (!isAvailable() || !currentUrl || !isFinite(positionSec)) return;
    var duration = getDurationSec();
    seekTarget = Math.max(0, duration ? Math.min(positionSec, duration - 1) : positionSec);
    seekFailures = 0; reportSeek();
    if (!seekBusy) { clearTimeout(seekTimer); seekTimer = setTimeout(processSeek, 250); }
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
    if (!isAvailable() || !currentUrl || !isFinite(deltaSec)) return;
    var base = seekTarget !== null ? seekTarget : webapis.avplay.getCurrentTime() / 1000;
    seek(base + deltaSec);
  }

  function stop() {
    resetSeek();
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
