'use strict';

// Reproducible, seamless vector tiles. No runtime JS or font downloads needed.
const fs = require('node:fs');
const path = require('node:path');
let seed = 731;
function random() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }
for (const [layer, offset] of [['back', 0], ['mid', 10], ['front', 20]]) {
  const parts = ['<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">',
    '<g font-family="monospace" font-size="16" text-anchor="middle">'];
  for (let x = offset + 12; x < 960; x += 60) {
    const head = Math.floor(random() * 30);
    const length = 7 + Math.floor(random() * 14);
    for (let i = 0; i < length; i++) {
      const y = ((head - i + 30) % 30) * 18 + 15;
      const glyph = '012345789ZXY:+=*'[Math.floor(random() * 15)];
      const color = i === 0 ? '#d4ffdd' : '#38ec70';
      const opacity = i === 0 ? 1 : Math.pow(1 - i / length, 1.5).toFixed(2);
      parts.push(`<text x="${x}" y="${y}" fill="${color}" opacity="${opacity}">${glyph}</text>`);
    }
  }
  parts.push('</g></svg>');
  fs.writeFileSync(path.join(__dirname, '../media/matrix-' + layer + '.svg'), parts.join('\n') + '\n');
}
