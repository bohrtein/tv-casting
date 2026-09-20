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
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  _save() {
    const tmp = `${this.indexPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.entries, null, 2));
    fs.renameSync(tmp, this.indexPath);
  }

  static normalize(url) {
    return url.trim();
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
