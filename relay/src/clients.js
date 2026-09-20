'use strict';

// No pairing, no room codes: one TV socket (the most recent to register)
// and a set of companion sockets, all sharing the same implicit room.
// A newly-registering TV simply replaces whatever was there before.
class ClientRegistry {
  constructor() {
    this.tvSocket = null;
    this.companions = new Set();
  }

  setTv(socket) {
    this.tvSocket = socket;
  }

  clearTv(socket) {
    if (this.tvSocket === socket) this.tvSocket = null;
  }

  addCompanion(socket) {
    this.companions.add(socket);
  }

  removeCompanion(socket) {
    this.companions.delete(socket);
  }
}

module.exports = { ClientRegistry };
