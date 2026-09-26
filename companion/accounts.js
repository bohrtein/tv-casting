'use strict';

// Accounts for people you let in through the guest door (guest-gateway.js).
// You, on the home network or your own Tailscale address, never log in;
// these are only for others. Each account has a password (scrypt, never
// stored as is), login sessions, its own library and its own watch
// progress. The files themselves are shared on the resolver: a library
// here is only a list of which saved files this person added.
//
// Everything lives in one small JSON file in DATA_DIR, written whole and
// renamed into place so a crash can't leave half a file. Two processes use
// it (the app you open, where you manage accounts, and the always-on guest
// door), so each reads it again whenever the other has written it.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 8;
const NAME = /^[a-z0-9][a-z0-9_.-]{1,31}$/;
const MIN_PASSWORD = 8;
// A saved file on the resolver: a link's video or a torrent's folder.
const ITEM = /^(media:[0-9a-f]{16}\.mp4|torrents:[0-9a-f]{40}-(?:-1|\d+))$/;

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}
function digest(token) { return crypto.createHash('sha256').update(String(token)).digest('hex'); }

function createAccounts(file, { now = Date.now } = {}) {
  let data = { users: {}, sessions: {} };
  let seen = null; // the file's modification time when last read or written
  const failures = new Map(); // "ip|name" -> [times]

  function stamp() { try { return fs.statSync(file).mtimeMs; } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
  function load() {
    const now = stamp();
    if (now === seen) return;
    data = { users: {}, sessions: {} };
    try { Object.assign(data, JSON.parse(fs.readFileSync(file, 'utf8'))); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    seen = now;
  }
  function save() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(file + '.tmp', file);
    seen = stamp();
  }
  load();
  function user(name) {
    const u = data.users[String(name || '').toLowerCase()];
    if (!u) throw new Error('No such account.');
    return u;
  }
  function checkPassword(password) {
    if (typeof password !== 'string' || password.length < MIN_PASSWORD) throw new Error(`A password has at least ${MIN_PASSWORD} characters.`);
    if (password.length > 200) throw new Error('That password is too long.');
  }
  function setHash(u, password) {
    u.salt = crypto.randomBytes(16).toString('hex');
    u.hash = hashPassword(password, u.salt);
  }
  function endSessions(name) {
    Object.keys(data.sessions).forEach((id) => { if (data.sessions[id].user === name) delete data.sessions[id]; });
  }

  const api = {
    list() {
      return Object.keys(data.users).sort().map((name) => ({
        name, createdAt: data.users[name].createdAt, items: Object.keys(data.users[name].library).length
      }));
    },
    create(name, password) {
      name = String(name || '').trim().toLowerCase();
      if (!NAME.test(name)) throw new Error('A name is 2 to 32 letters, numbers, dots, dashes or underscores.');
      if (data.users[name]) throw new Error('That name is taken.');
      checkPassword(password);
      const u = { createdAt: now(), library: {}, progress: {}, jobs: {} };
      setHash(u, password);
      data.users[name] = u;
      save();
    },
    setPassword(name, password) {
      checkPassword(password);
      setHash(user(name), password);
      endSessions(String(name).toLowerCase());
      save();
    },
    remove(name) {
      user(name);
      name = String(name).toLowerCase();
      delete data.users[name];
      endSessions(name);
      save();
    },

    // -> a session token, or throws. key: who's trying (their address), so
    // guessing passwords stops after a few tries for a while.
    login(name, password, key) {
      name = String(name || '').trim().toLowerCase();
      const bucket = String(key) + '|' + name;
      const recent = (failures.get(bucket) || []).filter((t) => now() - t < LOGIN_WINDOW_MS);
      if (recent.length >= LOGIN_MAX_FAILURES) throw new Error('Too many tries. Wait 15 minutes and try again.');
      const u = data.users[name];
      // Same work whether or not the name exists, so timing doesn't tell.
      const hash = hashPassword(typeof password === 'string' ? password : '', u ? u.salt : 'no such user');
      if (!u || !crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(u.hash))) {
        recent.push(now());
        failures.set(bucket, recent);
        throw new Error('Wrong name or password.');
      }
      failures.delete(bucket);
      const token = crypto.randomBytes(32).toString('base64url');
      Object.keys(data.sessions).forEach((id) => { if (data.sessions[id].expires <= now()) delete data.sessions[id]; });
      data.sessions[digest(token)] = { user: name, expires: now() + SESSION_MS };
      save();
      return token;
    },
    // A session token -> its account name, or null.
    session(token) {
      if (typeof token !== 'string' || !token) return null;
      const s = data.sessions[digest(token)];
      if (!s || s.expires <= now() || !data.users[s.user]) return null;
      return s.user;
    },
    logout(token) {
      if (data.sessions[digest(token)]) { delete data.sessions[digest(token)]; save(); }
    },

    // Library items are "media:<file>.mp4" or "torrents:<infoHash>-<fileIdx>".
    has(name, item) { return !!user(name).library[item]; },
    items(name) { return Object.keys(user(name).library); },
    add(name, item) {
      if (!ITEM.test(item)) throw new Error('Not a saved file.');
      const u = user(name);
      if (!u.library[item]) { u.library[item] = { addedAt: now() }; save(); }
    },
    drop(name, item) {
      const u = user(name);
      if (u.library[item]) { delete u.library[item]; delete u.progress[item]; save(); }
    },
    progress(name, item) {
      return user(name).progress[item] || { positionSec: 0, durationSec: 0, watched: false };
    },
    setProgress(name, item, { positionSec, durationSec, completed }) {
      const u = user(name);
      if (!u.library[item]) return;
      const duration = Math.max(0, Number(durationSec) || 0) || (u.progress[item] || {}).durationSec || 0;
      const position = Math.max(0, Number(positionSec) || 0);
      // As on the resolver: only a natural end counts as watched.
      u.progress[item] = { positionSec: duration ? Math.min(position, duration) : position, durationSec: duration,
        watched: !!completed, updatedAt: now() };
      save();
    },
    // Downloads this person started, until they finish and join the library.
    addJob(name, id) { user(name).jobs[id] = now(); save(); },
    jobs(name) { return Object.keys(user(name).jobs); },
    dropJob(name, id) { const u = user(name); if (u.jobs[id]) { delete u.jobs[id]; save(); } }
  };
  // Every call starts from the file as it is now.
  Object.keys(api).forEach((key) => {
    const call = api[key];
    api[key] = (...args) => { load(); return call(...args); };
  });
  return api;
}

module.exports = { createAccounts, ITEM };
