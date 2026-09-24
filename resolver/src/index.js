'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { JobRegistry } = require('./jobs');
const { MediaCache } = require('./cache');
const ytdlp = require('./ytdlp');
const torrent = require('./torrent');
const { createThumbs } = require('./thumbs');
const { fullLengthPlaylist } = require('./hls');
const { log } = require('./logger');

const PORT = process.env.PORT || 8788;
const MEDIA_DIR = process.env.MEDIA_DIR || path.join(__dirname, '..', 'media');
const MAX_HEIGHT = parseInt(process.env.MAX_HEIGHT || '1080', 10);
const MAX_FILESIZE = process.env.MAX_FILESIZE || '2G';
const MEDIA_TTL_MS = parseInt(process.env.MEDIA_TTL_MS || String(6 * 60 * 60 * 1000), 10); // 6h
const SWEEP_INTERVAL_MS = 15 * 60 * 1000;
const ENABLE_GENERIC_FALLBACK = process.env.ENABLE_GENERIC_FALLBACK !== '0';
// Both caches are big on purpose: films and videos stay until deleted by
// hand from the companion's "saved" tab; these only cap a runaway disk.
const CACHE_MAX_ENTRIES = parseInt(process.env.RESOLVER_CACHE_SIZE || '100', 10);
// Films are big, so torrents get their own, smaller cache.
const TORRENT_CACHE_SIZE = parseInt(process.env.TORRENT_CACHE_SIZE || '100', 10);
const TORRENT_DIR = path.join(MEDIA_DIR, 'torrents');
// Where torrent files are read from. The companion builds Stremio server
// URLs; when this is set, the same path goes to our own torrent server
// instead (torrent-server/, which takes incoming peers through the VPN).
const TORRENT_SERVER_URL = (process.env.TORRENT_SERVER_URL || '').replace(/\/+$/, '');

fs.mkdirSync(TORRENT_DIR, { recursive: true });

const jobs = new JobRegistry();
const mediaCache = new MediaCache(MEDIA_DIR, CACHE_MAX_ENTRIES);
// Keyed by "<infoHash>-<fileIdx>"; fileName is that key's folder.
const torrentCache = new MediaCache(TORRENT_DIR, TORRENT_CACHE_SIZE);
const activeTorrents = new Map(); // key -> job, while ffmpeg is running
const thumbs = createThumbs({
  mediaDir: MEDIA_DIR,
  torrentDir: TORRENT_DIR,
  isTorrentComplete: (key) => torrentCache.has(key)
});

// A folder that isn't in the cache index is a download that never
// finished (resolver stopped mid-film). Nothing is running at startup,
// so those are safe to clear.
fs.readdirSync(TORRENT_DIR).forEach((name) => {
  if (torrent.isKey(name) && !torrentCache.has(name)) {
    fs.rmSync(path.join(TORRENT_DIR, name), { recursive: true, force: true });
    log('removed unfinished torrent download', name);
  }
});

// Only names the caches themselves hand out: a job id's MP4, or a
// torrent key. Keeps /thumb and delete away from any other path.
function validCacheName(kind, name) {
  return kind === 'media' ? /^[0-9a-f]{16}\.mp4$/.test(name) : torrent.isKey(name);
}

function fileBytes(file) {
  try {
    return fs.statSync(file).size;
  } catch (e) {
    return 0;
  }
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) });
  res.end(data);
}

function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('Body too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (e) {
        reject(new Error('Malformed JSON body.'));
      }
    });
    req.on('error', reject);
  });
}

function isHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

function jobPublicShape(job, req) {
  const shape = {
    id: job.id,
    status: job.status,
    progress: job.progress,
    title: job.title,
    sourceUrl: job.sourceUrl,
    fromCache: !!job.fromCache,
    // Torrents turn "ready" while still downloading; this says when the
    // whole file is on disk.
    complete: job.complete !== false,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt
  };
  if (job.torrentKey) {
    // Only torrent jobs carry these: the save-progress bar on the
    // companion's Stremio page reads them.
    Object.assign(shape, {
      kind: 'torrent',
      torrentKey: job.torrentKey,
      phase: job.phase,
      savedSec: job.savedSec,
      durationSec: job.durationSec,
      bytes: job.bytes,
      bytesPerSec: job.bytesPerSec,
      converting: job.converting || null
    });
  }
  if (job.status === 'error') shape.error = job.error;
  if (job.status === 'ready') {
    const host = req.headers.host; // same host companion used to reach us -- reachable by the TV on the same LAN
    shape.streamUrl = job.torrentKey
      ? `http://${host}/media/torrents/${job.torrentKey}/index.m3u8`
      : `http://${host}/media/${job.fileName}`;
  }
  return shape;
}

// Second-tier fallback for pages yt-dlp's native + generic (static-HTML)
// extractors can't read because the player builds its <video>/manifest
// url client-side via JS. Renders the page in real headless Chromium
// (see genericExtract.js -- no anti-bot evasion, just execution) and, if
// that finds a stream, hands the raw manifest/file url + the page's own
// referer/user-agent back so yt-dlp can download it the normal way.
// Lazily required so a deployment that hasn't run
// `npx playwright install chromium` only loses this one fallback tier,
// not the whole resolver -- the original yt-dlp error still surfaces.
async function tryGenericFallback(url, nativeErr) {
  if (!ENABLE_GENERIC_FALLBACK) return null;
  if (require('./denylist').isDenied(url)) {
    log('rendered-page fallback declined (denylisted domain):', url);
    return null;
  }
  let genericExtract;
  try {
    ({ extract: genericExtract } = require('./genericExtract'));
  } catch (e) {
    log('generic fallback unavailable (playwright not installed?):', e.message);
    return null;
  }
  log('native yt-dlp extraction failed, trying rendered-page fallback:', nativeErr.message);
  try {
    const found = await genericExtract(url);
    if (found) log('rendered-page fallback found a stream url for', url);
    return found;
  } catch (e) {
    log('rendered-page fallback failed:', e.message);
    return null;
  }
}

// Kicks the whole resolve+download pipeline off in the background; the
// HTTP handler only waits long enough to hand back a job id, since a
// real download can take anywhere from a few seconds to a few minutes.
// Cancelling (POST /resolve/:id/cancel) aborts job.controller, which
// kills whatever yt-dlp/ffmpeg the job is running.
function finishCancelled(job) {
  jobs.update(job.id, { status: 'cancelled', error: 'Cancelled.', complete: true, bytesPerSec: 0, finishedAt: Date.now() });
  log('cancelled', job.id, job.title || job.sourceUrl);
}

async function runJob(job, url) {
  job.controller = new AbortController();
  const { signal } = job.controller;
  try {
    let downloadUrl = url;
    let headerOpts = {};
    let info;
    try {
      info = await ytdlp.getInfo(url);
    } catch (nativeErr) {
      const fallback = await tryGenericFallback(url, nativeErr);
      if (!fallback) throw nativeErr;
      downloadUrl = fallback.streamUrl;
      headerOpts = { referer: fallback.referer, userAgent: fallback.userAgent };
      info = await ytdlp.getInfo(downloadUrl, headerOpts);
    }
    if (signal.aborted) throw new Error('Cancelled.');
    jobs.update(job.id, { title: info.title, status: 'downloading' });

    const outPathNoExt = path.join(MEDIA_DIR, job.id);
    await ytdlp.download(downloadUrl, outPathNoExt, {
      maxHeight: MAX_HEIGHT,
      maxFilesize: MAX_FILESIZE,
      ...headerOpts,
      signal,
      onProgress: (pct) => jobs.update(job.id, { progress: pct })
    });

    const fileName = `${job.id}.mp4`;
    jobs.update(job.id, {
      status: 'ready',
      progress: 100,
      fileName,
      finishedAt: Date.now()
    });
    log('resolved', job.id, info.title);

    // Register with the LRU cache so recasting this same source url
    // later is instant instead of re-downloading. Only ever the 5 (by
    // default) most recently *used* distinct sources survive -- delete
    // whichever file(s) that bumps out.
    const evicted = mediaCache.add({ sourceUrl: job.sourceUrl, fileName, title: info.title });
    evicted.forEach((e) => {
      fs.unlink(path.join(MEDIA_DIR, e.fileName), () => {});
      thumbs.remove('media', e.fileName);
      log('cache evicted (LRU cap)', e.fileName, e.title);
    });
  } catch (err) {
    if (signal.aborted) {
      finishCancelled(job);
      return;
    }
    jobs.update(job.id, { status: 'error', error: err.message, finishedAt: Date.now() });
    log('resolve failed', job.id, err.message);
  }
}

function torrentSource(target) {
  if (!TORRENT_SERVER_URL) return target;
  const u = new URL(target);
  return TORRENT_SERVER_URL + u.pathname + u.search;
}

// Download and playback side by side: the job goes "ready" once the
// first segments are saved, so the TV starts playing, and ffmpeg keeps
// downloading into the same folder while it watches.
async function runTorrentJob(job, url, key) {
  const outDir = path.join(TORRENT_DIR, key);
  job.controller = new AbortController();
  const { signal } = job.controller;
  activeTorrents.set(key, job);
  jobs.update(job.id, { status: 'downloading', phase: 'connecting', torrentKey: key, complete: false, bytes: 0 });
  // Speed over roughly the last 5 seconds, so one burst of pieces doesn't
  // make the number jump around.
  const samples = [];
  // Peer report in the log: every 10 s while it's still looking for
  // peers, every 30 s once it's saving.
  let phase = 'connecting';
  let ticks = 0;
  log('torrent start', key, job.title, 'from', new URL(url).origin);
  const peerTimer = setInterval(async () => {
    ticks++;
    if (phase !== 'connecting' && ticks % 3 !== 0) return;
    const stats = await torrent.peerStats(url);
    if (activeTorrents.get(key) !== job) return;
    log(`torrent peers [${phase}]`, key, torrent.describePeers(stats));
  }, 10000);
  try {
    await torrent.download(url, outDir, {
      signal,
      onProbed: ({ durationSec, converting }) => {
        phase = 'saving';
        jobs.update(job.id, { phase: 'saving', durationSec, converting });
        if (converting) log('torrent converting', key, converting);
      },
      onReady: () => {
        jobs.update(job.id, { status: 'ready' });
        log('torrent playable, still downloading', key, job.title);
      },
      onProgress: ({ pct, savedSec, bytes }) => {
        const now = Date.now();
        samples.push({ t: now, bytes });
        while (samples.length > 2 && now - samples[0].t > 5000) samples.shift();
        const span = (now - samples[0].t) / 1000;
        jobs.update(job.id, {
          progress: pct,
          savedSec,
          bytes,
          bytesPerSec: span > 0 ? (bytes - samples[0].bytes) / span : 0
        });
      }
    });
    jobs.update(job.id, {
      progress: 100,
      phase: 'done',
      bytes: torrent.folderBytes(outDir),
      bytesPerSec: 0,
      complete: true,
      finishedAt: Date.now()
    });
    log('torrent fully saved', key, job.title);
    const evicted = torrentCache.add({ sourceUrl: key, fileName: key, title: job.title });
    evicted.forEach((e) => {
      fs.rm(path.join(TORRENT_DIR, e.fileName), { recursive: true, force: true }, () => {});
      thumbs.remove('torrents', e.fileName);
      log('torrent cache evicted (LRU cap)', e.fileName, e.title);
    });
  } catch (err) {
    fs.rm(outDir, { recursive: true, force: true }, () => {});
    if (signal.aborted) {
      finishCancelled(job);
      return;
    }
    jobs.update(job.id, { status: 'error', error: err.message, complete: true, finishedAt: Date.now() });
    log('torrent failed', key, err.message);
  } finally {
    clearInterval(peerTimer);
    activeTorrents.delete(key);
  }
}

// A film still saving is served as a playlist for the whole film
// (hls.js): the TV's player treats a growing one as live TV and starts
// wherever the download has got to. A finished one is served as ffmpeg
// wrote it, with an EXT-X-START so any player begins at the start.
function servePlaylist(res, filePath, key) {
  fs.readFile(filePath, 'utf8', (err, text) => {
    if (err) {
      res.writeHead(404);
      res.end();
      return;
    }
    const job = activeTorrents.get(key);
    const body = job && job.durationSec && !/#EXT-X-ENDLIST/.test(text)
      ? fullLengthPlaylist(text, job.durationSec, torrent.SEGMENT_SEC)
      : text.replace(/^#EXTM3U\n/, '#EXTM3U\n#EXT-X-START:TIME-OFFSET=0\n');
    res.writeHead(200, {
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store'
    });
    res.end(body);
  });
}

// A segment that doesn't exist. For a finished film that's one of the
// spare placeholders at the end of a full-length playlist (hls.js lists a
// few more than ffmpeg ends up writing): answer it empty, so the TV reads
// it as the end of the film rather than an error. Otherwise a real 404.
function serveMissingSegment(res, key) {
  if (torrentCache.has(key)) {
    res.writeHead(200, { 'Content-Type': 'video/mp2t', 'Content-Length': 0 });
    res.end();
    return;
  }
  res.writeHead(404);
  res.end();
}

// How long a request for a segment that isn't saved yet waits for it.
// The TV asks a few segments ahead, so this is how far the download may
// fall behind playback before the TV gives up on that request.
const SEGMENT_WAIT_MS = parseInt(process.env.SEGMENT_WAIT_MS || '120000', 10);

// Resolves true once file exists, false if the download for key stops
// (finished without it, failed or cancelled) or SEGMENT_WAIT_MS passes.
// ffmpeg writes each segment under a temporary name and renames it when
// it's complete (temp_file), so existing means complete.
function waitForSegment(file, key) {
  const until = Date.now() + SEGMENT_WAIT_MS;
  return new Promise((resolve) => {
    (function check() {
      if (fs.existsSync(file)) return resolve(true);
      if (!activeTorrents.has(key) || Date.now() >= until) return resolve(fs.existsSync(file));
      setTimeout(check, 500);
    })();
  });
}

function serveMedia(req, res, fileName, contentType = 'video/mp4') {
  const filePath = path.join(MEDIA_DIR, fileName);
  fs.stat(filePath, (err, stat) => {
    if (err) {
      res.writeHead(404);
      res.end();
      return;
    }

    const range = req.headers.range;
    if (!range) {
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': stat.size,
        'Accept-Ranges': 'bytes'
      });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    // AVPlay (and most HTTP video players) issue Range requests for
    // seeking, so a plain non-range response would break scrubbing.
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    let start = match && match[1] ? parseInt(match[1], 10) : 0;
    let end = match && match[2] ? parseInt(match[2], 10) : stat.size - 1;
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= stat.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      res.end();
      return;
    }
    res.writeHead(206, {
      'Content-Type': contentType,
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Content-Length': end - start + 1,
      'Accept-Ranges': 'bytes'
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  // The companion is served from a different origin/port (:8080) than
  // this resolver (:8788), so every request here is cross-origin --
  // without these headers the browser silently blocks the response
  // before app.js ever sees it (curl/sdb-side testing never hits this,
  // since only browsers enforce CORS, which is exactly why this got
  // missed during initial testing). No auth/cookies involved (LAN-only,
  // no secrets in these responses), so a wildcard origin is fine here.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, 'http://internal');

  if (req.method === 'GET' && url.pathname === '/healthz') {
    sendJson(res, 200, { status: 'ok', jobs: jobs.jobs.size });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/resolve') {
    readJsonBody(req, 8 * 1024).then((body) => {
      const target = typeof body.url === 'string' ? body.url.trim() : '';
      if (!isHttpUrl(target)) {
        sendJson(res, 400, { error: 'Body must be { "url": "https://..." }.' });
        return;
      }
      const job = jobs.create();
      job.sourceUrl = target;

      const cached = mediaCache.find(target);
      if (cached) {
        jobs.update(job.id, {
          status: 'ready',
          progress: 100,
          title: cached.title,
          fileName: cached.fileName,
          fromCache: true,
          finishedAt: Date.now()
        });
        log('resolved from cache', job.id, cached.title);
        sendJson(res, 202, { id: job.id, status: job.status });
        return;
      }

      sendJson(res, 202, { id: job.id, status: job.status });
      runJob(job, target);
    }).catch((err) => {
      sendJson(res, 400, { error: err.message });
    });
    return;
  }

  // Torrents: body { url, title }, url being a Stremio server torrent URL
  // (<server>/<infoHash>/<fileIdx>). Same job shape as /resolve.
  if (req.method === 'POST' && url.pathname === '/torrent') {
    readJsonBody(req, 32 * 1024).then((body) => {
      const target = typeof body.url === 'string' ? body.url.trim() : '';
      const parsed = torrent.parseTorrentUrl(target);
      if (!parsed) {
        sendJson(res, 400, { error: 'Body must be { "url": "<stremio server>/<infoHash>/<fileIdx>" }.' });
        return;
      }
      const title = typeof body.title === 'string' && body.title ? body.title.slice(0, 300) : parsed.key;

      // Already downloading (e.g. cast again, or from another phone):
      // hand back the same job instead of downloading it twice.
      const running = activeTorrents.get(parsed.key);
      if (running) {
        sendJson(res, 202, { id: running.id, status: running.status });
        return;
      }

      const job = jobs.create();
      job.sourceUrl = target;
      job.title = title;

      const cached = torrentCache.find(parsed.key);
      if (cached) {
        jobs.update(job.id, {
          status: 'ready',
          progress: 100,
          title: cached.title,
          torrentKey: parsed.key,
          phase: 'done',
          bytes: torrent.folderBytes(path.join(TORRENT_DIR, parsed.key)),
          fromCache: true,
          finishedAt: Date.now()
        });
        log('torrent from cache', parsed.key, cached.title);
        sendJson(res, 202, { id: job.id, status: job.status });
        return;
      }

      sendJson(res, 202, { id: job.id, status: job.status });
      runTorrentJob(job, torrentSource(target), parsed.key);
    }).catch((err) => {
      sendJson(res, 400, { error: err.message });
    });
    return;
  }

  // Lets ANY companion see what's resolving/downloading right now (or
  // recently finished/errored), not just the device that started it --
  // a resolve job already runs independently of the browser tab that
  // triggered it, this just makes that state discoverable from
  // elsewhere. Same trust model as the rest of this LAN-only, no-auth
  // app (root README.md decision #4) -- nothing here is per-device or
  // per-user scoped.
  if (req.method === 'GET' && url.pathname === '/jobs') {
    const list = Array.from(jobs.jobs.values())
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .map((job) => jobPublicShape(job, req));
    sendJson(res, 200, { jobs: list });
    return;
  }

  // Lets the companion offer "previously downloaded" as a section
  // separate from /jobs' activity log -- these are specifically the
  // still-on-disk, re-castable-without-a-redownload entries the LRU
  // cache is tracking (mediaCache's max entries, 5 by default), not
  // every job that's ever run.
  // Everything saved: videos from links ("entries") and films from
  // torrents ("torrents"), most recently used first, each with a
  // thumbnail URL and its size on disk.
  if (req.method === 'GET' && url.pathname === '/cache') {
    const host = req.headers.host;
    const list = mediaCache.list().map((entry) => ({
      kind: 'media',
      key: entry.fileName,
      sourceUrl: entry.sourceUrl,
      title: entry.title,
      streamUrl: `http://${host}/media/${entry.fileName}`,
      thumbUrl: `http://${host}/thumb/media/${entry.fileName}.jpg`,
      bytes: fileBytes(path.join(MEDIA_DIR, entry.fileName)),
      createdAt: entry.createdAt,
      lastUsedAt: entry.lastUsedAt
    }));
    const torrents = torrentCache.list().map((entry) => ({
      kind: 'torrents',
      key: entry.fileName,
      title: entry.title,
      streamUrl: `http://${host}/media/torrents/${entry.fileName}/index.m3u8`,
      thumbUrl: `http://${host}/thumb/torrents/${entry.fileName}.jpg`,
      bytes: torrent.folderBytes(path.join(TORRENT_DIR, entry.fileName)),
      createdAt: entry.createdAt,
      lastUsedAt: entry.lastUsedAt
    }));
    sendJson(res, 200, { entries: list, torrents });
    return;
  }

  // A frame from 10% into a saved video or film (thumbs.js), made on
  // first request. Also works for a film that's still saving.
  const thumbMatch = /^\/thumb\/(media|torrents)\/([^/]+)\.jpg$/.exec(url.pathname);
  if (req.method === 'GET' && thumbMatch) {
    const [, kind, name] = thumbMatch;
    if (!validCacheName(kind, name)) {
      res.writeHead(404);
      res.end();
      return;
    }
    thumbs.get(kind, name).then((file) => {
      fs.readFile(file, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end();
          return;
        }
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': data.length, 'Cache-Control': 'max-age=300' });
        res.end(data);
      });
    }, () => {
      res.writeHead(404);
      res.end();
    });
    return;
  }

  // Deletes a saved video or film, files and thumbnail included. A film
  // that's still downloading has to be cancelled instead.
  const deleteMatch = /^\/cache\/(media|torrents)\/([^/]+)\/delete$/.exec(url.pathname);
  if (req.method === 'POST' && deleteMatch) {
    const [, kind, name] = deleteMatch;
    if (!validCacheName(kind, name)) {
      sendJson(res, 404, { error: 'Not in the cache.' });
      return;
    }
    if (kind === 'torrents' && activeTorrents.has(name)) {
      sendJson(res, 409, { error: 'Still downloading: cancel it from the downloads list first.' });
      return;
    }
    const cache = kind === 'media' ? mediaCache : torrentCache;
    const entry = cache.remove(name);
    if (!entry) {
      sendJson(res, 404, { error: 'Not in the cache (already deleted?).' });
      return;
    }
    const target = kind === 'media' ? path.join(MEDIA_DIR, name) : path.join(TORRENT_DIR, name);
    fs.rm(target, { recursive: true, force: true }, () => {});
    thumbs.remove(kind, name);
    log('deleted from cache', kind, name, entry.title);
    sendJson(res, 200, { deleted: name });
    return;
  }

  // Stops a download that's still running and deletes what it saved so
  // far. A torrent the TV is playing stops playing too.
  const cancelMatch = /^\/resolve\/([0-9a-f]{16})\/cancel$/.exec(url.pathname);
  if (req.method === 'POST' && cancelMatch) {
    const job = jobs.get(cancelMatch[1]);
    if (!job) {
      sendJson(res, 404, { error: 'Unknown job id (resolver may have restarted).' });
      return;
    }
    const running = job.controller && !job.controller.signal.aborted &&
      (job.status === 'starting' || job.status === 'downloading' || (job.torrentKey && job.complete === false));
    if (!running) {
      sendJson(res, 409, { error: 'That download already finished.' });
      return;
    }
    job.controller.abort();
    sendJson(res, 202, jobPublicShape(job, req));
    return;
  }

  const jobMatch = /^\/resolve\/([0-9a-f]{16})$/.exec(url.pathname);
  if (req.method === 'GET' && jobMatch) {
    const job = jobs.get(jobMatch[1]);
    if (!job) {
      sendJson(res, 404, { error: 'Unknown job id (resolver may have restarted).' });
      return;
    }
    sendJson(res, 200, jobPublicShape(job, req));
    return;
  }

  const mediaMatch = /^\/media\/([0-9a-f]{16}\.mp4)$/.exec(url.pathname);
  if (req.method === 'GET' && mediaMatch) {
    serveMedia(req, res, mediaMatch[1]);
    return;
  }

  const torrentMatch = /^\/media\/torrents\/([0-9a-f]{40}-(?:-1|\d+))\/(index\.m3u8|seg\d{5}\.ts)$/.exec(url.pathname);
  if (req.method === 'GET' && torrentMatch) {
    const [, key, name] = torrentMatch;
    const rel = path.join('torrents', key, name);
    if (name === 'index.m3u8') {
      servePlaylist(res, path.join(MEDIA_DIR, rel), key);
      return;
    }
    const file = path.join(MEDIA_DIR, rel);
    if (fs.existsSync(file)) {
      serveMedia(req, res, rel, 'video/mp2t');
      return;
    }
    if (!activeTorrents.has(key)) {
      serveMissingSegment(res, key);
      return;
    }
    let gone = false;
    res.on('close', () => { gone = true; });
    waitForSegment(file, key).then((ready) => {
      if (gone) return;
      if (ready) serveMedia(req, res, rel, 'video/mp2t');
      else serveMissingSegment(res, key);
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

// Sweeps orphaned in-progress/error leftovers past MEDIA_TTL_MS so a
// home server's disk doesn't slowly fill up. Files the LRU cache is
// tracking are exempt -- their lifecycle is "one of the last
// CACHE_MAX_ENTRIES distinct sources cast," not a time limit, so a
// video you cast once and rewatch a week later is still there.
setInterval(() => {
  jobs.sweep(MEDIA_TTL_MS);
  fs.readdir(MEDIA_DIR, (err, files) => {
    if (err) return;
    const cutoff = Date.now() - MEDIA_TTL_MS;
    files.forEach((file) => {
      if (file === 'cache-index.json' || file === 'torrents' || file === 'thumbs' || mediaCache.has(file)) return;
      const filePath = path.join(MEDIA_DIR, file);
      fs.stat(filePath, (statErr, stat) => {
        if (!statErr && stat.mtimeMs < cutoff) fs.unlink(filePath, () => {});
      });
    });
  });
}, SWEEP_INTERVAL_MS);

server.listen(PORT, () => {
  log(`resolver listening on :${PORT} (POST /resolve, POST /torrent, GET /resolve/:id, GET /jobs, GET /cache, GET /thumb/:kind/:name.jpg, POST /cache/:kind/:name/delete, GET /media/:file, GET /healthz)`);
});
