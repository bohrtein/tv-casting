'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { saveThumbnail, libraryFields } = require('./library');
const identity = (entry) => entry.metadata
  ? JSON.stringify([entry.metadata.type, entry.metadata.addon || '', entry.metadata.id, entry.metadata.videoId || ''])
  : JSON.stringify([entry.kind, entry.key || entry.fileName]);
const seriesId = m => JSON.stringify([m.type, m.addon || '', m.id]);
const order = (a, b) => a.season - b.season || a.episode - b.episode;
class LibraryState {
  constructor(dir) {
    this.file = path.join(dir, 'library-state.json');
    this.artDir = path.join(dir, 'library-art');
    fs.mkdirSync(this.artDir, { recursive: true });
    this.data = { titles: {}, progress: {}, artwork: {} };
    try { Object.assign(this.data, JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    this.pending = new Set();
    this.enriching = new Set();
    this.queue = Promise.resolve();
  }
  save() {
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.data));
    fs.renameSync(this.file + '.tmp', this.file);
  }
  remember(m) {
    if (!m) return;
    const id = seriesId(m), old = this.data.titles[id];
    const next = { ...old, ...m };
    for (const key of ['videoId', 'season', 'episode', 'episodeTitle']) delete next[key];
    // Legacy episode-only updates must not discard the saved season catalog.
    if (!m.videos && old) next.videos = old.videos;
    if (JSON.stringify(next) !== JSON.stringify(old)) { this.data.titles[id] = next; this.save(); }
    [m.poster, m.background, ...(m.videos || []).map(v => v.thumbnail)].filter(Boolean).forEach(url => this.cacheArt(url));
    if (m.type === 'series' && !next.videos && /^tt\d{7,}$/.test(m.id) && !this.enriching.has(id)) {
      this.enriching.add(id);
      // Upgrade older Cinemeta downloads without fetching their media again.
      fetch('https://v3-cinemeta.strem.io/meta/series/' + encodeURIComponent(m.id) + '.json', { signal: AbortSignal.timeout(15000) })
        .then(r => { if (!r.ok) throw new Error('Metadata unavailable'); return r.json(); })
        .then(body => {
          if (!body.meta || !Array.isArray(body.meta.videos)) return;
          this.remember(libraryFields({ metadata: { ...body.meta, ...m, videos: body.meta.videos } }).metadata);
        }).catch(() => {});
    }
  }
  cacheArt(url) {
    if (this.data.artwork[url] || this.pending.has(url)) return;
    this.pending.add(url);
    this.queue = this.queue.then(async () => {
      try {
        const name = await saveThumbnail(url, this.artDir, crypto.createHash('sha256').update(url).digest('hex'));
        if (name) { this.data.artwork[url] = name; this.save(); }
      } catch (_) { /* Metadata remains available even if an artwork provider fails. */ }
      finally { this.pending.delete(url); }
    });
  }
  localMetadata(m, origin) {
    if (!m) return null;
    const art = url => this.data.artwork[url] ? origin + '/library-art/' + this.data.artwork[url] : url;
    return { ...m, poster: art(m.poster), background: art(m.background), videos: (m.videos || []).map(v => ({ ...v, thumbnail: art(v.thumbnail), progress: this.progress({ metadata: { ...m, videoId: v.id } }) })) };
  }
  progress(entry) { return this.data.progress[identity(entry)] || { positionSec: 0, durationSec: 0, watched: false }; }
  update(entry, body) {
    if (!Number.isFinite(body.positionSec) || body.positionSec < 0 || !Number.isFinite(body.durationSec) || body.durationSec < 0) throw new Error('Invalid playback progress.');
    const previous = this.progress(entry);
    const durationSec = body.durationSec || previous.durationSec;
    const positionSec = durationSec ? Math.min(body.positionSec, durationSec) : body.positionSec;
    // Only a natural end of a complete file counts as watched. Partial-file EOF never advances.
    const watched = body.completed === true && !entry.partial;
    this.data.progress[identity(entry)] = { positionSec, durationSec, watched, updatedAt: Date.now() };
    this.save();
    return this.progress(entry);
  }
  next(entry, entries) {
    const m = entry.metadata;
    if (!m || m.type !== 'series' || !m.season || entry.partial) return null;
    const title = this.data.titles[seriesId(m)] || m;
    const known = (title.videos || []).filter(v => v.season > 0).sort(order);
    let target = known.find(v => order(v, m) > 0);
    if (!target) {
      if (known.length) return null;
      // Old downloads without a full catalog: only advance within a known consecutive pair.
      target = { season: m.season, episode: m.episode + 1 };
    }
    return entries.find(e => e.metadata && seriesId(e.metadata) === seriesId(m) &&
      e.metadata.season === target.season && e.metadata.episode === target.episode && !e.partial && !e.needsTvCopy) || null;
  }
}
module.exports = { LibraryState, identity, seriesId };
