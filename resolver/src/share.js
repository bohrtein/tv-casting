'use strict';

// Links for a TV outside the home (AirPlay at a friend's or a hotel): a
// saved video's path behind an expiry time and a signature, as
// /s/<expiry>/<signature>/media/....
//
// The signature covers one video and the expiry, made with a secret that
// only this process holds, so a link read off someone else's TV plays that
// one video until it expires and nothing else: it can't be pointed at
// another file, start a download or reach any other part of the server.
// A new secret each start means a restart also ends every link.
//
// A saved torrent is a playlist plus its segments, fetched by relative
// names from the playlist's folder, so its signature covers the folder
// (the TV's copy and the original alike) instead of a single file.
const crypto = require('crypto');

const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000;
const MEDIA = /^\/media\/(?:([0-9a-f]{16}\.mp4)|torrents\/([0-9a-f]{40}-(?:-1|\d+))\/(?:original\/)?(?:index\.m3u8|seg\d{5}\.ts))$/;
const LINK = /^\/s\/([0-9a-z]{1,11})\/([A-Za-z0-9_-]{43})(\/media\/.+)$/;

// What one signature unlocks, or null for anything that isn't a saved video.
function scopeOf(mediaPath) {
  const match = MEDIA.exec(mediaPath);
  if (!match) return null;
  return match[1] ? 'file:' + match[1] : 'torrent:' + match[2];
}

function createShares({ secret = crypto.randomBytes(32), ttlMs = DEFAULT_TTL_MS, now = Date.now } = {}) {
  function signature(expiry, scope) {
    return crypto.createHmac('sha256', secret).update(expiry + '|' + scope).digest('base64url');
  }

  // A saved video's path (/media/...) -> { path: '/s/...', expiresAt }, or null.
  function sign(mediaPath) {
    const scope = scopeOf(mediaPath);
    if (!scope) return null;
    const expiresAt = Math.floor((now() + ttlMs) / 1000) * 1000;
    const expiry = (expiresAt / 1000).toString(36);
    return { path: '/s/' + expiry + '/' + signature(expiry, scope) + mediaPath, expiresAt };
  }

  // A requested /s/... path -> the /media/... path it may read, or null.
  function open(pathname) {
    const match = LINK.exec(pathname);
    if (!match) return null;
    const [, expiry, given, mediaPath] = match;
    if (parseInt(expiry, 36) * 1000 <= now()) return null;
    const scope = scopeOf(mediaPath);
    if (!scope) return null;
    const expected = Buffer.from(signature(expiry, scope));
    return crypto.timingSafeEqual(Buffer.from(given), expected) ? mediaPath : null;
  }

  return { sign, open };
}

// The /media/... part of a URL the companion was given for a saved video,
// whichever address it came through (http://HOST:8788/media/...,
// https://HOST/resolver/media/...).
function mediaPathOf(url) {
  let pathname;
  try { pathname = new URL(url).pathname; } catch (_) { return null; }
  const at = pathname.indexOf('/media/');
  return at === -1 ? null : pathname.slice(at);
}

module.exports = { createShares, mediaPathOf, scopeOf };
