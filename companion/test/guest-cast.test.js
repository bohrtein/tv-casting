'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const { createGuestCast } = require('../guest-cast');

// A page's open event stream: what it was sent, and a way to close it.
function page(cast, user) {
  const req = new EventEmitter();
  const got = [];
  const res = { writableEnded: false, writeHead() {}, write(chunk) {
    const m = /^data: (.*)\n\n$/.exec(chunk);
    if (m) got.push(JSON.parse(m[1]));
  }, end() { this.writableEnded = true; } };
  cast.stream(req, res, user);
  const conn = got[0].conn;
  return {
    got, conn,
    send: (message) => cast.receive(user, { conn, message }),
    last: (type) => got.filter((m) => m.type === type).pop(),
    leave: () => req.emit('close')
  };
}

test('a guest casts from their phone to their own receiver', () => {
  const cast = createGuestCast();
  const tv = page(cast, 'alex');
  tv.send({ type: 'register', role: 'receiver', name: 'Laptop', receiverId: '11111111-1111-4111-8111-111111111111' });
  const target = tv.last('registered').targetId;
  const phone = page(cast, 'alex');
  phone.send({ type: 'join', role: 'companion' });
  assert.deepStrictEqual(phone.last('targets').targets, [{ id: target, name: 'Laptop', online: true }]);
  phone.send({ type: 'select-target', targetId: target });
  phone.send({ type: 'command', action: 'play', payload: { url: 'https://door/resolver/media/x.mp4', title: 'Film' } });
  assert.deepStrictEqual(tv.last('command'), { type: 'command', action: 'play', payload: { url: 'https://door/resolver/media/x.mp4', title: 'Film' } });
  tv.send({ type: 'status', state: 'playing', positionSec: 5 });
  assert.strictEqual(phone.last('status').state, 'playing');
  tv.leave();
  assert.strictEqual(phone.last('status').state, 'tv_offline');
  assert.deepStrictEqual(phone.last('targets').targets, []);
});

test('nobody sees or reaches another account\'s receivers, and there is no TV', () => {
  const cast = createGuestCast();
  const mine = page(cast, 'alex');
  mine.send({ type: 'register', role: 'receiver', name: 'Alex laptop', receiverId: '22222222-2222-4222-8222-222222222222' });
  const target = mine.last('registered').targetId;
  const other = page(cast, 'sam');
  other.send({ type: 'join', role: 'companion' });
  assert.deepStrictEqual(other.last('targets').targets, []);
  for (const id of [target, 'tv']) {
    other.send({ type: 'select-target', targetId: id });
    other.send({ type: 'command', action: 'play', payload: { url: 'https://x/y.mp4' } });
    assert.strictEqual(other.last('error').code, 'TV_NOT_FOUND');
  }
  assert.strictEqual(mine.last('command'), undefined);
  // A connection can't be used by another account either.
  assert.strictEqual(cast.receive('sam', { conn: mine.conn, message: { type: 'status', state: 'playing' } }).status, 404);
});

test('only known commands and states pass', () => {
  const cast = createGuestCast();
  const tv = page(cast, 'kim');
  tv.send({ type: 'register', role: 'receiver', name: 'TV browser' });
  const phone = page(cast, 'kim');
  phone.send({ type: 'join', role: 'companion', targetId: tv.last('registered').targetId });
  phone.send({ type: 'command', action: 'format-disk' });
  assert.strictEqual(phone.last('error').code, 'INVALID_MESSAGE');
  assert.strictEqual(tv.last('command'), undefined);
  assert.strictEqual(phone.send({ type: 'command', action: 'play', payload: { url: 'x'.repeat(20000) } }).status, 413);
});
