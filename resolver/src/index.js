'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { JobRegistry } = require('./jobs');
const ytdlp = require('./ytdlp');
const { log } = require('./logger');

const PORT = process.env.PORT || 8788;
const MEDIA_DIR = process.env.MEDIA_DIR || path.join(__dirname, '..', 'media');
const MAX_HEIGHT = parseInt(process.env.MAX_HEIGHT || '1080', 10);
const MAX_FILESIZE = process.env.MAX_FILESIZE || '2G';
const MEDIA_TTL_MS = parseInt(process.env.MEDIA_TTL_MS || String(6 * 60 * 60 * 1000), 10); // 6h
const SWEEP_INTERVAL_MS = 15 * 60 * 1000;
const ENABLE_GENERIC_FALLBACK = process.env.ENABLE_GENERIC_FALLBACK !== '0';

fs.mkdirSync(MEDIA_DIR, { recursive: true });

const jobs = new JobRegistry();

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
    title: job.title
  };
  if (job.status === 'error') shape.error = job.error;
  if (job.status === 'ready') {
    const host = req.headers.host; // same host companion used to reach us -- reachable by the TV on the same LAN
    shape.streamUrl = `http://${host}/media/${job.fileName}`;
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
async function runJob(job, url) {
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
    jobs.update(job.id, { title: info.title, status: 'downloading' });

    const outPathNoExt = path.join(MEDIA_DIR, job.id);
    await ytdlp.download(downloadUrl, outPathNoExt, {
      maxHeight: MAX_HEIGHT,
      maxFilesize: MAX_FILESIZE,
      ...headerOpts,
      onProgress: (pct) => jobs.update(job.id, { progress: pct })
    });

    jobs.update(job.id, {
      status: 'ready',
      progress: 100,
      fileName: `${job.id}.mp4`,
      finishedAt: Date.now()
    });
    log('resolved', job.id, info.title);
  } catch (err) {
    jobs.update(job.id, { status: 'error', error: err.message, finishedAt: Date.now() });
    log('resolve failed', job.id, err.message);
  }
}

function serveMedia(req, res, fileName) {
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
        'Content-Type': 'video/mp4',
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
      'Content-Type': 'video/mp4',
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
      sendJson(res, 202, { id: job.id, status: job.status });
      runJob(job, target);
    }).catch((err) => {
      sendJson(res, 400, { error: err.message });
    });
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

  res.writeHead(404);
  res.end();
});

// Downloaded files are transient casts, not a media library -- sweep
// anything past MEDIA_TTL_MS so a home server's disk doesn't slowly fill
// with every video anyone has ever cast.
setInterval(() => {
  jobs.sweep(MEDIA_TTL_MS);
  fs.readdir(MEDIA_DIR, (err, files) => {
    if (err) return;
    const cutoff = Date.now() - MEDIA_TTL_MS;
    files.forEach((file) => {
      const filePath = path.join(MEDIA_DIR, file);
      fs.stat(filePath, (statErr, stat) => {
        if (!statErr && stat.mtimeMs < cutoff) fs.unlink(filePath, () => {});
      });
    });
  });
}, SWEEP_INTERVAL_MS);

server.listen(PORT, () => {
  log(`resolver listening on :${PORT} (POST /resolve, GET /resolve/:id, GET /media/:file, GET /healthz)`);
});
