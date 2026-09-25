'use strict';

const http = require('http');
const { WebSocketServer } = require('ws');
const { ClientRegistry } = require('./clients');
const {
  TYPES,
  ERROR_CODES,
  parseEnvelope,
  validateRegister,
  validateJoin,
  validateCommand,
  validateStatus,
} = require('./messages');
const { log } = require('./logger');

const PORT = process.env.PORT || 8787;
const HEARTBEAT_INTERVAL_MS = 30000;

const clients = new ClientRegistry();
const receivers = new Map();
const { randomUUID } = require('crypto');
function targetList() {
  return [{ id: 'tv', name: 'TV', online: !!clients.tvSocket }].concat(
    [...receivers].map(([id, s]) => ({ id, name: s.receiverName, online: true })));
}
function publishTargets() { broadcastToCompanions({ type: 'targets', targets: targetList() }); }
function selectedSocket(id) { return id === 'tv' ? clients.tvSocket : receivers.get(id); }
function snapshot(socket) {
  const id = socket.targetId || 'tv', target = selectedSocket(id);
  send(socket, { ...(target && target.lastStatus || { type: 'status', state: target ? 'idle' : 'tv_offline' }), targetId: id });
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', tvConnected: !!clients.tvSocket, companions: clients.companions.size }));
    return;
  }
  res.writeHead(404);
  res.end();
});

// Every real message in PROTOCOL.md is a few hundred bytes at most; this
// just bounds how much a misbehaving LAN client can make the relay
// buffer per frame (ws's own default is 100MiB).
const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });

function send(socket, message) {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function sendError(socket, code, message) {
  send(socket, { type: TYPES.ERROR, code, message });
}

function broadcastToCompanions(message) {
  for (const companion of clients.companions) {
    send(companion, message);
  }
}

function handleFirstMessage(socket, msg) {
  if (msg.type === TYPES.REGISTER) {
    if (!validateRegister(msg)) {
      sendError(socket, ERROR_CODES.INVALID_MESSAGE, 'register requires role "tv".');
      return;
    }
    socket.role = msg.role;
    if (msg.role === 'tv') {
      if (clients.tvSocket) clients.tvSocket.close(1000, 'Replaced by another TV');
      clients.setTv(socket); socket.targetId = 'tv';
    } else {
      socket.targetId = 'browser-' + (msg.receiverId || randomUUID());
      const previous = receivers.get(socket.targetId);
      if (previous) previous.close(1000, 'Receiver reconnected');
      socket.receiverName = msg.name.trim(); receivers.set(socket.targetId, socket);
    }
    send(socket, { type: TYPES.REGISTERED, role: msg.role, targetId: socket.targetId });
    publishTargets();
    for (const c of clients.companions) if ((c.targetId || 'tv') === socket.targetId) snapshot(c);
    log('receiver registered', socket.targetId);
    return;
  }

  if (msg.type === TYPES.JOIN) {
    if (!validateJoin(msg)) {
      sendError(socket, ERROR_CODES.INVALID_MESSAGE, 'join requires role "companion".');
      return;
    }
    clients.addCompanion(socket);
    socket.role = 'companion';
    socket.targetId = typeof msg.targetId === 'string' ? msg.targetId : 'tv';
    send(socket, { type: TYPES.JOINED });
    send(socket, { type: 'targets', targets: targetList() });
    snapshot(socket);
    log('companion joined');
    return;
  }

  sendError(socket, ERROR_CODES.UNKNOWN_TYPE, 'First message on a connection must be "register" or "join".');
}

function handleCommand(socket, msg) {
  if (!validateCommand(msg)) {
    sendError(socket, ERROR_CODES.INVALID_MESSAGE, `Invalid command payload for action "${msg.action}".`);
    return;
  }
  const target = selectedSocket(socket.targetId || 'tv');
  if (!target || target.readyState !== target.OPEN) {
    sendError(socket, ERROR_CODES.TV_NOT_FOUND, 'No TV is connected.');
    return;
  }
  log('command', socket.targetId, msg.action);
  send(target, msg);
}

function handleStatus(socket, msg) {
  if (!validateStatus(msg)) {
    sendError(socket, ERROR_CODES.INVALID_MESSAGE, `Invalid status state "${msg.state}".`);
    return;
  }
  // The TV's own console needs a debugger attached; logging here puts
  // playback errors in this service's journal (App Hub's log viewer).
  if (msg.state === 'error') {
    const err = msg.error || {};
    log(`TV playback error${msg.title ? ` (${msg.title})` : ''}: ${err.code || '?'}: ${err.message || '(no message)'}`);
  }
  if (selectedSocket(socket.targetId) !== socket) return;
  socket.lastStatus = { ...msg, targetId: socket.targetId };
  for (const c of clients.companions) if ((c.targetId || 'tv') === socket.targetId) send(c, socket.lastStatus);
}

wss.on('connection', (socket) => {
  socket.isAlive = true;
  socket.role = null;

  socket.on('pong', () => {
    socket.isAlive = true;
  });

  socket.on('message', (raw) => {
    const parsed = parseEnvelope(raw);
    if (!parsed.ok) {
      sendError(socket, ERROR_CODES.INVALID_MESSAGE, 'Malformed JSON or missing "type".');
      return;
    }
    const msg = parsed.value;

    if (socket.role === null) {
      handleFirstMessage(socket, msg);
      return;
    }

    if (msg.type === TYPES.REGISTER || msg.type === TYPES.JOIN) {
      sendError(socket, ERROR_CODES.ALREADY_REGISTERED, 'This connection has already registered.');
      return;
    }

    if (socket.role === 'companion' && msg.type === 'select-target' && typeof msg.targetId === 'string') {
      socket.targetId = msg.targetId; snapshot(socket); return;
    }

    if (socket.role === 'companion' && msg.type === TYPES.COMMAND) {
      handleCommand(socket, msg);
      return;
    }

    if ((socket.role === 'tv' || socket.role === 'receiver') && msg.type === TYPES.STATUS) {
      handleStatus(socket, msg);
      return;
    }

    sendError(
      socket,
      ERROR_CODES.UNKNOWN_TYPE,
      `Message type "${msg.type}" is not valid for a "${socket.role}" connection.`
    );
  });

  socket.on('close', () => {
    if (socket.role === 'tv' || socket.role === 'receiver') {
      if (selectedSocket(socket.targetId) !== socket) return;
      clients.clearTv(socket); receivers.delete(socket.targetId);
      for (const c of clients.companions) if ((c.targetId || 'tv') === socket.targetId) send(c, { type: TYPES.STATUS, state: 'tv_offline', targetId: socket.targetId });
      publishTargets();
      log('tv disconnected');
    } else if (socket.role === 'companion') {
      clients.removeCompanion(socket);
      log('companion left');
    }
  });
});

// Heartbeat: a network drop doesn't always send a clean close frame (e.g.
// a TV losing wifi). terminate() on a socket that missed its pong fires
// 'close', so the cleanup above still runs.
const heartbeat = setInterval(() => {
  for (const socket of wss.clients) {
    if (socket.isAlive === false) {
      socket.terminate();
      continue;
    }
    socket.isAlive = false;
    socket.ping();
  }
}, HEARTBEAT_INTERVAL_MS);

wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, () => {
  log(`relay listening on :${server.address().port} (ws + http GET /healthz)`);
});
