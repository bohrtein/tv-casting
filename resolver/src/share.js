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
const crypto = require('crypto');

const DEFAULT_TTL_MS = 3 * 60 * 60 * 1000;
const MEDIA = /^\/media\/(?:([0-9a-f]{16}\.mp4)|torrents\/([0-9a-f]{40}-(?:-1|\d+))\/(?:original\/)?(?:index\.m3u8|seg\d{5}\.ts))$/;
const LINK = /^\/s\/([0-9a-z]{1,11})\/([A-Za-z0-9_-]{43})(\/media\/.+)$/;

function isSavedVideo(mediaPath) { return typeof mediaPath === 'string' && MEDIA.test(mediaPath); }

function createShares({ secret = crypto.randomBytes(32), ttlMs = DEFAULT_TTL_MS, now = Date.now } = {}) {
  function signature(expiry) {
    return crypto.createHmac('sha256', secret).update('key|' + expiry).digest('base64url');
  }

  // A new key: { prefix: '/s/<expiry>/<signature>', expiresAt, expiresIn }
  // (ms; expiresIn for a device whose clock differs). A saved video's
  // /media/... path after the prefix is its link.
  function issue() {
    const at = now();
    const expiresAt = Math.floor((at + ttlMs) / 1000) * 1000;
    const expiry = (expiresAt / 1000).toString(36);
    return { prefix: '/s/' + expiry + '/' + signature(expiry), expiresAt, expiresIn: expiresAt - at };
  }

  // A requested /s/... path -> the /media/... path it may read, or null.
  function open(pathname) {
    const match = LINK.exec(pathname);
    if (!match) return null;
    const [, expiry, given, mediaPath] = match;
    if (parseInt(expiry, 36) * 1000 <= now() || !isSavedVideo(mediaPath)) return null;
    return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(signature(expiry))) ? mediaPath : null;
  }

  return { issue, open };
}

module.exports = { createShares, isSavedVideo };
