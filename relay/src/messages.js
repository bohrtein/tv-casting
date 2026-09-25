'use strict';

// Message schema and validation. Mirrors PROTOCOL.md — keep the two in
// sync if either changes.

const TYPES = Object.freeze({
  REGISTER: 'register',
  REGISTERED: 'registered',
  JOIN: 'join',
  JOINED: 'joined',
  COMMAND: 'command',
  STATUS: 'status',
  ERROR: 'error',
});

const ACTIONS = Object.freeze(['play', 'pause', 'resume', 'stop', 'seek']);

const STATES = Object.freeze([
  'idle',
  'buffering',
  'playing',
  'paused',
  'stopped',
  'ended',
  'error',
  'tv_offline',
]);

const ERROR_CODES = Object.freeze({
  TV_NOT_FOUND: 'TV_NOT_FOUND',
  INVALID_MESSAGE: 'INVALID_MESSAGE',
  UNKNOWN_TYPE: 'UNKNOWN_TYPE',
  ALREADY_REGISTERED: 'ALREADY_REGISTERED',
});

function parseEnvelope(raw) {
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false };
  }
  if (typeof value !== 'object' || value === null || typeof value.type !== 'string') {
    return { ok: false };
  }
  return { ok: true, value };
}

function validateRegister(msg) {
  return msg.role === 'tv' || (msg.role === 'receiver' && typeof msg.name === 'string' && msg.name.trim().length > 0 && msg.name.length <= 80 &&
    (msg.receiverId === undefined || typeof msg.receiverId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(msg.receiverId)));
}

function validateJoin(msg) {
  return msg.role === 'companion';
}

function validateCommand(msg) {
  if (!ACTIONS.includes(msg.action)) return false;
  if (msg.action === 'play') {
    return !!msg.payload && typeof msg.payload.url === 'string' && msg.payload.url.length > 0;
  }
  if (msg.action === 'seek') {
    return !!msg.payload && (Number.isFinite(msg.payload.positionSec) && msg.payload.positionSec >= 0 || Number.isFinite(msg.payload.deltaSec) && Math.abs(msg.payload.deltaSec) <= 86400);
  }
  return true; // pause/resume/stop take no payload
}

function validateStatus(msg) {
  return STATES.includes(msg.state);
}

module.exports = {
  TYPES,
  ACTIONS,
  STATES,
  ERROR_CODES,
  parseEnvelope,
  validateRegister,
  validateJoin,
  validateCommand,
  validateStatus,
};
