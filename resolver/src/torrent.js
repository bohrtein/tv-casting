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
// Bigger than this (4K) is converted down to it as the film is saved, so
// the saved copy is the size the TV can play. 0 keeps every size. The
// width limit is the same 16:9 box (1920 for 1080), so a wide 3840x1600
// film becomes 1920x800.
const MAX_HEIGHT = parseInt(process.env.TORRENT_MAX_HEIGHT || '1080', 10);
const MAX_WIDTH = Math.round((MAX_HEIGHT * 16) / 9);
// libx264 speed for any conversion. Faster presets make bigger files;
// on a slow CPU a 4K conversion may still run slower than the film
// plays, and the TV then waits for it.
const X264_PRESET = process.env.TORRENT_X264_PRESET || 'superfast';
// When a film is converted down, also keep it untouched (copied, not
// re-encoded) in <film>/original/, for watching at full size elsewhere
// (VLC on a monitor). Costs the film's full size again on disk.
const KEEP_ORIGINAL = process.env.TORRENT_KEEP_ORIGINAL !== '0';
// Which h264 encoder conversions use: "nvenc" (an NVIDIA GPU's, with the
// GPU decoding too), "x264" (the CPU), or "auto" (nvenc if a quick test
// encode works on this machine, else x264).
const ENCODER = (process.env.TORRENT_ENCODER || 'auto').toLowerCase();
const ORIGINAL_DIR = 'original';
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

// Tried once, on the first conversion: a 0.2 s encode on the GPU. Needs
// the NVIDIA driver and an ffmpeg built with nvenc (Ubuntu's is).
let encoderPromise = null;
function pickEncoder() {
  if (ENCODER === 'x264') return Promise.resolve('x264');
  if (!encoderPromise) {
    encoderPromise = new Promise((resolve) => {
      const child = spawn(FFMPEG_BIN, [
        '-v', 'error', '-init_hw_device', 'cuda=gpu',
        '-f', 'lavfi', '-i', 'color=c=black:s=640x360:r=25', '-t', '0.2',
        '-c:v', 'h264_nvenc', '-f', 'null', '-'
      ]);
      let stderr = '';
      child.stderr.on('data', (c) => { stderr += c; });
      child.on('error', () => resolve({ name: 'x264', why: 'ffmpeg not startable' }));
      child.on('close', (code) => resolve(code === 0
        ? { name: 'nvenc' }
        : { name: 'x264', why: stderr.trim().split('\n').pop() || `exit ${code}` }));
    }).then((result) => {
      if (result.name === 'nvenc') {
        console.log(new Date().toISOString(), 'video conversions: NVIDIA GPU (h264_nvenc, cuda decode)');
      } else {
        console.log(new Date().toISOString(), `video conversions: CPU (libx264); no NVIDIA encoder${result.why ? ` (${result.why})` : ''}`);
      }
      return result.name;
    });
  }
  // Forced on: trust it (a failing GPU then fails the conversion loudly
  // instead of quietly using the CPU).
  if (ENCODER === 'nvenc') return Promise.resolve('nvenc');
  return encoderPromise;
}

// The h264 encode, on the GPU or the CPU. Keyframes every SEGMENT_SEC so
// segments can be cut there; on the GPU they're forced as IDR frames,
// which every segment has to start with.
function encodeArgs(encoder, box) {
  const common = [
    '-pix_fmt', 'yuv420p',
    '-vf', `scale='min(iw,${box.w})':'min(ih,${box.h})':force_original_aspect_ratio=decrease:force_divisible_by=2`,
    '-force_key_frames', `expr:gte(t,n_forced*${SEGMENT_SEC})`
  ];
  if (encoder === 'nvenc') {
    return ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-cq', '23', '-b:v', '0',
      '-maxrate', '15M', '-bufsize', '30M', '-forced-idr', '1', ...common];
  }
  return ['-c:v', 'libx264', '-preset', X264_PRESET, '-crf', '21', ...common];
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
      '-show_entries', 'format=duration:stream=index,codec_type,codec_name,width,height',
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
  const { width, height, codec_name: codec } = info.video;
  const tooBig = MAX_HEIGHT > 0 && (height > MAX_HEIGHT || width > MAX_WIDTH);
  const convert = tooBig || !COPY_VIDEO.includes(codec);
  // Only ever shrinks, keeping the shape; never scales a small film up.
  const box = MAX_HEIGHT > 0 ? { w: MAX_WIDTH, h: MAX_HEIGHT } : { w: 1920, h: 1080 };
  const keepOriginal = tooBig && KEEP_ORIGINAL;
  const converting = !convert ? null
    : tooBig ? `${width}x${height} ${codec} → ${MAX_HEIGHT}p${keepOriginal ? ', keeping the original' : ''}`
      : `${codec} → h264`;
  const encoderLabel = convert ? ((await pickEncoder()) === 'nvenc' ? ' on the GPU' : ' on the CPU') : '';
  onProbed({ durationSec: info.duration, converting: converting && converting + encoderLabel });

  const encoder = convert ? await pickEncoder() : null;
  const videoArgs = !convert ? ['-c:v', 'copy'] : encodeArgs(encoder, box);
  // GPU decoding hands frames back to the CPU for scaling (plain -hwaccel,
  // no hw output format), so the filters above work the same either way;
  // ffmpeg falls back to CPU decoding for anything the GPU can't decode.
  const decodeArgs = encoder === 'nvenc' ? ['-hwaccel', 'cuda'] : [];
  let audioArgs = [];
  if (info.audio) {
    audioArgs = COPY_AUDIO.includes(info.audio.codec_name)
      ? ['-c:a', 'copy']
      : ['-c:a', 'aac', '-b:a', '192k', '-ac', '2'];
  }

  fs.mkdirSync(outDir, { recursive: true });
  const playlist = path.join(outDir, 'index.m3u8');
  const maps = ['-map', '0:v:0', ...(info.audio ? ['-map', '0:a:0'] : []), '-sn'];
  const hlsOut = (dir) => [
    '-f', 'hls', '-hls_time', String(SEGMENT_SEC), '-hls_list_size', '0',
    '-hls_playlist_type', 'event', '-hls_flags', 'independent_segments+temp_file',
    '-hls_segment_filename', path.join(dir, 'seg%05d.ts'),
    path.join(dir, 'index.m3u8')
  ];
  // The TV's copy comes first: -progress reports on it, and its folder
  // is what the TV plays. The original, if kept, is a second output of
  // the same run, so the torrent is only read once.
  const args = [
    '-hide_banner', '-nostats', '-loglevel', 'error', '-progress', 'pipe:1',
    ...httpInputArgs(), ...decodeArgs, '-i', url,
    ...maps, ...videoArgs, ...audioArgs, ...hlsOut(outDir)
  ];
  if (keepOriginal) {
    const origDir = path.join(outDir, ORIGINAL_DIR);
    fs.mkdirSync(origDir, { recursive: true });
    args.push(...maps, '-c:v', 'copy', ...audioArgs, ...hlsOut(origDir));
  }

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

// The server's own stats for a torrent URL's torrent: ours
// (torrent-server/) or the Stremio server's, same path on both. null when
// the server doesn't answer or doesn't know the torrent (yet).
async function peerStats(url) {
  const u = new URL(url);
  try {
    const res = await fetch(`${u.origin}/${u.pathname.split('/')[1]}/stats.json`, { signal: AbortSignal.timeout(5000) });
    return res.ok ? await res.json() : null;
  } catch (e) {
    return null;
  }
}

function mbps(bytesPerSec) {
  return `${((bytesPerSec || 0) / 1e6).toFixed(2)} MB/s`;
}

// One log line out of peerStats(). Fields only one of the two servers
// has (incoming/outgoing and known peers: ours; tries and per-tracker
// finds: Stremio's) are left out when missing.
function describePeers(stats) {
  if (!stats) return 'no stats from the server';
  const parts = [];
  let connected = `${stats.peers} connected`;
  if (typeof stats.incoming === 'number') connected += ` (${stats.incoming} in, ${stats.outgoing} out)`;
  parts.push(connected);
  if (typeof stats.knownPeers === 'number') parts.push(`${stats.knownPeers} known`);
  if (typeof stats.connectionTries === 'number') parts.push(`${stats.connectionTries} tries`);
  if (Array.isArray(stats.sources) && stats.sources.length) {
    const found = stats.sources.reduce((n, src) => n + (src.numFound || 0), 0);
    parts.push(`${found} found by ${stats.sources.length} trackers`);
  }
  parts.push(stats.name ? 'metadata ok' : 'no metadata yet');
  parts.push(mbps(stats.downloadSpeed));
  if (typeof stats.forwardedPort !== 'undefined') {
    parts.push(stats.forwardedPort ? `forwarded port ${stats.forwardedPort}` : 'no forwarded port');
  }
  return parts.join(', ');
}

// Width and height of a saved film's video (from its first segment), or
// null. For films saved before their size was recorded.
function frameSize(dir) {
  return new Promise((resolve) => {
    const child = spawn(FFPROBE_BIN, [
      '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height',
      '-of', 'csv=p=0', path.join(dir, 'seg00000.ts')
    ]);
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
    child.on('error', () => resolve(null));
    child.on('close', () => {
      const [w, h] = out.trim().split(',').map((n) => parseInt(n, 10));
      resolve(w > 0 && h > 0 ? { width: w, height: h } : null);
    });
  });
}

// True when a saved film is bigger than the TV's limit and has no TV
// copy yet (saved before conversions existed, or with them off).
function needsTvCopy(dir, size) {
  if (!size || MAX_HEIGHT <= 0) return false;
  if (fs.existsSync(path.join(dir, ORIGINAL_DIR, 'index.m3u8'))) return false;
  return size.height > MAX_HEIGHT || size.width > MAX_WIDTH;
}

// "optimize for TV" on a film already saved at full size: makes the
// 1080p copy from the files on disk (no torrent), then moves the
// full-size film into original/ and the new copy where the TV plays
// from -- the same layout a download that converts ends up with. Until
// the swap at the very end, the film keeps playing as it was.
async function makeTvCopy(dir, { onProgress, signal }) {
  const playlist = path.join(dir, 'index.m3u8');
  const total = (() => {
    try {
      return (fs.readFileSync(playlist, 'utf8').match(/#EXTINF:([\d.]+)/g) || [])
        .reduce((n, m) => n + parseFloat(m.slice(8)), 0);
    } catch (e) {
      return 0;
    }
  })();
  const tmp = path.join(dir, '.tv-copy');
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  const encoder = await pickEncoder();
  const args = [
    '-hide_banner', '-nostats', '-loglevel', 'error', '-progress', 'pipe:1',
    ...(encoder === 'nvenc' ? ['-hwaccel', 'cuda'] : []),
    '-i', playlist,
    '-map', '0:v:0', '-map', '0:a:0?', '-sn',
    ...encodeArgs(encoder, { w: MAX_WIDTH, h: MAX_HEIGHT }), '-c:a', 'copy',
    '-f', 'hls', '-hls_time', String(SEGMENT_SEC), '-hls_list_size', '0',
    '-hls_playlist_type', 'vod', '-hls_flags', 'independent_segments',
    '-hls_segment_filename', path.join(tmp, 'seg%05d.ts'),
    path.join(tmp, 'index.m3u8')
  ];
  await new Promise((resolve, reject) => {
    const child = spawn(FFMPEG_BIN, args, { signal });
    let stderr = '';
    let buffer = '';
    child.stderr.on('data', (c) => { stderr = (stderr + c).slice(-4000); });
    child.stdout.on('data', (c) => {
      buffer += c;
      const lines = buffer.split('\n');
      buffer = lines.pop();
      lines.forEach((line) => {
        const m = /^out_time_us=(\d+)/.exec(line);
        if (m && total) onProgress(Math.min(99.9, (parseInt(m[1], 10) / 1e6 / total) * 100));
      });
    });
    child.on('error', (err) => {
      if (err.name !== 'AbortError') reject(new Error(`Could not start ffmpeg: ${err.message}`));
    });
    child.on('close', (code) => {
      if (signal && signal.aborted) return reject(new Error('Cancelled.'));
      if (code !== 0) return reject(new Error(stderr.trim().split('\n').pop() || `ffmpeg exit ${code}`));
      resolve();
    });
  }).catch((err) => {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw err;
  });

  // The swap: full-size files into original/, the new copy up a level.
  const orig = path.join(dir, ORIGINAL_DIR);
  fs.mkdirSync(orig, { recursive: true });
  fs.readdirSync(dir).forEach((name) => {
    if (name === 'index.m3u8' || /^seg\d+\.ts$/.test(name)) fs.renameSync(path.join(dir, name), path.join(orig, name));
  });
  fs.readdirSync(tmp).forEach((name) => fs.renameSync(path.join(tmp, name), path.join(dir, name)));
  fs.rmSync(tmp, { recursive: true, force: true });
  return encoder;
}

module.exports = {
  parseTorrentUrl, isKey, download, folderBytes, peerStats, describePeers,
  frameSize, needsTvCopy, makeTvCopy, SEGMENT_SEC, ORIGINAL_DIR
};
