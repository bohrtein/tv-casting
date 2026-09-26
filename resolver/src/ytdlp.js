'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const YTDLP_BIN = process.env.YTDLP_BIN || 'yt-dlp';

// No shell:true anywhere here -- args (including the user-supplied url)
// are passed straight to execve, never through a shell, so there's no
// injection surface regardless of what a pasted url contains.
function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(YTDLP_BIN, args);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (err) => {
      reject(new Error(`Could not start yt-dlp (${YTDLP_BIN}): ${err.message}`));
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(stderr.trim().split('\n').pop() || `yt-dlp exited with code ${code}`));
      }
    });
  });
}

// referer/userAgent are only ever passed when the caller already ran the
// genericExtract fallback (see index.js) and is retrying against the raw
// manifest url it found -- yt-dlp otherwise derives these itself for
// urls its own extractors recognize.
function headerArgs({ referer, userAgent } = {}) {
  const args = [];
  if (referer) args.push('--referer', referer);
  if (userAgent) args.push('--user-agent', userAgent);
  return args;
}

// Quick metadata-only probe (no download) so a bad/unsupported url fails
// fast instead of only surfacing after a job has already been created.
async function getInfo(url, opts) {
  const args = ['-j', '--no-playlist', '--no-warnings', ...headerArgs(opts), url];
  const { stdout } = await run(args);
  const firstLine = stdout.split('\n').find((l) => l.trim().startsWith('{'));
  if (!firstLine) throw new Error('yt-dlp returned no video info for that url.');
  return parseInfo(JSON.parse(firstLine), url);
}

// isLive: a stream that's on air now. Those never finish downloading,
// so index.js plays them through live.js instead of download().
function parseInfo(info, url) {
  return {
    title: info.title || url,
    duration: info.duration || null,
    thumbnail: info.thumbnail || null,
    extractor: info.extractor_key || info.extractor || '',
    categories: info.categories || [],
    isLive: info.is_live === true || info.live_status === 'is_live'
  };
}

const PROGRESS_RE = /\[download\]\s+([\d.]+)%/;

// A failed/partial download leaves yt-dlp's in-progress fragments
// (`<id>.f134.mp4.part`, etc.) sitting in MEDIA_DIR -- without this
// they'd only ever get swept up by the multi-hour TTL cleanup, which
// left stray multi-hundred-MB files around after a transient failure
// during testing.
function cleanupPartials(outPathNoExt) {
  const dir = path.dirname(outPathNoExt);
  const prefix = path.basename(outPathNoExt);
  fs.readdir(dir, (err, files) => {
    if (err) return;
    files
      .filter((f) => f.startsWith(prefix))
      .forEach((f) => fs.unlink(path.join(dir, f), () => {}));
  });
}

// Downloads (and, if the site only serves separate video/audio, muxes
// via ffmpeg) to exactly `<outPathNoExt>.mp4`. Capped at maxHeight when
// the extractor reports a height, and at maxFilesize as a
// hard stop against a runaway download filling the server's disk.
// signal (an AbortSignal) cancels it: yt-dlp is killed and its partial
// files deleted, same as a failed download.
function download(url, outPathNoExt, { maxHeight = 1080, maxFilesize = '2G', referer, userAgent, onProgress, signal } = {}) {
  // Prefer H.264 video + AAC/MP3 audio explicitly -- Tizen AVPlay's H.264
  // support is what the rest of this project was actually validated
  // against (see PLAN.md's AVPlay status log), while VP9/AV1 (yt-dlp's
  // usual "best" pick on modern YouTube) is unreliable or unsupported on
  // older Samsung TVs. Falls through to whatever's available if a site
  // doesn't offer H.264 at all.
  const h264 = `bestvideo[height<=${maxHeight}][vcodec^=avc1]+bestaudio[acodec^=mp4a]/best[height<=${maxHeight}][vcodec^=avc1]`;
  const anyCodec = `bestvideo[height<=${maxHeight}]+bestaudio/best[height<=${maxHeight}]`;
  // Generic direct-file extractors often omit height (and codec) metadata.
  // Keep known, in-range formats first, then allow unknown heights with
  // yt-dlp's `?` filter modifier. Known over-limit formats still fail.
  const unknownHeight = `bestvideo[height<=?${maxHeight}]+bestaudio/best[height<=?${maxHeight}]`;
  const format = `${h264}/${anyCodec}/${unknownHeight}`;
  const args = [
    '-f', format,
    '--merge-output-format', 'mp4',
    '--recode-video', 'mp4',
    '--no-playlist',
    '--no-warnings',
    '--newline',
    '--max-filesize', maxFilesize,
    ...headerArgs({ referer, userAgent }),
    '-o', `${outPathNoExt}.%(ext)s`,
    url
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(YTDLP_BIN, args, { signal });
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      const match = PROGRESS_RE.exec(text);
      if (match && onProgress) onProgress(parseFloat(match[1]));
    });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (err) => {
      if (err.name === 'AbortError') return; // 'close' follows and cleans up
      reject(new Error(`Could not start yt-dlp (${YTDLP_BIN}): ${err.message}`));
    });
    child.on('close', (code) => {
      if (code === 0 && !(signal && signal.aborted)) {
        if (!fs.existsSync(`${outPathNoExt}.mp4`) || !fs.statSync(`${outPathNoExt}.mp4`).size) {
          cleanupPartials(outPathNoExt);
          reject(new Error('Download did not produce an MP4 (it may exceed the file size limit).'));
          return;
        }
        resolve(`${outPathNoExt}.mp4`);
      } else {
        cleanupPartials(outPathNoExt);
        reject(new Error(stderr.trim().split('\n').pop() || `yt-dlp exited with code ${code}`));
      }
    });
  });
}

module.exports = { getInfo, parseInfo, download };
