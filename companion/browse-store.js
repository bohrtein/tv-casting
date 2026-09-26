'use strict';

// Shared cache of finished Board, Discover and Search results, so every
// device on the LAN reuses what one of them already fetched from the addons.
// Kept in memory and mirrored to a JSON file so it survives a restart.
// The page builds the keys; they include the addon set, so changing addons
// never serves results from an old setup.
const fs = require('fs');
const path = require('path');

const MAX_AGE = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 300;
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const MAX_KEY_LENGTH = 16 * 1024;
const SAVE_DELAY = 1000;

function createBrowseStore(file, now) {
  now = now || Date.now;
  // Map order is age order: the oldest entry is first and goes first.
  const entries = new Map();
  let bytes = 0;
  let saveTimer = null;

  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(saved)) saved.forEach((item) => {
      if (item && typeof item.key === 'string' && typeof item.time === 'number' && item.data !== undefined) {
        set(item.key, item.time, item.data);
      }
    });
    prune();
  } catch (e) {
    // Nothing saved yet, or a corrupt file: start empty.
  }

  function set(key, time, data) {
    drop(key);
    const size = key.length + JSON.stringify(data).length;
    entries.set(key, { time, data, size });
    bytes += size;
  }
  function drop(key) {
    const item = entries.get(key);
    if (!item) return;
    bytes -= item.size;
    entries.delete(key);
  }
  function prune() {
    for (const [key, item] of entries) if (now() - item.time >= MAX_AGE || item.time > now()) drop(key);
    while (entries.size > MAX_ENTRIES || bytes > MAX_BYTES) drop(entries.keys().next().value);
  }
  function save() {
    if (!file || saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      const list = [...entries].map(([key, item]) => ({ key, time: item.time, data: item.data }));
      // Write-then-rename so a crash mid-write can't leave half a file.
      const tmp = file + '.tmp';
      fs.mkdir(path.dirname(file), { recursive: true }, (mkErr) => {
        if (mkErr) return;
        fs.writeFile(tmp, JSON.stringify(list), (wErr) => {
          if (!wErr) fs.rename(tmp, file, () => {});
        });
      });
    }, SAVE_DELAY);
    if (saveTimer.unref) saveTimer.unref();
  }

  function get(key) {
    const item = entries.get(key);
    if (!item) return null;
    if (now() - item.time >= MAX_AGE) { drop(key); save(); return null; }
    return { data: item.data, time: item.time };
  }
  function put(key, data) {
    set(key, now(), data);
    prune();
    save();
  }

  function sendJson(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  }

  // POST { action: 'get', key } -> { data, time } (data null on a miss);
  // POST { action: 'put', key, data } -> { ok: true }.
  function handle(req, res) {
    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'POST' });
      res.end();
      return;
    }
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        sendJson(res, 413, { error: 'too large' });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (size > MAX_BODY_BYTES) return;
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) {
        sendJson(res, 400, { error: 'body must be JSON' });
        return;
      }
      if (!body || typeof body.key !== 'string' || !body.key || body.key.length > MAX_KEY_LENGTH) {
        sendJson(res, 400, { error: 'key must be a string' });
        return;
      }
      if (body.action === 'get') {
        sendJson(res, 200, get(body.key) || { data: null });
      } else if (body.action === 'put' && body.data !== undefined && body.data !== null) {
        put(body.key, body.data);
        sendJson(res, 200, { ok: true });
      } else {
        sendJson(res, 400, { error: 'action must be get or put' });
      }
    });
  }

  return { get, put, handle };
}

module.exports = createBrowseStore;
