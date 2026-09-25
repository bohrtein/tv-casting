import assert from 'node:assert/strict';
import test from 'node:test';
import { distinctPeerAddresses } from '../src/metrics.js';

test('counts connected addresses once across torrents', () => {
  const torrents = [
    { wires: [{ remoteAddress: '192.0.2.1' }, { remoteAddress: '192.0.2.2' }] },
    { wires: [{ remoteAddress: '192.0.2.1' }, { remoteAddress: null }] }
  ];
  assert.equal(distinctPeerAddresses(torrents), 2);
});
