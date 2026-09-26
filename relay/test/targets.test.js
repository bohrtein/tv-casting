'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const WebSocket = require('ws');
const { validateCommand } = require('../src/messages');

test('relative seek rejects invalid offsets', () => {
  for (const deltaSec of [NaN, Infinity, '10', 100000]) assert.equal(validateCommand({ action: 'seek', payload: { deltaSec } }), false);
  assert.equal(validateCommand({ action: 'seek', payload: { deltaSec: -10 } }), true);
});

test('receiver registration accepts a stable UUID and rejects malformed identities', () => {
  const { validateRegister } = require('../src/messages');
  const receiver = { role: 'receiver', name: 'Desktop', receiverId: '123e4567-e89b-42d3-a456-426614174000' };
  assert.equal(validateRegister(receiver), true);
  assert.equal(validateRegister({ ...receiver, receiverId: 'tv' }), false);
});

test('browser targets coexist with TV, route commands/status, and disconnect independently', async () => {
  const child = spawn(process.execPath, ['src/index.js'], { cwd: require('path').join(__dirname, '..'), env: { ...process.env, PORT: '0' } });
  // Port zero is useful for tests; ask the relay to print the actual bound port.
  const [line] = await once(child.stdout, 'data');
  const port = /listening on :(\d+)/.exec(String(line))[1];
  const sockets = [];
  async function connect(first) {
    const socket = new WebSocket('ws://127.0.0.1:' + port); sockets.push(socket);
    socket.messages = []; socket.on('message', raw => socket.messages.push(JSON.parse(raw)));
    await once(socket, 'open'); socket.send(JSON.stringify(first)); return socket;
  }
  async function wait(socket, predicate) {
    for (let i = 0; i < 100; i++) {
      const index = socket.messages.findIndex(predicate);
      if (index >= 0) return socket.messages.splice(index, 1)[0];
      await new Promise(r => setTimeout(r, 10));
    }
    throw new Error('Expected relay message missing: ' + JSON.stringify(socket.messages));
  }
  const send = (s, m) => s.send(JSON.stringify(m));
  try {
    const tv = await connect({ type: 'register', role: 'tv' });
    await wait(tv, m => m.type === 'registered');
    const pc = await connect({
      type: 'register', role: 'receiver', name: 'Desktop',
      resolverUrl: 'https://remote.example/resolver',
      stremioUrl: 'https://remote.example/stremio'
    });
    const registered = await wait(pc, m => m.type === 'registered');
    const c = await connect({ type: 'join', role: 'companion' });
    const targets = await wait(c, m => m.type === 'targets');
    assert.equal(targets.targets.length, 2);
    const browserTarget = targets.targets.find(t => t.id === registered.targetId);
    assert.equal(browserTarget.resolverUrl, 'https://remote.example/resolver');
    assert.equal(browserTarget.stremioUrl, 'https://remote.example/stremio');
    send(c, { type: 'command', action: 'pause' });
    await wait(tv, m => m.action === 'pause');
    const captions = { supported: true, mediaId: '2', tracks: [{ id: 'embedded:3', label: 'English' }], selectedId: null, busy: false, error: null };
    send(tv, { type: 'status', state: 'paused', captions });
    assert.deepEqual((await wait(c, m => m.state === 'paused')).captions, captions);
    send(c, { type: 'command', action: 'captions', payload: { mediaId: '2', trackId: 'embedded:3' } });
    assert.equal((await wait(tv, m => m.action === 'captions')).payload.trackId, 'embedded:3');
    send(c, { type: 'select-target', targetId: registered.targetId });
    send(c, { type: 'command', action: 'seek', payload: { deltaSec: 30 } });
    assert.equal((await wait(pc, m => m.action === 'seek')).payload.deltaSec, 30);
    send(pc, { type: 'status', state: 'playing', positionSec: 42 });
    assert.equal((await wait(c, m => m.state === 'playing')).positionSec, 42);
    pc.close();
    await wait(c, m => m.state === 'tv_offline' && m.targetId === registered.targetId);
    send(c, { type: 'command', action: 'stop' });
    await wait(c, m => m.code === 'TV_NOT_FOUND');
    assert.equal(tv.messages.some(m => m.action === 'stop'), false);
    const reconnected = await connect({ type: 'register', role: 'receiver', name: 'Desktop', receiverId: registered.targetId.slice('browser-'.length) });
    assert.equal((await wait(reconnected, m => m.type === 'registered')).targetId, registered.targetId);
    send(c, { type: 'command', action: 'pause' });
    await wait(reconnected, m => m.action === 'pause');
    send(c, { type: 'select-target', targetId: 'tv' });
    send(c, { type: 'command', action: 'resume' });
    await wait(tv, m => m.action === 'resume');
  } finally {
    sockets.forEach(s => s.terminate());
    const ended = once(child, 'exit'); child.kill(); await ended;
  }
});
