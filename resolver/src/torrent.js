'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';
const FFPROBE_BIN = process.env.FFPROBE_BIN || 'ffprobe';
// How long to wait for the Stremio server to find peers and hand back the
// first bytes before calling the torrent dead.
const TORRENT_START_TIMEOUT_MS = parseInt(process.env.TORRENT_START_TIMEOUT_MS || '180000', 10);
// Segments that must be on disk before the TV is told to start. 3 x 6s
// is enough of a head start that playback doesn't immediately stall.
const SEGMENT_SEC = 6;
const READY_SEGMENTS = 3;

// What AVPlay plays without help. Anything else gets converted; video
// conversion is slow, but h264/hevc (nearly every torrent) is only
// copied, so a 2h film costs the server almost nothing.
const COPY_VIDEO = ['h264', 'hevc'];
const COPY_AUDIO = ['aac', 'mp3', 'ac3', 'eac3'];

// Only a Stremio server torrent URL: <server>/<infoHash>/<fileIdx>[?...].
// The key doubles as the folder name, so it has to be this strict.
function parseTorrentUrl(value) {
  let u;
  try {
    u = new URL(value);
  } catch (e) {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const m = /^\/([0-9a-f]{40})\/(-1|\d+)$/i.exec(u.pathname);
  if (!m) return null;
  return { key: `${m[1].toLowerCase()}-${m[2]}` };
}

function isKey(value) {
  return /^[0-9a-f]{40}-(-1|\d+)$/.test(value);
}

// Same rule as ytdlp.js: args go straight to execve, never a shell.
function httpInputArgs() {
  return [
    '-rw_timeout', String(TORRENT_START_TIMEOUT_MS * 1000),
    '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '30'
  ];
}

function probe(url, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(FFPROBE_BIN, [
      '-v', 'error', ...httpInputArgs(),
      '-show_entries', 'format=duration:stream=index,codec_type,codec_name',
      '-of', 'json', url
    ], { signal });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', (err) => {
      if (err.name !== 'AbortError') reject(new Error(`Could not start ffprobe (${FFPROBE_BIN}): ${err.message}`));
    });
    child.on('close', (code) => {
      if (signal && signal.aborted) {
        reject(new Error('Cancelled.'));
        return;
      }
      if (code !== 0) {
        explainFailure(url, stderr).then((msg) => reject(new Error(msg)));
        return;
      }
      try {
        const info = JSON.parse(stdout);
        const streams = info.streams || [];
        resolve({
          duration: parseFloat(info.format && info.format.duration) || null,
          video: streams.find((s) => s.codec_type === 'video'),
          audio: streams.find((s) => s.codec_type === 'audio')
        });
      } catch (e) {
        reject(new Error('ffprobe returned something unreadable.'));
      }
    });
  });
}

// ffprobe only says "Connection timed out", which is the same whether the
// torrent has no peers or the server can't be reached. The server's own
// stats for the torrent (enginefs /<infoHash>/stats.json) tell them apart.
// The URL is left out of the message: with trackers it's a screenful.
async function explainFailure(url, stderr) {
  const u = new URL(url);
  const infoHash = u.pathname.split('/')[1];
  const last = stderr.trim().split('\n').pop() || '';
  const detail = last.replace(/^\S*https?:\/\/\S+:\s*/, '');
  let stats = null;
  let reachable = true;
  try {
    const res = await fetch(`${u.origin}/${infoHash}/stats.json`, { signal: AbortSignal.timeout(5000) });
    stats = res.ok ? await res.json() : null;
  } catch (e) {
    reachable = false;
  }
  const waited = Math.round(TORRENT_START_TIMEOUT_MS / 1000);
  if (!reachable) {
    return `Couldn't reach the torrent server at ${u.origin} (${detail || 'no answer'}). Is it running, and is its VPN connected?`;
  }
  if (stats && typeof stats.peers === 'number') {
    if (stats.peers === 0) {
      return `The torrent found no peers in ${waited}s, so it's probably dead. Try another stream with more seeders.`;
    }
    return `The torrent found ${stats.peers} peer${stats.peers === 1 ? '' : 's'}, but none sent any data in ${waited}s. Try again, or pick a stream with more seeders.`;
  }
  return `The Stremio server couldn't open that torrent${detail ? ` (${detail})` : ''}. It may have no peers.`;
}

// ffmpeg's HLS output reports no size (total_size=N/A), so this adds up
// what's on disk. Finished segments never change, so each is stat'ed once.
function createSizeCounter(dir) {
  const known = new Map();
  return function savedBytes() {
    let total = 0;
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch (e) {
      return 0;
    }
    names.forEach((name) => {
      if (!/^seg\d+\.ts$/.test(name)) return;
      if (!known.has(name)) {
        try {
          known.set(name, fs.statSync(path.join(dir, name)).size);
        } catch (e) {
          return;
        }
      }
      total += known.get(name);
    });
    return total;
  };
}

function countSegments(playlistPath) {
  try {
    return (fs.readFileSync(playlistPath, 'utf8').match(/^#EXTINF/gm) || []).length;
  } catch (e) {
    return 0;
  }
}

// Downloads the torrent's file through the Stremio server and writes it
// into outDir as an HLS playlist + segments. That folder is the cache:
// it stays on disk after playback, and replaying it needs no torrent.
//
// Download and playback run side by side: onReady fires as soon as the
// first few segments exist, so the TV starts right away while ffmpeg
// keeps pulling the rest at whatever speed the torrent gives. The
// playlist is an "event" playlist -- it grows as segments land, and
// ffmpeg closes it with #EXT-X-ENDLIST when the whole film is on disk.
//
// Resolves when the whole file is saved; rejects on failure (outDir is
// left for the caller to delete).
//
// signal (an AbortSignal) cancels it: ffprobe/ffmpeg are killed and the
// promise rejects.
//
// onProgress gets { pct, savedSec, bytes }: how far into the film is on
// disk, and how many bytes that is. pct is null when the file doesn't
// say how long it is.
async function download(url, outDir, { onProbed, onReady, onProgress, signal }) {
  const info = await probe(url, signal);
  if (!info.video) throw new Error('That torrent file has no video in it.');
  onProbed({ durationSec: info.duration });

  const videoArgs = COPY_VIDEO.includes(info.video.codec_name)
    ? ['-c:v', 'copy']
    : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-vf', "scale='min(1920,iw)':-2", '-force_key_frames', `expr:gte(t,n_forced*${SEGMENT_SEC})`];
  let audioArgs = [];
  if (info.audio) {
    audioArgs = COPY_AUDIO.includes(info.audio.codec_name)
      ? ['-c:a', 'copy']
      : ['-c:a', 'aac', '-b:a', '192k', '-ac', '2'];
  }

  fs.mkdirSync(outDir, { recursive: true });
  const playlist = path.join(outDir, 'index.m3u8');
  const args = [
    '-hide_banner', '-nostats', '-loglevel', 'error', '-progress', 'pipe:1',
    ...httpInputArgs(), '-i', url,
    '-map', '0:v:0', ...(info.audio ? ['-map', '0:a:0'] : []), '-sn',
    ...videoArgs, ...audioArgs,
    '-f', 'hls', '-hls_time', String(SEGMENT_SEC), '-hls_list_size', '0',
    '-hls_playlist_type', 'event', '-hls_flags', 'independent_segments+temp_file',
    '-hls_segment_filename', path.join(outDir, 'seg%05d.ts'),
    playlist
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG_BIN, args, { signal });
    let stderr = '';
    let ready = false;
    let buffer = '';
    let savedSec = 0;
    const savedBytes = createSizeCounter(outDir);
    child.stderr.on('data', (c) => { stderr = (stderr + c).slice(-4000); });
    child.stdout.on('data', (c) => {
      buffer += c;
      const lines = buffer.split('\n');
      buffer = lines.pop();
      lines.forEach((line) => {
        // ffmpeg ends each progress block with progress=continue|end.
        const m = /^out_time_us=(\d+)/.exec(line);
        if (m) savedSec = parseInt(m[1], 10) / 1e6;
        if (!/^progress=/.test(line)) return;
        onProgress({
          pct: info.duration ? Math.min(99.9, (savedSec / info.duration) * 100) : null,
          savedSec,
          bytes: savedBytes()
        });
        if (!ready && countSegments(playlist) >= READY_SEGMENTS) {
          ready = true;
          onReady();
        }
      });
    });
    child.on('error', (err) => {
      if (err.name !== 'AbortError') reject(new Error(`Could not start ffmpeg (${FFMPEG_BIN}): ${err.message}`));
    });
    child.on('close', (code) => {
      if (signal && signal.aborted) {
        reject(new Error('Cancelled.'));
        return;
      }
      if (code !== 0) {
        const last = stderr.trim().split('\n').pop();
        reject(new Error(`Torrent download stopped${last ? ` (${last})` : ` (ffmpeg exit ${code})`}.`));
        return;
      }
      // A film shorter than the head start still has to become playable.
      if (!ready) onReady();
      resolve();
    });
  });
}

function folderBytes(dir) {
  return createSizeCounter(dir)();
}

module.exports = { parseTorrentUrl, isKey, download, folderBytes };
