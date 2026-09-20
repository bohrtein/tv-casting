'use strict';

// Idle-screen digital-rain background, ported from the Matrix design
// system (companion/matrix.js) for this app's fixed 1920x1080 canvas --
// no devicePixelRatio scaling or resize handling needed since the TV
// viewport never changes at runtime, unlike a phone/desktop page.
// start()/stop() let app.js run this only while the idle screen is
// showing, not during playback, since it's otherwise wasted CPU on
// older TV hardware.
function createIdleBackground(canvas, bloom) {
  var ctx = canvas && canvas.getContext && canvas.getContext('2d');
  var bctx = bloom ? bloom.getContext('2d', { alpha: false }) : null;
  if (!ctx) return { start: function () {}, stop: function () {} };

  var KATA = '\uff71\uff72\uff73\uff74\uff75\uff76\uff77\uff78\uff79\uff7a\uff7b\uff7c\uff7d\uff7e\uff7f\uff80\uff81\uff82\uff83\uff84\uff85\uff86\uff87\uff88\uff89\uff8a\uff8b\uff8c\uff8d\uff8e\uff8f\uff90\uff91\uff92\uff93\uff94\uff95\uff96\uff97\uff98\uff99\uff9a\uff9b\uff9c\uff9d';
  var GLYPHS = (KATA + '0123456789' + 'Z:\u30fb"=*+-<>\u00a6|\u00e7').split('');
  var FONT = '"MS Gothic", "Osaka-Mono", "Noto Sans Mono CJK JP", ui-monospace, Menlo, monospace';

  var FONT_PX = 16;             // cell size, px
  var FPS = 25;
  var MIN_SPEED = 0.25, MAX_SPEED = 1.1;   // rows per frame
  var MIN_TRAIL = 14, MAX_TRAIL = 44;      // rows
  var MUTATE = 0.02;                       // per lit cell per frame
  var GREEN = '0,255,90';       // matches css/style.css's --green (#00ff5a)
  var HEAD = 'rgb(205,255,215)';

  var w = 1920, h = 1080;   // this app's fixed viewport (see index.html/style.css)
  var cols = Math.ceil(w / FONT_PX);
  var rows = Math.ceil(h / FONT_PX) + 1;
  var cells = [], drops = [];

  function rnd(a) { return a[(Math.random() * a.length) | 0]; }

  function newDrop(scatter) {
    var trail = MIN_TRAIL + Math.random() * (MAX_TRAIL - MIN_TRAIL);
    return {
      y: scatter ? Math.random() * rows * 1.5 - rows * 0.5 : -Math.random() * 6,
      speed: MIN_SPEED + Math.random() * (MAX_SPEED - MIN_SPEED),
      trail: trail,
      gap: trail + 6 + Math.random() * 40   // rows the head clears before a follower spawns
    };
  }

  function init() {
    canvas.width = w;
    canvas.height = h;
    ctx.font = FONT_PX + 'px ' + FONT;
    ctx.textBaseline = 'top';
    if (bloom) {
      bloom.width = Math.max(2, (w / 4) | 0);
      bloom.height = Math.max(2, (h / 4) | 0);
    }
    for (var i = 0; i < cols; i++) {
      var col = [];
      for (var r = 0; r < rows; r++) col.push(rnd(GLYPHS));
      cells[i] = col;
      drops[i] = [newDrop(true)];
    }
  }

  function frame() {
    ctx.clearRect(0, 0, w, h);
    ctx.shadowBlur = 0;
    for (var i = 0; i < cols; i++) {
      var x = i * FONT_PX;
      var list = drops[i];
      for (var k = 0; k < list.length; k++) {
        var d = list[k];
        var headRow = Math.floor(d.y);
        var top = Math.max(0, Math.ceil(d.y - d.trail));
        var bottom = Math.min(rows - 1, headRow);
        for (var r = top; r <= bottom; r++) {
          if (Math.random() < MUTATE) cells[i][r] = rnd(GLYPHS);
          var a = Math.pow(1 - (d.y - r) / d.trail, 1.4);
          if (a <= 0.02) continue;
          ctx.save();
          ctx.translate(x + FONT_PX, r * FONT_PX);
          ctx.scale(-1, 1);                              // mirrored, like the film
          if (r === headRow) {
            ctx.shadowColor = 'rgb(' + GREEN + ')';
            ctx.shadowBlur = 14;                         // glow only on the head: it's expensive
            ctx.fillStyle = HEAD;
          } else if (r === headRow - 1) {
            ctx.fillStyle = 'rgba(' + GREEN + ',1)';
          } else {
            ctx.fillStyle = 'rgba(' + GREEN + ',' + (a * 0.85) + ')';
          }
          ctx.fillText(cells[i][r], 0, 0);
          ctx.restore();
        }
        d.y += d.speed;
      }
      if (list[0].y - list[0].trail > rows) list.shift();
      var newest = list[list.length - 1];
      // A column whose only drop was culled before its follower spawned
      // leaves an empty list, which throws on the next frame.
      if (!newest || newest.y > newest.gap) list.push(newDrop(false));
    }
    // bloom: downsample the finished frame; CSS blur/brightness does the rest
    if (bctx) {
      bctx.fillStyle = '#000';
      bctx.fillRect(0, 0, bloom.width, bloom.height);
      bctx.drawImage(canvas, 0, 0, bloom.width, bloom.height);
    }
  }

  var last = 0, acc = 0, running = false, desired = false;
  function loop(t) {
    if (!running) return;
    requestAnimationFrame(loop);
    acc += t - last; last = t;
    if (acc >= 1000 / FPS) { acc = Math.min(acc - 1000 / FPS, 100); frame(); }
  }

  function run() {
    running = true;
    last = performance.now();
    acc = 0;
    requestAnimationFrame(loop);
  }

  function start() {
    desired = true;
    if (running || document.hidden) return;
    run();
  }

  function stop() {
    desired = false;
    running = false;
    ctx.clearRect(0, 0, w, h);
    if (bctx) bctx.clearRect(0, 0, bloom.width, bloom.height);
  }

  // A backgrounded app (e.g. HDMI input switched away) shouldn't keep
  // burning CPU on an animation nobody can see -- but only resume on
  // return if the idle screen still wants it running (app.js may have
  // switched to the player screen while hidden).
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) running = false;
    else if (desired && !running) run();
  });

  init();

  return { start: start, stop: stop };
}
