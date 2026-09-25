'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { toSami, download } = require('../src/subtitles');

test('SRT and WebVTT cues become TV compatible SAMI', () => {
  const srt = toSami('1\n00:00:01,200 --> 00:00:03,000\nHello & <world>\n\n');
  assert.match(srt, /<SYNC Start=1200>/);
  assert.match(srt, /Hello &amp; &lt;world&gt;/);
  assert.match(srt, /<SYNC Start=3000><P>&nbsp;/);
  const vtt = toSami('WEBVTT\n\n00:01.000 --> 00:02.500\nHi\n');
  assert.match(vtt, /<SYNC Start=1000>/);
  assert.throws(() => toSami('garbage'), /not SAMI, SRT, or WebVTT/);
});

test('subtitle download is bounded and cached as SAMI', async () => {
  const server = http.createServer((_req, res) => res.end('1\n00:00:01,000 --> 00:00:02,000\nHello\n'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tv-casting-subtitles-'));
  try {
    const url = `http://127.0.0.1:${server.address().port}/subtitle.srt`;
    const first = await download(url, dir);
    const second = await download(url, dir);
    assert.equal(first, second);
    assert.match(await fs.readFile(path.join(dir, first), 'utf8'), /<SAMI>/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep + 'tv-casting-subtitles-')) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});
