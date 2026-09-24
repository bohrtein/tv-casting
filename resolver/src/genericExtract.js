'use strict';

const NAV_TIMEOUT_MS = parseInt(process.env.GENERIC_EXTRACT_TIMEOUT_MS || '20000', 10);
const STREAM_RE = /\.(m3u8|mpd)(\?|$)/i;

// Playwright is only needed for this one fallback tier (JS-rendered
// players yt-dlp's native + generic extractors can't see into), so it's
// required lazily -- a resolver deployment that never hits this path
// doesn't need it installed, and if it *is* missing this fails as a
// clean, catchable error instead of crashing the whole service at boot.
let chromiumPromise = null;
function loadChromium() {
  if (!chromiumPromise) {
    chromiumPromise = Promise.resolve().then(() => require('playwright').chromium);
  }
  return chromiumPromise;
}

// Renders `url` the same way any visitor's browser would -- real JS
// execution, default headless Chromium, no fingerprint spoofing, no
// captcha handling, no anti-bot evasion -- and reads back whatever
// HLS/DASH manifest (or, failing that, a rendered <video src>) that
// render actually produces. This exists purely because yt-dlp's own
// generic extractor only reads the raw HTML response and can't execute
// client-side JS, so a player that builds its <video>/manifest url
// dynamically is invisible to it. If a site detects and blocks
// ordinary automated Chromium, this returns nothing -- same as it
// finding nothing for a normal visitor with JS disabled.
async function extract(url) {
  const chromium = await loadChromium();
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    let found = null;
    page.on('response', (response) => {
      if (found) return;
      let pathname;
      try {
        pathname = new URL(response.url()).pathname;
      } catch (e) {
        return;
      }
      if (STREAM_RE.test(pathname)) {
        found = { streamUrl: response.url(), referer: url };
      }
    });

    await page.goto(url, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT_MS }).catch(() => {});

    if (!found) {
      // Some players set <video src> directly to a file/manifest url
      // rather than fetching one over a request Playwright observes.
      const domSrc = await page.evaluate(() => {
        const el = document.querySelector('video[src], video source[src]');
        return el ? (el.getAttribute('src') || el.src || null) : null;
      }).catch(() => null);
      if (domSrc) {
        try {
          found = { streamUrl: new URL(domSrc, url).href, referer: url };
        } catch (e) {
          // malformed src -- nothing usable
        }
      }
    }

    if (found) {
      found.userAgent = await page.evaluate(() => navigator.userAgent).catch(() => null);
    }
    return found;
  } finally {
    await browser.close();
  }
}

module.exports = { extract };
