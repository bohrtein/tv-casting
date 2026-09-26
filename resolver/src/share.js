'use strict';

// Keys for a TV outside the home (AirPlay at a friend's or a hotel): a
// saved video's path behind an expiry time and a signature, as
// /s/<expiry>/<signature>/media/....
//
// The signature covers only the expiry, made with a secret that only this
// process holds, so one key opens any saved video until it expires, three
// hours after it was made. It never opens anything else: no download can be
// started and no other part of the server is reached, and saved videos
// have random names that nothing public lists. A new secret each start
// means a restart also ends every key.
//
// A key can also be made for one video only (guests' AirPlay, through the
// companion's guest door): then it opens that video and nothing else. A
// saved torrent is a playlist plus segments fetched by relative names from
// its folder, so its key covers the folder (the TV's copy and the original).
const crypto = require('crypto');

const DEFAULT_TTL_MS = 3 * 60 * 60 * 1000;
const MEDIA = /^\/media\/(?:([0-9a-f]{16}\.mp4)|torrents\/([0-9a-f]{40}-(?:-1|\d+))\/(?:original\/)?(?:index\.m3u8|seg\d{5}\.ts))$/;
const LINK = /^\/s\/([0-9a-z]{1,11})\/([A-Za-z0-9_-]{43})(\/media\/.+)$/;

function isSavedVideo(mediaPath) { return typeof mediaPath === 'string' && MEDIA.test(mediaPath); }
// The one video a key made for it opens: its file, or its torrent's folder.
function scopeOf(mediaPath) {
  const match = typeof mediaPath === 'string' && MEDIA.exec(mediaPath);
  if (!match) return null;
  return match[1] ? 'file:' + match[1] : 'torrent:' + match[2];
}

function createShares({ secret = crypto.randomBytes(32), ttlMs = DEFAULT_TTL_MS, now = Date.now } = {}) {
  function signature(expiry, scope) {
    return crypto.createHmac('sha256', secret).update(scope ? 'video|' + scope + '|' + expiry : 'key|' + expiry).digest('base64url');
  }

  // A new key: { prefix: '/s/<expiry>/<signature>', expiresAt, expiresIn }
  // (ms; expiresIn for a device whose clock differs). A saved video's
  // /media/... path after the prefix is its link. Given one video's path,
  // the key opens only that video; null if it isn't a saved video.
  function issue(mediaPath) {
    const scope = mediaPath === undefined ? null : scopeOf(mediaPath);
    if (mediaPath !== undefined && !scope) return null;
    const at = now();
    const expiresAt = Math.floor((at + ttlMs) / 1000) * 1000;
    const expiry = (expiresAt / 1000).toString(36);
    return { prefix: '/s/' + expiry + '/' + signature(expiry, scope), expiresAt, expiresIn: expiresAt - at };
  }

  // A requested /s/... path -> the /media/... path it may read, or null.
  function open(pathname) {
    const match = LINK.exec(pathname);
    if (!match) return null;
    const [, expiry, given, mediaPath] = match;
    if (parseInt(expiry, 36) * 1000 <= now() || !isSavedVideo(mediaPath)) return null;
    const matches = (expected) => crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
    // Check both kinds every time, so timing doesn't tell which one it was.
    const anyVideo = matches(signature(expiry));
    const thisVideo = matches(signature(expiry, scopeOf(mediaPath)));
    return anyVideo || thisVideo ? mediaPath : null;
  }

  return { issue, open };
}

// The /media/... part of a saved video's URL, whichever address it came
// through (http://HOST:8788/media/..., https://HOST/resolver/media/...).
function mediaPathOf(url) {
  let pathname;
  try { pathname = new URL(url, 'http://x').pathname; } catch (_) { return null; }
  const at = pathname.indexOf('/media/');
  return at === -1 ? null : pathname.slice(at);
}

module.exports = { createShares, isSavedVideo, mediaPathOf };
