'use strict';

const http = require('http');
const { WebSocketServer } = require('ws');
const { RoomRegistry } = require('./rooms');
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

const rooms = new RoomRegistry();

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', rooms: rooms.rooms.size }));
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

function broadcastToCompanions(room, message) {
  for (const companion of room.companions) {
    send(companion, message);
  }
}

function handleFirstMessage(socket, msg) {
  if (msg.type === TYPES.REGISTER) {
    if (!validateRegister(msg)) {
      sendError(socket, ERROR_CODES.INVALID_MESSAGE, 'register requires role "tv".');
      return;
    }
    const code = rooms.createRoom(socket);
    socket.role = 'tv';
    socket.roomCode = code;
    send(socket, { type: TYPES.REGISTERED, role: 'tv', code });
    log('tv registered', code);
    return;
  }

  if (msg.type === TYPES.JOIN) {
    if (!validateJoin(msg)) {
      sendError(socket, ERROR_CODES.INVALID_MESSAGE, 'join requires role "companion" and a code.');
      return;
    }
    const room = rooms.getRoom(msg.code);
    if (!room) {
      sendError(socket, ERROR_CODES.TV_NOT_FOUND, 'No TV is using this code.');
      return;
    }
    rooms.joinRoom(msg.code, socket);
    socket.role = 'companion';
    socket.roomCode = msg.code;
    send(socket, { type: TYPES.JOINED, code: msg.code });
    log('companion joined', msg.code);
    return;
  }

  sendError(socket, ERROR_CODES.UNKNOWN_TYPE, 'First message on a connection must be "register" or "join".');
}

function handleCommand(socket, msg) {
  if (!validateCommand(msg)) {
    sendError(socket, ERROR_CODES.INVALID_MESSAGE, `Invalid command payload for action "${msg.action}".`);
    return;
  }
  const room = rooms.getRoom(socket.roomCode);
  if (!room || room.tvSocket.readyState !== room.tvSocket.OPEN) {
    sendError(socket, ERROR_CODES.TV_NOT_FOUND, 'No TV is connected in this room.');
    return;
  }
  send(room.tvSocket, msg);
}

function handleStatus(socket, msg) {
  if (!validateStatus(msg)) {
    sendError(socket, ERROR_CODES.INVALID_MESSAGE, `Invalid status state "${msg.state}".`);
    return;
  }
  const room = rooms.getRoom(socket.roomCode);
  if (!room) return;
  broadcastToCompanions(room, msg);
}

wss.on('connection', (socket) => {
  socket.isAlive = true;
  socket.role = null;
  socket.roomCode = null;

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

    if (socket.role === 'companion' && msg.type === TYPES.COMMAND) {
      handleCommand(socket, msg);
      return;
    }

    if (socket.role === 'tv' && msg.type === TYPES.STATUS) {
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
    if (socket.role === 'tv' && socket.roomCode) {
      const room = rooms.getRoom(socket.roomCode);
      if (room) {
        broadcastToCompanions(room, { type: TYPES.STATUS, state: 'tv_offline' });
        rooms.removeTv(socket.roomCode);
        log('tv disconnected, room torn down', socket.roomCode);
      }
    } else if (socket.role === 'companion' && socket.roomCode) {
      rooms.removeCompanion(socket.roomCode, socket);
      log('companion left', socket.roomCode);
    }
  });
});

// Heartbeat: a network drop doesn't always send a clean close frame (e.g.
// a TV losing wifi), which would otherwise leave a zombie room that no
// companion could ever reconnect to. terminate() on a socket that missed
// its pong fires 'close', so the cleanup above still runs.
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
  log(`relay listening on :${PORT} (ws + http GET /healthz)`);
});
