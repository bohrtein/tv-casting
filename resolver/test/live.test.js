'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseInfo } = require('../src/ytdlp');
const { liveFormat, ytdlpArgs, ffmpegArgs } = require('../src/live');

test('streams on air are told apart from saved videos and finished broadcasts', () => {
  assert.equal(parseInfo({ is_live: true }, 'u').isLive, true);
  assert.equal(parseInfo({ live_status: 'is_live' }, 'u').isLive, true);
  assert.equal(parseInfo({ live_status: 'was_live', is_live: false }, 'u').isLive, false);
  assert.equal(parseInfo({ live_status: 'not_live' }, 'u').isLive, false);
  assert.equal(parseInfo({}, 'u').title, 'u');
});

test('live streams are piped to stdout, preferring one muxed H.264 format', () => {
  assert.match(liveFormat(720), /^best\[height<=720\]\[vcodec\^=avc1\]\//);
  const args = ytdlpArgs('https://example.com/live', { maxHeight: 720, referer: 'https://example.com/' });
  assert.deepEqual(args.slice(-3), ['-o', '-', 'https://example.com/live']);
  assert.ok(args.includes('--referer'));
  assert.ok(!args.includes('--user-agent'));
});

test('ffmpeg writes a rolling live playlist, not an event/VOD one that fills the disk', () => {
  const args = ffmpegArgs('/tmp/x');
  assert.ok(!args.includes('-hls_playlist_type'));
  assert.match(args[args.indexOf('-hls_flags') + 1], /delete_segments/);
  assert.ok(parseInt(args[args.indexOf('-hls_list_size') + 1], 10) > 0);
});
