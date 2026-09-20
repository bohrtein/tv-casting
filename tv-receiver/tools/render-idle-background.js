'use strict';

// One-off render tool: plays the real Matrix design system background
// (render-harness.html, which loads companion/matrix.js unmodified) in a
// real headless browser at full quality/framerate and records it to
// video. The TV plays back the resulting file with a plain <video> tag
// instead of running the animation itself -- hardware video decode is
// cheap on even old TV silicon, where live canvas scripting was not
// (see PLAN.md's status log for the frame-rate problem this replaces).
//
// Usage: node render-idle-background.js [seconds]
// Requires playwright + ffmpeg on PATH. Output: ../media/idle-background.mp4

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const SECONDS = Number(process.argv[2]) || 20;
const CROSSFADE_SEC = 1.5; // blends the tail into the head so `loop` doesn't hard-cut
const WIDTH = 1920, HEIGHT = 1080;
const TOOLS_DIR = __dirname;
const RAW_DIR = path.join(TOOLS_DIR, '.render-tmp');
const MEDIA_DIR = path.join(TOOLS_DIR, '..', 'media');
const PLAIN_MP4 = path.join(RAW_DIR, 'plain.mp4');
const OUT_MP4 = path.join(MEDIA_DIR, 'idle-background.mp4');

function ffprobeDuration(file) {
  const out = execFileSync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    file
  ]);
  return parseFloat(out.toString().trim());
}

async function main() {
  fs.mkdirSync(RAW_DIR, { recursive: true });
  fs.mkdirSync(MEDIA_DIR, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    recordVideo: { dir: RAW_DIR, size: { width: WIDTH, height: HEIGHT } }
  });
  const FILL_IN_SEC = 3; // let the rain fill in from its scattered initial state
  const page = await context.newPage();
  await page.goto('file://' + path.join(TOOLS_DIR, 'render-harness.html'));
  await page.waitForTimeout((FILL_IN_SEC + SECONDS) * 1000);
  const video = page.video();
  await context.close();
  await browser.close();

  const rawPath = await video.path();
  console.log('Recorded raw video:', rawPath);

  // libx264: broad TV WebView <video> support (unlike webm/vp9 on older
  // Tizen). CRF ~26 keeps this mostly-black, noise-like scene small
  // without visible banding; -an drops the (nonexistent) audio track.
  // -ss before -i drops the FILL_IN_SEC dead time at the start of the
  // recording (page load + rain filling in from its scattered initial
  // state), which is otherwise still sitting at the front of the file.
  execFileSync('ffmpeg', [
    '-y',
    '-ss', String(FILL_IN_SEC),
    '-i', rawPath,
    '-an',
    '-t', String(SECONDS),
    '-vf', 'fps=24',
    '-c:v', 'libx264',
    '-crf', '26',
    '-preset', 'slow',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    PLAIN_MP4
  ], { stdio: 'inherit' });

  // The raw recording has no relationship between its first and last
  // frame, so a hard `loop` cut would visibly snap. Crossfade the tail
  // into the head instead: main (0..T-D) plays once, then a D-second
  // dissolve from the tail into the head, which is also where playback
  // loops back to -- so the seam is a fade, not a jump cut.
  const total = ffprobeDuration(PLAIN_MP4);
  const d = CROSSFADE_SEC;
  const mainEnd = total - d;
  execFileSync('ffmpeg', [
    '-y',
    '-i', PLAIN_MP4,
    '-filter_complex',
    '[0:v]trim=0:' + d + ',setpts=PTS-STARTPTS[head];' +
    '[0:v]trim=' + mainEnd + ':' + total + ',setpts=PTS-STARTPTS[tail];' +
    '[0:v]trim=0:' + mainEnd + ',setpts=PTS-STARTPTS[main];' +
    '[tail][head]xfade=transition=fade:duration=' + d + ':offset=0[seam];' +
    '[main][seam]concat=n=2:v=1:a=0[out]',
    '-map', '[out]',
    '-c:v', 'libx264',
    '-crf', '26',
    '-preset', 'slow',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    OUT_MP4
  ], { stdio: 'inherit' });

  fs.rmSync(RAW_DIR, { recursive: true, force: true });

  const stat = fs.statSync(OUT_MP4);
  console.log('Wrote', OUT_MP4, '(' + (stat.size / 1024 / 1024).toFixed(2) + ' MB)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
