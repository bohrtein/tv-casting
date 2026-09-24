'use strict';

const crypto = require('crypto');

// In-memory only, like the relay's client registry -- a resolver restart
// just means any in-flight or recently-finished job is gone, which is
// fine (the companion just re-requests it).
class JobRegistry {
  constructor() {
    this.jobs = new Map(); // id -> job
  }

  create() {
    const id = crypto.randomBytes(8).toString('hex');
    const job = {
      id,
      status: 'starting', // starting -> downloading -> ready | error | cancelled
      progress: 0,
      title: null,
      sourceUrl: null,
      fileName: null, // set once the output file exists
      error: null,
      createdAt: Date.now(),
      finishedAt: null
    };
    this.jobs.set(id, job);
    return job;
  }

  get(id) {
    return this.jobs.get(id) || null;
  }

  update(id, patch) {
    const job = this.jobs.get(id);
    if (!job) return null;
    Object.assign(job, patch);
    return job;
  }

  // Drop job records (not files) once they're old enough that no
  // companion is still polling them -- keeps the Map from growing
  // forever on a long-running server.
  sweep(maxAgeMs) {
    const now = Date.now();
    for (const [id, job] of this.jobs) {
      const finished = job.finishedAt || job.createdAt;
      if (now - finished > maxAgeMs) this.jobs.delete(id);
    }
  }
}

module.exports = { JobRegistry };
