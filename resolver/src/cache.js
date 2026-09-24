'use strict';

const fs = require('fs');
const path = require('path');

const INDEX_FILENAME = 'cache-index.json';

// Keeps the last N distinct source urls' downloaded files around so
// recasting the same link (a rewatch) is instant instead of
// re-downloading. Independent of index.js's TTL sweep, which only
// cleans up orphaned in-progress/error leftovers -- a file tracked here
// is exempt from that sweep and lives until LRU eviction (this class)
// pushes it out for real, not a timer.
//
// Persisted as MEDIA_DIR/cache-index.json so a resolver restart doesn't
// forget what's already on disk and needlessly re-download it.
class MediaCache {
  constructor(mediaDir, maxEntries) {
    this.mediaDir = mediaDir;
    this.maxEntries = maxEntries;
    this.indexPath = path.join(mediaDir, INDEX_FILENAME);
    this.entries = this._load();
  }

  _load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.indexPath, 'utf8'));
      if (!Array.isArray(parsed)) return [];
      // Re-normalize on load so entries written before normalize()
      // grew tracking-param stripping (or before it existed at all)
      // still get matched correctly, without a manual migration step.
      parsed.forEach((e) => { e.sourceUrl = MediaCache.normalize(e.sourceUrl); });
      return parsed;
    } catch (e) {
      return [];
    }
  }

  _save() {
    const tmp = `${this.indexPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.entries, null, 2));
    fs.renameSync(tmp, this.indexPath);
  }

  // Cache-key normalization, not URL validation -- worst case here is a
  // missed cache hit (falls back to a real download, same as before this
  // existed), never a wrong file served, so this stays conservative.
  //
  // The concrete bug this fixes: YouTube's share sheet appends a fresh
  // si= tracking token every single time you hit "Share," even for the
  // exact same video -- so re-sharing the same link from a phone gave
  // the resolver a different-looking url each time, which a plain
  // string-equality cache key treats as a brand new, uncached video.
  static normalize(url) {
    const trimmed = url.trim();
    let u;
    try {
      u = new URL(trimmed);
    } catch (e) {
      return trimmed;
    }

    const host = u.hostname.replace(/^www\.|^m\.|^music\./, '');
    if (host === 'youtube.com' || host === 'youtu.be') {
      let videoId = null;
      if (host === 'youtu.be') {
        videoId = u.pathname.split('/').filter(Boolean)[0] || null;
      } else if (u.pathname === '/watch') {
        videoId = u.searchParams.get('v');
      } else {
        const m = /^\/(shorts|embed)\/([^/]+)/.exec(u.pathname);
        if (m) videoId = m[2];
      }
      // Deliberately drops si/t/list/feature/pp/etc -- the downloaded
      // file is the same video regardless of which tracking params or
      // playlist context a particular share link carried.
      if (videoId) return `https://www.youtube.com/watch?v=${videoId}`;
    }

    // Generic fallback for everything else: strip well-known tracking
    // params and any fragment, keep the rest of the url as-is.
    const TRACKING_PARAMS = ['si', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid', 'igshid', 'feature', 'ref', 'ref_src'];
    TRACKING_PARAMS.forEach((p) => u.searchParams.delete(p));
    u.hash = '';
    return u.toString();
  }

  // Returns the cached entry for `url`, or null on a miss -- including
  // when an entry exists but its file has gone missing from disk (e.g.
  // deleted out from under the cache), which is treated as a miss
  // rather than handed out as a broken streamUrl.
  find(url) {
    const key = MediaCache.normalize(url);
    const entry = this.entries.find((e) => e.sourceUrl === key);
    if (!entry) return null;
    if (!fs.existsSync(path.join(this.mediaDir, entry.fileName))) {
      this.entries = this.entries.filter((e) => e !== entry);
      this._save();
      return null;
    }
    entry.lastUsedAt = Date.now();
    this._save();
    return entry;
  }

  has(fileName) {
    return this.entries.some((e) => e.fileName === fileName);
  }

  // Returns every cached entry, most-recently-used first -- same
  // self-healing as find() (an entry whose file vanished from disk is
  // pruned rather than handed out), just applied to the whole list
  // instead of a single lookup.
  list() {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => fs.existsSync(path.join(this.mediaDir, e.fileName)));
    if (this.entries.length !== before) this._save();
    return this.entries.slice().sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  }

  // Forgets one entry (deleted by hand from the companion). Returns it,
  // or null if it wasn't there; the caller deletes the files.
  remove(fileName) {
    const entry = this.entries.find((e) => e.fileName === fileName);
    if (!entry) return null;
    this.entries = this.entries.filter((e) => e !== entry);
    this._save();
    return entry;
  }

  // Registers a freshly downloaded file, replacing any stale entry for
  // the same source url, then evicts least-recently-used entries beyond
  // maxEntries. Returns the evicted entries so the caller can delete
  // their files (this class only ever touches the index, never disk
  // media files directly, since index.js already owns MEDIA_DIR cleanup).
  add({ sourceUrl, fileName, title }) {
    const key = MediaCache.normalize(sourceUrl);
    this.entries = this.entries.filter((e) => e.sourceUrl !== key);
    this.entries.push({ sourceUrl: key, fileName, title, createdAt: Date.now(), lastUsedAt: Date.now() });

    const evicted = [];
    while (this.entries.length > this.maxEntries) {
      this.entries.sort((a, b) => a.lastUsedAt - b.lastUsedAt);
      evicted.push(this.entries.shift());
    }
    this._save();
    return evicted;
  }
}

module.exports = { MediaCache };
