'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const MAX_BYTES = 2 * 1024 * 1024;

function timeMs(value) {
  const match = /^(?:(\d+):)?(\d{2}):(\d{2})[,.](\d{3})$/.exec(value.trim());
  if (!match) return null;
  return ((Number(match[1] || 0) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000 + Number(match[4]);
}

function escapeText(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function toSami(content) {
  const text = content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (/<sami[\s>]/i.test(text)) return text;
  const cues = [];
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const match = /^\s*(\d{2}:\d{2}[,.]\d{3}|\d+:\d{2}:\d{2}[,.]\d{3})\s+-->\s+(\d{2}:\d{2}[,.]\d{3}|\d+:\d{2}:\d{2}[,.]\d{3})/.exec(lines[index]);
    if (!match) continue;
    const start = timeMs(match[1]);
    const end = timeMs(match[2]);
    if (start === null || end === null || end <= start) continue;
    const body = [];
    while (++index < lines.length && lines[index].trim()) body.push(lines[index]);
    if (body.length) cues.push({ start, end, text: escapeText(body.join('\n')).replace(/\n/g, '<br>') });
  }
  if (!cues.length) throw new Error('Subtitle file is not SAMI, SRT, or WebVTT.');
  return '<SAMI><HEAD><STYLE TYPE="text/css">P { color: white; background: black; }</STYLE></HEAD><BODY>\n' +
    cues.map((cue) => '<SYNC Start=' + cue.start + '><P>' + cue.text + '</P></SYNC>\n' +
      '<SYNC Start=' + cue.end + '><P>&nbsp;</P></SYNC>').join('\n') + '\n</BODY></SAMI>\n';
}

async function download(url, mediaDir) {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Subtitle URL must be HTTP or HTTPS.');
  const fileName = 'subtitle-' + crypto.createHash('sha256').update(url).digest('hex').slice(0, 16) + '.smi';
  const target = path.join(mediaDir, fileName);
  try { await fs.access(target); return fileName; } catch (_) {}
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('Subtitle download failed (HTTP ' + response.status + ').');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error('Subtitle file is too large.');
      chunks.push(value);
    }
  } finally { reader.cancel().catch(() => {}); }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  await fs.mkdir(mediaDir, { recursive: true });
  await fs.writeFile(target, toSami(text), { flag: 'wx' }).catch((error) => {
    if (error.code !== 'EEXIST') throw error;
  });
  return fileName;
}

module.exports = { toSami, download };
