'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAccounts } = require('../accounts');

function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'accounts-'));
  let clock = 1_000_000;
  const file = path.join(dir, 'accounts.json');
  const accounts = createAccounts(file, { now: () => clock });
  return { accounts, file, advance: (ms) => { clock += ms; }, reopen: () => createAccounts(file, { now: () => clock }) };
}

test('an account logs in with its password and gets a session', () => {
  const { accounts, reopen } = fresh();
  accounts.create('Alex', 'correct horse');
  assert.throws(() => accounts.login('alex', 'wrong password', 'ip'), /Wrong name or password/);
  assert.throws(() => accounts.login('nobody', 'correct horse', 'ip'), /Wrong name or password/);
  const token = accounts.login('ALEX', 'correct horse', 'ip');
  assert.strictEqual(accounts.session(token), 'alex');
  assert.strictEqual(reopen().session(token), 'alex', 'sessions survive a restart');
  accounts.logout(token);
  assert.strictEqual(accounts.session(token), null);
});

test('the password is never stored as is', () => {
  const { accounts, file } = fresh();
  accounts.create('sam', 'a secret phrase');
  assert.ok(!fs.readFileSync(file, 'utf8').includes('a secret phrase'));
});

test('names and passwords are checked', () => {
  const { accounts } = fresh();
  assert.throws(() => accounts.create('a', 'long enough'), /name/);
  assert.throws(() => accounts.create('bad name', 'long enough'), /name/);
  assert.throws(() => accounts.create('ok', 'short'), /at least 8/);
  accounts.create('ok', 'long enough');
  assert.throws(() => accounts.create('OK', 'long enough'), /taken/);
});

test('guessing stops after a few wrong passwords for 15 minutes', () => {
  const { accounts, advance } = fresh();
  accounts.create('kim', 'the real one');
  for (let i = 0; i < 8; i++) assert.throws(() => accounts.login('kim', 'guess ' + i, '1.2.3.4'), /Wrong/);
  assert.throws(() => accounts.login('kim', 'the real one', '1.2.3.4'), /Too many tries/);
  advance(15 * 60 * 1000);
  assert.ok(accounts.login('kim', 'the real one', '1.2.3.4'));
});

test('sessions expire, and a new password or removal ends them', () => {
  const { accounts, advance } = fresh();
  accounts.create('lee', 'first password');
  const old = accounts.login('lee', 'first password', 'ip');
  advance(31 * 24 * 60 * 60 * 1000);
  assert.strictEqual(accounts.session(old), null);
  const token = accounts.login('lee', 'first password', 'ip');
  accounts.setPassword('lee', 'second password');
  assert.strictEqual(accounts.session(token), null);
  const again = accounts.login('lee', 'second password', 'ip');
  accounts.remove('lee');
  assert.strictEqual(accounts.session(again), null);
});

test('each account has its own library and progress', () => {
  const { accounts } = fresh();
  accounts.create('one', 'password one');
  accounts.create('two', 'password two');
  const film = 'torrents:' + 'a'.repeat(40) + '-0';
  accounts.add('one', film);
  assert.ok(accounts.has('one', film));
  assert.ok(!accounts.has('two', film));
  assert.throws(() => accounts.add('one', 'media:../../etc/passwd'), /Not a saved file/);
  accounts.setProgress('one', film, { positionSec: 600, durationSec: 5400 });
  assert.deepStrictEqual(accounts.progress('two', film), { positionSec: 0, durationSec: 0, watched: false });
  assert.strictEqual(accounts.progress('one', film).positionSec, 600);
  accounts.setProgress('two', film, { positionSec: 60, durationSec: 5400 });
  assert.strictEqual(accounts.progress('two', film).positionSec, 0, 'no progress outside your library');
  accounts.drop('one', film);
  assert.deepStrictEqual(accounts.items('one'), []);
});
