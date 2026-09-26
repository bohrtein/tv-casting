'use strict';

// Casting for guests (guest-gateway.js): each account gets its own small
// relay, so a guest can send videos from their phone to a receiver page
// they opened in another browser (a laptop, a TV's browser) where they're
// logged in with the same account. It speaks the relay's own messages
// (relay/PROTOCOL.md: join, register, targets, select-target, command,
// status), but only between one account's pages: there is no TV here, and
// nobody sees or reaches anyone else's receivers.
//
// No WebSocket library: the page gets messages over server-sent events
// (GET /api/cast/stream) and sends them with POST /api/cast/send, through
// guest-socket.js, which looks like a WebSocket to relay-client.js and
// browser-receiver.js.
const crypto = require('crypto');

const MAX_CONNECTIONS_PER_ACCOUNT = 12;
const MAX_MESSAGE_BYTES = 16 * 1024;
const KEEPALIVE_MS = 25 * 1000;
const ACTIONS = ['play', 'pause', 'resume', 'stop', 'seek'];
const STATES = ['idle', 'buffering', 'playing', 'paused', 'stopped', 'ended', 'error'];

function createGuestCast() {
  const connections = new Map(); // id -> { id, user, role, targetId, receiverName, lastStatus, res }

  function mine(user) { return [...connections.values()].filter((c) => c.user === user); }
  function receivers(user) { return mine(user).filter((c) => c.role === 'receiver'); }
  function send(c, message) {
    if (c.res && !c.res.writableEnded) c.res.write('data: ' + JSON.stringify(message) + '\n\n');
  }
  function targetList(user) {
    return receivers(user).map((r) => ({ id: r.targetId, name: r.receiverName, online: true }));
  }
  function publishTargets(user) {
    mine(user).filter((c) => c.role === 'companion').forEach((c) => send(c, { type: 'targets', targets: targetList(user) }));
  }
  function receiverFor(user, targetId) { return receivers(user).find((r) => r.targetId === targetId) || null; }
  function snapshot(c) {
    const target = receiverFor(c.user, c.targetId);
    send(c, Object.assign({}, target && target.lastStatus || { type: 'status', state: target ? 'idle' : 'tv_offline' }, { targetId: c.targetId }));
  }
  function drop(c) {
    if (!connections.delete(c.id)) return;
    clearInterval(c.keepalive);
    if (c.role === 'receiver' && !receiverFor(c.user, c.targetId)) {
      mine(c.user).filter((o) => o.role === 'companion' && o.targetId === c.targetId)
        .forEach((o) => send(o, { type: 'status', state: 'tv_offline', targetId: c.targetId }));
      publishTargets(c.user);
    }
  }
  function error(c, code, message) { send(c, { type: 'error', code, message }); }

  // GET /api/cast/stream: one connection, until the page goes away.
  function stream(req, res, user) {
    if (mine(user).length >= MAX_CONNECTIONS_PER_ACCOUNT) {
      res.writeHead(429, { 'Content-Type': 'text/plain' });
      res.end('Too many open pages for this account.');
      return;
    }
    const c = { id: crypto.randomBytes(18).toString('base64url'), user, role: null, targetId: '', res };
    connections.set(c.id, c);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 3000\n\n');
    send(c, { type: '_open', conn: c.id });
    c.keepalive = setInterval(() => { if (!res.writableEnded) res.write(': keepalive\n\n'); }, KEEPALIVE_MS);
    if (c.keepalive.unref) c.keepalive.unref();
    req.on('close', () => drop(c));
  }

  // POST /api/cast/send { conn, message }: what the relay does with one message.
  function receive(user, body) {
    const c = body && typeof body.conn === 'string' ? connections.get(body.conn) : null;
    if (!c || c.user !== user) return { status: 404, error: 'That connection is gone. Reload the page.' };
    const msg = body.message;
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return { status: 400, error: 'Not a message.' };
    if (JSON.stringify(msg).length > MAX_MESSAGE_BYTES) return { status: 413, error: 'Message too large.' };

    if (c.role === null) {
      if (msg.type === 'register' && msg.role === 'receiver') {
        const name = typeof msg.name === 'string' && msg.name.trim() ? msg.name.trim().slice(0, 80) : 'Browser receiver';
        const id = typeof msg.receiverId === 'string' && /^[0-9a-f-]{36}$/i.test(msg.receiverId) ? msg.receiverId : crypto.randomUUID();
        c.role = 'receiver';
        c.targetId = 'browser-' + id;
        c.receiverName = name;
        // A reload replaces the same tab's earlier connection.
        mine(user).filter((o) => o !== c && o.role === 'receiver' && o.targetId === c.targetId).forEach((o) => { if (o.res) o.res.end(); drop(o); });
        send(c, { type: 'registered', role: 'receiver', targetId: c.targetId });
        publishTargets(user);
        mine(user).filter((o) => o.role === 'companion' && o.targetId === c.targetId).forEach(snapshot);
      } else if (msg.type === 'join' && msg.role === 'companion') {
        c.role = 'companion';
        c.targetId = typeof msg.targetId === 'string' ? msg.targetId.slice(0, 80) : '';
        send(c, { type: 'joined' });
        send(c, { type: 'targets', targets: targetList(user) });
        snapshot(c);
      } else {
        error(c, 'UNKNOWN_TYPE', 'First message must be "register" (a receiver) or "join".');
      }
      return { status: 200 };
    }

    if (c.role === 'companion' && msg.type === 'select-target' && typeof msg.targetId === 'string') {
      c.targetId = msg.targetId.slice(0, 80);
      snapshot(c);
    } else if (c.role === 'companion' && msg.type === 'command') {
      const target = receiverFor(user, c.targetId);
      if (ACTIONS.indexOf(msg.action) === -1) error(c, 'INVALID_MESSAGE', 'Unknown action.');
      else if (!target) error(c, 'TV_NOT_FOUND', 'That receiver is offline. Open the receiver page on it and turn it on.');
      else send(target, { type: 'command', action: msg.action, payload: msg.payload });
    } else if (c.role === 'receiver' && msg.type === 'status') {
      if (STATES.indexOf(msg.state) === -1) return { status: 200 };
      c.lastStatus = Object.assign({}, msg, { targetId: c.targetId });
      mine(user).filter((o) => o.role === 'companion' && o.targetId === c.targetId).forEach((o) => send(o, c.lastStatus));
    } else {
      error(c, 'UNKNOWN_TYPE', `Message type "${msg.type}" is not valid here.`);
    }
    return { status: 200 };
  }

  // An account removed or given a new password: close its pages.
  function closeAccount(user) {
    mine(user).forEach((c) => { if (c.res) c.res.end(); drop(c); });
  }

  return { stream, receive, closeAccount, _connections: connections };
}

module.exports = { createGuestCast };
