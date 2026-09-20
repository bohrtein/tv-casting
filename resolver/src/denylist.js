'use strict';

// Domains the rendered-page fallback (genericExtract.js) must never run
// against. Their whole model is embedding video -- often without the
// rights to it -- behind a JS-built player with no static link in the
// page's HTML, which is exactly the shape of site tier 3 would
// otherwise be able to crack open. Checked before genericExtract.js
// ever launches a browser; a denylisted url just falls straight through
// to yt-dlp's original "Unsupported URL" error, same as if tier 3
// didn't exist.
//
// Not exhaustive -- this is a manually maintained list, seeded from
// what's actually shown up in this resolver's own logs plus widely
// known unauthorized-embed hosts. Add entries as new ones turn up
// (check `journalctl --user -u tv-casting-resolver` for "Unsupported
// URL" / "no extractor" errors) rather than trying to enumerate the
// whole category up front. Extend without editing code via the
// RESOLVER_DENYLIST_EXTRA env var (comma-separated hostnames).
const DENYLIST = [
];

function extraFromEnv() {
  return (process.env.RESOLVER_DENYLIST_EXTRA || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (e) {
    return '';
  }
}

// Matches the exact host or any subdomain of a denylisted entry, e.g.
// "www.dood.to" and "cdn123.dood.to" both match "dood.to".
function isDenied(url) {
  const host = hostnameOf(url);
  if (!host) return false;
  const entries = DENYLIST.concat(extraFromEnv());
  return entries.some((entry) => host === entry || host.endsWith('.' + entry));
}

module.exports = { isDenied, DENYLIST };
