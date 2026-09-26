'use strict';

// Thin wrapper around Samsung's webapis.avplay (loaded via the
// $WEBAPIS/webapis/webapis.js bridge in index.html — only resolves on a
// real Tizen TV or the Tizen Studio TV emulator, not a desktop browser).
// Requires the tv.avplay privilege in config.xml -- without it, webapis.js
// still loads but webapis.avplay is undefined.
function createPlayer(handlers) {
  var currentUrl = null;
  var currentSubtitleUrl = null;
  var generation = 0, seekTarget = null, seekBusy = false, seekTimer = null;
  var seekFailures = 0, buffering = false;
  var captionTracks = [], selectedCaption = null, captionPath = null;
  var captionRequest = 0, captionBusy = false, captionError = null, captionTimer = null;

  function getCaptions() {
    return { supported: isAvailable() && typeof webapis.avplay.setSilentSubtitle === 'function',
      mediaId: currentUrl ? String(generation) : null, tracks: captionTracks.slice(),
      selectedId: selectedCaption, busy: captionBusy, error: captionError };
  }
  function reportCaptions() { if (handlers.onCaptions) handlers.onCaptions(getCaptions()); }
  function resetCaptions() {
    captionRequest++; clearTimeout(captionTimer);
    captionTracks = []; selectedCaption = null; captionPath = null;
    captionBusy = false; captionError = null;
  }
  function refreshCaptions() {
    var tracks = [];
    try {
      if (webapis.avplay.getTotalTrackInfo) tracks = webapis.avplay.getTotalTrackInfo();
    } catch (_) { return; } // Some firmware exposes tracks only after playback starts.
    if (!Array.isArray(tracks)) tracks = [];
    captionTracks = tracks.filter(function (track) { return track && track.type === 'TEXT' && typeof track.index === 'number' && isFinite(track.index) && track.index >= 0; }).slice(0, 64).map(function (track) {
      var info = {};
      try { info = typeof track.extra_info === 'string' ? JSON.parse(track.extra_info) : track.extra_info || {}; } catch (_) {}
      info = info || {};
      return { id: 'embedded:' + track.index, label: String(info.track_lang || info.language || 'Captions').slice(0, 80) + ' (track ' + (track.index + 1) + ')' };
    });
    if (captionPath) captionTracks.push({ id: 'external', label: 'External subtitles' });
  }
  function setCaptions(payload) {
    if (!currentUrl || !payload || payload.mediaId !== String(generation)) return;
    var token = ++captionRequest, session = generation;
    clearTimeout(captionTimer); captionBusy = false; captionError = null;
    function valid() { return session === generation && token === captionRequest; }
    function fail(error) {
      if (!valid()) return;
      clearTimeout(captionTimer); captionBusy = false; captionError = describeError(error);
      captionRequest++; reportCaptions();
    }
    try {
      var state = webapis.avplay.getState();
      if (state !== 'PLAYING' && state !== 'PAUSED') throw new Error('Wait until playback is ready to change captions.');
      if (!getCaptions().supported) throw new Error('Captions are unavailable on this TV.');
      if (payload.subtitleUrl) {
        if (typeof tizen === 'undefined' || !tizen.download || !webapis.avplay.setExternalSubtitlePath) throw new Error('External subtitles are unavailable on this TV.');
        captionBusy = true; reportCaptions();
        captionTimer = setTimeout(function () { fail(new Error('Subtitle download timed out. Try again.')); }, 20000);
        tizen.download.start(new tizen.DownloadRequest(payload.subtitleUrl, 'wgt-private-tmp'), {
          oncompleted: function (id, localPath) {
            if (!valid()) return;
            try {
              webapis.avplay.setExternalSubtitlePath(localPath);
              webapis.avplay.setSilentSubtitle(false);
              captionPath = localPath; currentSubtitleUrl = payload.subtitleUrl;
              selectedCaption = 'external'; captionBusy = false; clearTimeout(captionTimer);
              refreshCaptions(); reportCaptions();
            } catch (error) { fail(error); }
          },
          onfailed: function (id, error) { fail(error); }
        });
        return;
      }
      if (payload.trackId === null) webapis.avplay.setSilentSubtitle(true);
      else {
        refreshCaptions();
        if (!captionTracks.some(function (track) { return track.id === payload.trackId; })) throw new Error('This caption track is no longer available.');
        if (payload.trackId === 'external') webapis.avplay.setExternalSubtitlePath(captionPath);
        else webapis.avplay.setSelectTrack('TEXT', Number(payload.trackId.split(':')[1]));
        webapis.avplay.setSilentSubtitle(false);
      }
      selectedCaption = payload.trackId; reportCaptions();
    } catch (error) { fail(error); }
  }

  function fitDisplay() {
    if (!isAvailable() || !currentUrl) return;
    try {
      var w = typeof window !== 'undefined' ? window.innerWidth : 1920;
      var h = typeof window !== 'undefined' ? window.innerHeight : 1080;
      w = w || 1920; h = h || 1080;
      var rect = { x: 0, y: 0, width: w, height: h };
      // Give the decoder the whole screen and let LETTER_BOX fit the video.
      // Do not also derive the display rectangle from coded Width/Height;
      // malformed metadata must never leave the previous video's layout behind.
      // AVPlay uses 1920x1080 coordinates regardless of the CSS viewport.
      webapis.avplay.setDisplayRect(Math.round(rect.x * 1920 / w), Math.round(rect.y * 1080 / h),
        Math.round(rect.width * 1920 / w), Math.round(rect.height * 1080 / h));
      if (webapis.avplay.setDisplayMethod) webapis.avplay.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX');
      var surface = typeof document !== 'undefined' && document.getElementById('av-player');
      if (surface && surface.style) {
        surface.style.left = rect.x + 'px'; surface.style.top = rect.y + 'px';
        surface.style.width = rect.width + 'px'; surface.style.height = rect.height + 'px';
      }
    } catch (e) { log.warn('display layout unavailable', describeError(e));
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
    resetCaptions();
    currentUrl = null;
    currentSubtitleUrl = null;
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
          refreshCaptions();
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
        refreshCaptions(); reportCaptions();
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

  function openAndPlay(url, startPositionSec, subtitleUrl) {
    currentUrl = url;
    currentSubtitleUrl = subtitleUrl || null;
    lastLoggedPlayTimeSec = -1;
    log.info('open', url, 'start=' + (startPositionSec || 0) + 's');
    try {
      webapis.avplay.open(url);
      attachListeners();
      fitDisplay();
      var token = generation;
      function prepare() { webapis.avplay.prepareAsync(
        function () {
          if (token !== generation) return;
          fitDisplay(); buffering = false;
          log.info('prepared, duration=' + getDurationSec() + 's');
          if (startPositionSec) {
            webapis.avplay.seekTo(startPositionSec * 1000);
          }
          webapis.avplay.play();
          refreshCaptions();
          try {
            if (webapis.avplay.setSilentSubtitle) webapis.avplay.setSilentSubtitle(!captionPath);
            selectedCaption = captionPath ? 'external' : null;
          } catch (error) { captionError = describeError(error); }
          handlers.onStateChange('playing');
          processSeek();
        },
        function (err) {
          if (token !== generation) return;
          log.error('prepareAsync failed', describeError(err), 'url=' + url, err);
          resetAfterFailure();
          handlers.onError({ code: 'PREPARE_FAILED', message: describeError(err) });
        }
      ); }
      if (subtitleUrl) {
        if (typeof tizen === 'undefined' || !tizen.download || !webapis.avplay.setExternalSubtitlePath) {
          throw new Error('External subtitles are unavailable on this TV.');
        }
        var request = new tizen.DownloadRequest(subtitleUrl, 'wgt-private-tmp');
        tizen.download.start(request, {
          oncompleted: function (id, localPath) {
            if (token !== generation) return;
            try { webapis.avplay.setExternalSubtitlePath(localPath); captionPath = localPath; prepare(); }
            catch (error) {
              resetAfterFailure();
              handlers.onError({ code: 'SUBTITLE_FAILED', message: describeError(error) });
            }
          },
          onfailed: function (id, error) {
            if (token !== generation) return;
            resetAfterFailure();
            handlers.onError({ code: 'SUBTITLE_FAILED', message: describeError(error) });
          }
        });
      } else prepare();
    } catch (e) {
      // Thrown synchronously (bad URI, wrong player state). Previously
      // uncaught, so the companion never heard anything back at all.
      log.error('open failed', describeError(e), 'url=' + url, e);
      resetAfterFailure();
      handlers.onError({ code: 'OPEN_FAILED', message: describeError(e) });
    }
  }

  function play(url, startPositionSec, subtitleUrl) {
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
    if (currentUrl === url && currentSubtitleUrl === (subtitleUrl || null)) {
      log.info('same url already loaded -- resuming instead of reopening');
      webapis.avplay.play();
      handlers.onStateChange('playing');
      return;
    }
    stop();
    openAndPlay(url, startPositionSec, subtitleUrl);
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
    resetCaptions();
    if (!isAvailable() || !currentUrl) return;
    log.info('stop + close');
    try {
      webapis.avplay.stop();
    } catch (e) {
      // AVPlay cannot stop while it is still IDLE (e.g. subtitle download).
      log.warn('stop threw (already stopped or not prepared)', e);
    }
    try { webapis.avplay.close(); }
    catch (e) { log.warn('close threw (already closed)', e); }
    currentUrl = null;
    currentSubtitleUrl = null;
  }

  return {
    play: play,
    pause: pause,
    resume: resume,
    seek: seek,
    seekBy: seekBy,
    stop: stop,
    getDurationSec: getDurationSec,
    getCaptions: getCaptions,
    setCaptions: setCaptions
  };
}
