'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const YTDLP_BIN = process.env.YTDLP_BIN || 'yt-dlp';
const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';
// Short segments so the TV starts a few seconds after the cast, and a
// rolling window of them so a stream left running for hours doesn't
// fill the disk: older segments are deleted as new ones land.
const SEGMENT_SEC = 4;
const WINDOW_SEGMENTS = 15;
const READY_SEGMENTS = 2;

// Live streams come as one muxed HLS format (YouTube's always do), so a
// single "best" is preferred: merging separate video/audio to a pipe
// works but is fragile. H.264 first, for the same reason as ytdlp.js.
function liveFormat(maxHeight) {
  return [
    `best[height<=${maxHeight}][vcodec^=avc1]`,
    `best[height<=?${maxHeight}]`,
    `bv*[height<=?${maxHeight}]+ba`,
    'b'
  ].join('/');
}

function ytdlpArgs(url, { maxHeight = 1080, referer, userAgent } = {}) {
  const args = ['-f', liveFormat(maxHeight), '--no-playlist', '--no-warnings', '--quiet', '--no-part'];
  if (referer) args.push('--referer', referer);
  if (userAgent) args.push('--user-agent', userAgent);
  args.push('-o', '-', url);
  return args;
}

// Video is copied as is (live streams are H.264 in practice); audio is
// re-encoded to AAC, which is cheap and covers the odd Opus stream.
// No playlist type: a plain rolling playlist is what players treat as
// live, so the TV starts at the live edge, not at the oldest segment.
function ffmpegArgs(outDir) {
  return [
    '-hide_banner', '-nostats', '-loglevel', 'error', '-progress', 'pipe:1',
    '-i', 'pipe:0',
    '-map', '0:v:0?', '-map', '0:a:0?', '-sn',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-ac', '2',
    '-f', 'hls', '-hls_time', String(SEGMENT_SEC), '-hls_list_size', String(WINDOW_SEGMENTS),
    '-hls_flags', 'delete_segments+independent_segments+temp_file',
    '-hls_segment_filename', path.join(outDir, 'seg%05d.ts'),
    path.join(outDir, 'index.m3u8')
  ];
}

function segmentCount(dir) {
  try {
    return fs.readdirSync(dir).filter((n) => /^seg\d+\.ts$/.test(n)).length;
  } catch (e) {
    return 0;
  }
}

// Pipes a live stream through yt-dlp into ffmpeg, which writes it into
// outDir as a rolling HLS playlist the TV plays while it's being made.
// yt-dlp alone would try to save the whole stream to one file and never
// finish, so the cast would never start.
//
// onReady fires once the first segments exist. Resolves when the stream
// ends (ffmpeg closes the playlist with #EXT-X-ENDLIST); rejects if
// yt-dlp or ffmpeg fails. signal (an AbortSignal) kills both.
// yt-dlp downloads a live stream with its own ffmpeg, so stopping it
// has to stop that child too: otherwise it keeps pulling the stream (and
// holds the pipe open, so this never finishes). yt-dlp runs in its own
// process group on Linux for this; Windows has taskkill /T.
function killTree(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']).on('error', () => child.kill());
    return;
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch (e) {
    child.kill();
  }
}

function start(url, outDir, { maxHeight, referer, userAgent, signal, onReady, onProgress } = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(new Error('Cancelled.'));
    const yt = spawn(YTDLP_BIN, ytdlpArgs(url, { maxHeight, referer, userAgent }), {
      detached: process.platform !== 'win32'
    });
    const ff = spawn(FFMPEG_BIN, ffmpegArgs(outDir));
    let ytStderr = '';
    let ffStderr = '';
    let ytCode;
    let ffCode;
    let exited = 0;
    let ready = false;
    let buffer = '';
    let settled = false;
    const stopAll = () => {
      killTree(yt);
      yt.stdout.destroy();
      if (ff.exitCode === null) ff.kill();
    };
    const fail = (err) => {
      if (settled) return;
      settled = true;
      stopAll();
      reject(err);
    };
    const onAbort = () => stopAll();
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    yt.stdout.pipe(ff.stdin);
    // ffmpeg quitting first closes the pipe under yt-dlp: that's reported
    // through ffmpeg's own exit, not as a stray EPIPE.
    ff.stdin.on('error', () => {});
    yt.stderr.on('data', (c) => { ytStderr = (ytStderr + c).slice(-4000); });
    ff.stderr.on('data', (c) => { ffStderr = (ffStderr + c).slice(-4000); });
    [yt, ff].forEach((child, i) => child.on('error', (err) => {
      fail(new Error(`Could not start ${i ? 'ffmpeg' : 'yt-dlp'} (${i ? FFMPEG_BIN : YTDLP_BIN}): ${err.message}`));
    }));

    // Decided once both have exited: ffmpeg exits cleanly on end of
    // input, whether the stream ended or yt-dlp died, so yt-dlp's exit
    // code tells those apart. 'exit', not 'close', for yt-dlp: its
    // pipes can outlive it (see killTree).
    const onExited = () => {
      if (++exited < 2) return;
      if (signal) signal.removeEventListener('abort', onAbort);
      if (signal && signal.aborted) return fail(new Error('Cancelled.'));
      if (ffCode === 0 && !ytCode) {
        if (settled) return;
        settled = true;
        resolve();
        return;
      }
      const msg = (ytCode ? ytStderr : ffStderr).trim().split('\n').pop();
      fail(new Error(msg || (ytCode ? `yt-dlp exited with code ${ytCode}` : `ffmpeg exited with code ${ffCode}`)));
    };
    yt.on('exit', (code) => { ytCode = code; onExited(); });
    // ffmpeg failing leaves yt-dlp blocked on a full pipe: stop it too.
    ff.on('close', (code) => { ffCode = code; if (code !== 0) killTree(yt); onExited(); });

    ff.stdout.on('data', (c) => {
      buffer += c;
      const lines = buffer.split('\n');
      buffer = lines.pop();
      lines.forEach((line) => {
        const m = /^out_time_us=(\d+)/.exec(line);
        if (m && onProgress) onProgress({ streamedSec: parseInt(m[1], 10) / 1e6 });
        if (!ready && /^progress=/.test(line) && segmentCount(outDir) >= READY_SEGMENTS) {
          ready = true;
          if (onReady) onReady();
        }
      });
    });
  });
}

module.exports = { start, liveFormat, ytdlpArgs, ffmpegArgs, SEGMENT_SEC };
