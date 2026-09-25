'use strict';

const fs = require('fs');
const path = require('path');
const CATEGORIES = ['porn', 'movies', 'series', 'youtube', 'other'];

function libraryFields(body) {
  const fields = {};
  if (typeof body.title === 'string' && body.title.trim()) fields.title = body.title.trim().slice(0, 300);
  if (Number.isFinite(body.progressSec) && body.progressSec >= 0) {
    fields.progressSec = Math.floor(body.progressSec);
    if (Number.isFinite(body.durationSec) && body.durationSec >= 0) fields.durationSec = Math.floor(body.durationSec);
    return fields;
  }
  if (body.category && body.category !== 'auto') {
    if (!CATEGORIES.includes(body.category)) throw new Error('Unknown library category.');
    fields.category = body.category;
  }
  if (body.metadata) {
    const m = body.metadata;
    if (!['movie', 'series'].includes(m.type) || typeof m.id !== 'string' || !m.id ||
        typeof m.name !== 'string' || !m.name) throw new Error('Invalid Stremio metadata.');
    fields.metadata = {};
    for (const key of ['id', 'type', 'name', 'poster', 'description', 'videoId', 'episodeTitle', 'episodePoster', 'addon']) {
      if (typeof m[key] === 'string') fields.metadata[key] = m[key].slice(0, key === 'description' ? 5000 : 2000);
    }
    for (const key of ['season', 'episode']) {
      if (Number.isInteger(m[key]) && m[key] >= 0) fields.metadata[key] = m[key];
    }
    if (Number.isFinite(m.progressSec) && m.progressSec >= 0) fields.metadata.progressSec = Math.floor(m.progressSec);
    if (Number.isFinite(m.durationSec) && m.durationSec >= 0) fields.metadata.durationSec = Math.floor(m.durationSec);
    if (m.videos && Array.isArray(m.videos)) {
      fields.metadata.videos = m.videos.slice(0, 2000).map((v) => {
        const video = {};
        for (const key of ['id', 'name', 'title', 'thumbnail', 'overview', 'released']) {
          if (typeof v[key] === 'string') video[key] = v[key].slice(0, 2000);
        }
        for (const key of ['season', 'episode', 'number']) {
          if (Number.isInteger(v[key]) && v[key] >= 0) video[key] = v[key];
        }
        return video;
      });
    }
    if (m.type === 'series' && (!fields.metadata.videoId || !Number.isInteger(m.season) || !Number.isInteger(m.episode))) {
      throw new Error('Choose a specific season and episode before saving a series download.');
    }
    if (!fields.category) fields.category = m.type === 'series' ? 'series' : 'movies';
  }
  return fields;
}

function classify(url, info) {
  let host = '';
  try { host = new URL(url).hostname; } catch (_) {}
  if (/(^|\.)(youtube\.com|youtu\.be)$/.test(host) || /youtube/i.test(info.extractor)) return 'youtube';
  if (/pornhub|xvideos|xnxx|xhamster|youporn|redtube/i.test(info.extractor || '') ||
      /(^|\.)(pornhub\.com|xvideos\.com|xnxx\.com|xhamster\.com|youporn\.com|redtube\.com)$/.test(host)) return 'porn';
  // Explicit extractor categories, rather than age restrictions (which also apply to ordinary films).
  if ((info.categories || []).some((c) => /^(porn|pornography|xxx|adult)$/i.test(c))) return 'porn';
  return 'other';
}

async function saveThumbnail(url, dir, id) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const mime = (response.headers.get('content-type') || '').split(';')[0];
  if (!response.ok || !['image/jpeg', 'image/png', 'image/webp'].includes(mime)) return null;
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 5 * 1024 * 1024) throw new Error('Thumbnail exceeds 5 MB.');
    chunks.push(chunk);
  }
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[mime];
  const name = `${id}.${ext}`;
  fs.writeFileSync(path.join(dir, name), Buffer.concat(chunks));
  return name;
}

module.exports = { libraryFields, classify, saveThumbnail };
