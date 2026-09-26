'use strict';

// AirPlay to a TV outside the home. AirPlay hands the TV a link and the TV
// fetches the video itself, but it can't reach this server's private
// addresses (or log in to the guest door). So on a page opened over HTTPS,
// while AirPlay is on, a saved video plays from the public address set in
// the companion's Settings behind a key (resolver share.js), and back from
// the usual address when AirPlay is off. Keys last 3 hours; a new one takes
// over mid-video a few minutes before the current one runs out.
//
// The owner's pages use one key for every video. Guests (perVideo) get a
// key for each video, which opens only that one: the guest door hands out
// keys for videos in that person's library only.
//
// opts: video, resolverUrl, perVideo, loadedUrl() (what's playing, as the
// page loaded it), usable() (false while hls.js plays it, which AirPlay
// can't take over), resume() (play on after a swap), generation() (changes
// with each new video).
function createAwayLinks(opts) {
  var RENEW_BEFORE_MS = 10 * 60 * 1000;
  var video = opts.video;
  var base = '', keys = {}, asking = {}, renewTimer = 0, wireless = false;

  function savedVideoPath(url) {
    var path;
    try { path = new URL(url, location.href).pathname; } catch (_) { return null; }
    var at = path.indexOf('/media/');
    return at === -1 ? null : path.slice(at);
  }
  // Which key a video uses: the one shared key, or its own (a torrent's
  // playlist and segments share the folder's).
  function keyName(path) {
    return opts.perVideo ? path.replace(/\/(?:original\/)?(?:index\.m3u8|seg\d{5}\.ts)$/, '/') : '*';
  }
  function keyFor(path) {
    var name = keyName(path), key = keys[name];
    if (key && key.until - Date.now() > key.renewBefore) return Promise.resolve(key);
    if (!asking[name]) {
      asking[name] = fetch(opts.resolverUrl + '/share', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts.perVideo ? { url: path } : {})
      }).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      }).then(function (answer) {
        // Timed on this device's clock, whatever the server's says.
        // Renew 10 minutes early, or halfway through a key shorter than that.
        var renewBefore = Math.min(RENEW_BEFORE_MS, answer.expiresIn / 2);
        keys[name] = { prefix: answer.prefix, until: Date.now() + answer.expiresIn, renewBefore: renewBefore };
        delete asking[name];
        clearTimeout(renewTimer);
        renewTimer = setTimeout(function () { if (wireless) apply(); }, answer.expiresIn - renewBefore + 1000);
        return keys[name];
      }, function (err) { delete asking[name]; throw err; });
    }
    return asking[name];
  }
  function apply() {
    var url = opts.loadedUrl();
    if (!url || !opts.usable()) return;
    var path = savedVideoPath(url);
    if (!wireless || !base || !path) { swap(url); return; }
    keyFor(path).then(function (key) {
      if (opts.loadedUrl() === url && wireless) swap(base + key.prefix + path);
    }, function () {});
  }
  // Swap the source in place, keeping the position and play/pause.
  function swap(want) {
    if (video.getAttribute('src') === want) return;
    // Not started yet: the page's own start (position, autoplay) still applies.
    if (video.readyState < 1) { video.src = want; return; }
    var at = video.currentTime, playing = !video.paused, token = opts.generation();
    video.onloadedmetadata = function () {
      if (token !== opts.generation()) return;
      if (at) video.currentTime = at;
      if (playing) opts.resume();
    };
    video.src = want;
  }
  function prepare() {
    var path = base && opts.loadedUrl() && savedVideoPath(opts.loadedUrl());
    if (path && opts.usable()) keyFor(path).catch(function () {});
  }

  if (location.protocol === 'https:') {
    fetch('api/airplay-settings', { cache: 'no-store' }).then(function (res) { return res.ok ? res.json() : {}; }).then(function (saved) {
      base = String(saved.publicUrl || '').replace(/\/+$/, '');
      prepare();
    }).catch(function () {});
  }

  return {
    // A new video was just loaded: have its key ready, so switching when
    // AirPlay comes on is immediate (and switch now if it's already on).
    loaded: function () { prepare(); if (wireless) apply(); },
    // AirPlay turned on or off.
    setWireless: function (on) { wireless = !!on; apply(); }
  };
}

if (typeof module !== 'undefined') module.exports = createAwayLinks;
