'use strict';

const { randomCode } = require('./codes');

// One room per connected TV: a room is one TV socket and zero-or-more
// companion sockets (decision #5 in PLAN.md — multi-companion, no
// command locking).
class RoomRegistry {
  constructor() {
    this.rooms = new Map(); // code -> { tvSocket, companions: Set<socket> }
  }

  createRoom(tvSocket) {
    let code;
    do {
      code = randomCode();
    } while (this.rooms.has(code));
    this.rooms.set(code, { tvSocket, companions: new Set() });
    return code;
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

  removeTv(code) {
    this.rooms.delete(code);
  }
}

module.exports = { RoomRegistry };
