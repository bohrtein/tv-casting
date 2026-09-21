'use strict';

const crypto = require('crypto');
const { randomCode } = require('./codes');

// One room per connected TV: a room is one TV socket and zero-or-more
// companion sockets (decision #5 in PLAN.md — multi-companion, no
// command locking).
//
// A TV socket dropping (wifi blip, relay hiccup, app briefly backgrounded)
// doesn't tear the room down on the spot -- markTvDisconnected() leaves the
// code and companion set alone and just notes when the TV socket went
// away, so a companion that was mid-session stays "paired" through a
// reconnect instead of being forced to read a new code off the TV screen
// (PROTOCOL.md's promised-but-previously-unimplemented grace period).
// reattachTv() is how a reconnecting TV claims that same room back: it has
// to present the resumeToken handed out with the original code, which
// only the still-running TV app process holds in memory (see
// tv-receiver/js/relay-client.js) -- a genuine app restart loses that
// token and gets a brand new room, same as before (decision #2).
class RoomRegistry {
  constructor() {
    this.rooms = new Map(); // code -> { tvSocket, companions: Set<socket>, resumeToken, disconnectedAt }
  }

  createRoom(tvSocket) {
    let code;
    do {
      code = randomCode();
    } while (this.rooms.has(code));
    const resumeToken = crypto.randomBytes(16).toString('hex');
    this.rooms.set(code, { tvSocket, companions: new Set(), resumeToken, disconnectedAt: null });
    return { code, resumeToken };
  }

  getRoom(code) {
    return this.rooms.get(code);
  }

  joinRoom(code, companionSocket) {
    const room = this.rooms.get(code);
    if (!room) return null;
    room.companions.add(companionSocket);
    return room;
  }

  removeCompanion(code, companionSocket) {
    const room = this.rooms.get(code);
    if (room) room.companions.delete(companionSocket);
  }

  // Reclaims an existing room for a reconnecting TV socket -- succeeds
  // only if the room still exists (hasn't been reaped past its grace
  // period) and the presented token matches the one handed out when the
  // room was created. Returns the room's code on success, null otherwise.
  reattachTv(code, resumeToken, tvSocket) {
    const room = this.rooms.get(code);
    if (!room || room.resumeToken !== resumeToken) return null;
    room.tvSocket = tvSocket;
    room.disconnectedAt = null;
    return code;
  }

  markTvDisconnected(code) {
    const room = this.rooms.get(code);
    if (room) {
      room.tvSocket = null;
      room.disconnectedAt = Date.now();
    }
  }

  // Deletes every room whose TV has been disconnected for longer than
  // graceMs, and returns them (code + their still-attached companions) so
  // the caller can give those companions a final "tv_offline" -- rooms
  // still inside their grace window are left untouched.
  reapStale(graceMs) {
    const now = Date.now();
    const reaped = [];
    for (const [code, room] of this.rooms) {
      if (room.disconnectedAt !== null && now - room.disconnectedAt > graceMs) {
        reaped.push({ code, companions: room.companions });
        this.rooms.delete(code);
      }
    }
    return reaped;
  }

  removeTv(code) {
    this.rooms.delete(code);
  }
}

module.exports = { RoomRegistry };
