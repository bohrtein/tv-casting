// Disposable, synthetic library and silent media for manual browser smoke tests.
// Start with node companion/test/preview-resolver.js (port 18788).
'use strict';
const http = require('http');
const rate = 8000, seconds = 90, wav = Buffer.alloc(44 + rate * seconds * 2);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.url === '/fixture.wav') {
    const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    const start = range ? Number(range[1]) : 0, end = range && range[2] ? Number(range[2]) : wav.length - 1;
    res.setHeader('Content-Type', 'audio/wav'); res.setHeader('Accept-Ranges', 'bytes');
    if (range) { res.statusCode = 206; res.setHeader('Content-Range', `bytes ${start}-${end}/${wav.length}`); }
    res.setHeader('Content-Length', end - start + 1); res.end(wav.subarray(start, end + 1)); return;
  }
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/jobs') { res.end('{"jobs":[]}'); return; }
  res.end(JSON.stringify({ entries: [
    { key: 'regular', kind: 'media', category: 'youtube', title: 'Regular test video', streamUrl: 'http://127.0.0.1:18788/fixture.wav' },
    { key: 'adult', kind: 'media', category: 'porn', title: 'Restricted test item', streamUrl: 'http://127.0.0.1:18788/fixture.wav' },
    { key: 'unrated', kind: 'media', category: 'other', title: 'Unrated test item', streamUrl: 'http://127.0.0.1:18788/fixture.wav' }
  ], torrents: [], titles: [] }));
}).listen(18788, '127.0.0.1', () => console.log('Synthetic preview resolver: 18788'));
