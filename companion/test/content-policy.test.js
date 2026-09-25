'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const policy = require('../js/content-policy');
const { libraryFields, classify } = require('../../resolver/src/library');
test('legacy categories, metadata and explicit ratings share the adult boundary', () => {
  for (const entry of [{ category: 'porn' }, { category: 'plus18' }, { metadata: { addon: 'plus18' } }, { metadata: { genres: ['Adult'] } }, { age_limit: 18 }]) {
    assert.equal(policy.restricted(entry), true);
    assert.equal(policy.visible(entry), false);
  }
  for (const entry of [null, {}, { metadata: { name: 'Unknown rating' } }, { category: 'movies' }]) assert.equal(policy.restricted(entry), false);
  assert.equal(classify('https://youtube.com/watch?v=test', { age_limit: 18 }), 'plus18');
  assert.equal(libraryFields({ metadata: { type: 'movie', id: '1', name: 'Title', genres: ['Adult'] }, category: 'movies' }).category, 'plus18');
});
