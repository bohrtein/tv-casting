'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateCommand } = require('../src/messages');
test('caption commands require a media identity and one valid selection', () => {
  for (const payload of [{mediaId:'2',trackId:null}, {mediaId:'2',trackId:'embedded:3'}, {mediaId:'2',trackId:'external'}, {mediaId:'2',subtitleUrl:'https://local/subtitle.smi'}]) {
    assert.equal(validateCommand({action:'captions',payload}), true);
  }
  for (const payload of [null, {}, {trackId:null}, {mediaId:'2'}, {mediaId:'2',trackId:'embedded:-1'}, {mediaId:'2',subtitleUrl:'file:///private'}, {mediaId:'2',trackId:null,subtitleUrl:'https://local/subtitle.smi'}]) {
    assert.equal(validateCommand({action:'captions',payload}), false);
  }
});
