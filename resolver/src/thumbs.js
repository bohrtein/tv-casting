'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';
const FFPROBE_BIN = process.env.FFPROBE_BIN || 'ffprobe';
// A thumbnail of a film that's still saving is redone after this long,
// so it moves past the opening credits as more of the film lands.
const PARTIAL_MAX_AGE_MS = 5 * 60 * 1000;

// One frame, 480 px wide, as a JPEG: about 20-40 KB. Taken 10% in,
// which skips logos and black opening frames on most videos.
// Args go straight to execve, never a shell (same rule as ytdlp.js).
function grabFrame(input, atSec, out) {
  return new Promise((resolve, reject) => {
    const tmp = `${out}.tmp.jpg`;
    const child = spawn(FFMPEG_BIN, [
      '-v', 'error', '-ss', atSec.toFixed(2), '-i', input,
      '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '5', '-y', tmp
    ]);
    let stderr = '';
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', (err) => reject(new Error(`Could not start ffmpeg: ${err.message}`)));
    child.on('close', (code) => {
      if (code !== 0 || !fs.existsSync(tmp)) {
        fs.rm(tmp, { force: true }, () => {});
        reject(new Error(stderr.trim().split('\n').pop() || `ffmpeg exit ${code}`));
        return;
      }
      fs.rename(tmp, out, (err) => (err ? reject(err) : resolve(out)));
    });
  });
}

function probeDuration(file) {
  return new Promise((resolve) => {
    const child = spawn(FFPROBE_BIN, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
    child.on('error', () => resolve(null));
    child.on('close', () => resolve(parseFloat(out) || null));
  });
}

// Seconds saved so far in an HLS playlist (the sum of its segments).
function playlistSeconds(playlistPath) {
  try {
    const text = fs.readFileSync(playlistPath, 'utf8');
    let total = 0;
    text.replace(/^#EXTINF:([\d.]+)/gm, (m, d) => { total += parseFloat(d); return m; });
    return total;
  } catch (e) {
    return 0;
  }
}

function pickTime(durationSec) {
  if (!durationSec) return 5;
  return Math.max(0, Math.min(durationSec * 0.1, durationSec - 1));
}

// Thumbnails live in MEDIA_DIR/thumbs, named after what they show:
// "media-<file>.jpg" for a link's MP4, "torrents-<key>.jpg" for a film.
// Made the first time someone asks, then kept until the video is deleted.
function createThumbs({ mediaDir, torrentDir, isTorrentComplete }) {
  const thumbDir = path.join(mediaDir, 'thumbs');
  fs.mkdirSync(thumbDir, { recursive: true });
  const inFlight = new Map();

  function thumbPath(kind, name) {
    return path.join(thumbDir, `${kind}-${name}.jpg`);
  }

  async function make(kind, name) {
    const out = thumbPath(kind, name);
    if (kind === 'media') {
      const input = path.join(mediaDir, name);
      if (!fs.existsSync(input)) throw new Error('no such video');
      return grabFrame(input, pickTime(await probeDuration(input)), out);
    }
    const playlist = path.join(torrentDir, name, 'index.m3u8');
    if (!fs.existsSync(playlist)) throw new Error('no such film');
    return grabFrame(playlist, pickTime(playlistSeconds(playlist)), out);
  }

  // Resolves with the JPEG's path, making it first if needed.
  function get(kind, name) {
    const out = thumbPath(kind, name);
    let fresh = false;
    try {
      const stat = fs.statSync(out);
      const partial = kind === 'torrents' && !isTorrentComplete(name);
      fresh = !partial || Date.now() - stat.mtimeMs < PARTIAL_MAX_AGE_MS;
    } catch (e) {
      fresh = false;
    }
    if (fresh) return Promise.resolve(out);
    const key = `${kind}-${name}`;
    if (!inFlight.has(key)) {
      inFlight.set(key, make(kind, name).finally(() => inFlight.delete(key)));
    }
    return inFlight.get(key);
  }

  function remove(kind, name) {
    fs.rm(thumbPath(kind, name), { force: true }, () => {});
  }

  return { get, remove };
}

module.exports = { createThumbs };
