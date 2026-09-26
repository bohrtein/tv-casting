'use strict';

// The remote as a bottom sheet. On a phone it has three stops:
//   full     -- everything, captions included
//   controls -- the seek bar and buttons, captions tucked away
//   peek     -- only what's playing and play/pause
// Drag the grip between them (it snaps to the nearest, or the next one in
// the direction of a quick flick). A tap on the grip steps up one stop,
// and from full back down to peek. Casting opens it at whichever of full
// or controls was used last. On a computer (WIDE) it's docked in a corner:
// the same three stops, stepped through with the grip (no dragging), and
// the parts a stop leaves out are hidden rather than slid away. It starts
// at controls there, and each kind of screen remembers its own stop.
function createRemoteSheet(sheet) {
  var WIDE = window.matchMedia('(min-width: 900px)');
  var LEVEL_KEY = 'tvc.remote.level';
  var LEVELS = ['peek', 'controls', 'full'];
  var grip = sheet.querySelector('.cn-remote-grip');
  var head = sheet.querySelector('.cn-remote-head');
  var body = sheet.querySelector('.cn-remote-body');
  var captions = sheet.querySelector('.cn-captions');
  var level = 'peek';
  var drag = null;

  function levelKey() { return LEVEL_KEY + (WIDE.matches ? '.wide' : ''); }
  function remembered() {
    var value = null;
    try { value = localStorage.getItem(levelKey()); } catch (e) { /* private mode */ }
    if (WIDE.matches) return LEVELS.indexOf(value) !== -1 ? value : 'controls';
    return value === 'controls' ? 'controls' : 'full';
  }
  function remember(value) {
    try { localStorage.setItem(levelKey(), value); } catch (e) { /* private mode */ }
  }

  // How far the sheet sits below its fully open position at each stop:
  // everything under the head for peek, everything from the captions
  // down for controls (bottom padding included in both).
  function offsetFor(value) {
    if (value === 'full' || WIDE.matches) return 0;
    var bottom = sheet.getBoundingClientRect().bottom;
    var cut = value === 'controls' && captions ? captions.getBoundingClientRect().top : head.getBoundingClientRect().bottom;
    return Math.max(0, bottom - cut);
  }

  function place(offset, animate) {
    sheet.classList.toggle('cn-remote-dragging', !animate);
    sheet.style.transform = offset ? 'translateY(' + offset + 'px)' : '';
  }

  function set(value) {
    level = value;
    var open = level !== 'peek';
    if (open || WIDE.matches) remember(level);
    LEVELS.forEach(function (l) { sheet.classList.toggle('cn-remote-lvl-' + l, l === level); });
    // Stops are measured from the top of the body, so it can't be
    // scrolled part way down.
    if (level !== 'full') body.scrollTop = 0;
    sheet.classList.toggle('cn-remote-open', open);
    sheet.classList.toggle('cn-remote-full', level === 'full');
    grip.setAttribute('aria-expanded', open ? 'true' : 'false');
    grip.setAttribute('aria-label', level === 'peek' ? 'Show remote controls' : level === 'controls' ? 'Show captions' : 'Hide remote');
    place(offsetFor(level), true);
  }

  function start(e) {
    if (WIDE.matches || (e.pointerType === 'mouse' && e.button !== 0)) return;
    // Only the head drags; the seek bar below must keep its own drag.
    if (!head.contains(e.target)) return;
    // Buttons in the head row keep working as buttons.
    if (e.target.closest('button') && e.target.closest('button') !== grip) return;
    drag = { id: e.pointerId, y: e.clientY, t: e.timeStamp, base: offsetFor(level), offset: null, moved: false };
    try { sheet.setPointerCapture(e.pointerId); } catch (err) { /* old browsers */ }
  }

  function move(e) {
    if (!drag || e.pointerId !== drag.id) return;
    var dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dy) < 6) return;
    drag.moved = true;
    drag.offset = Math.max(0, Math.min(offsetFor('peek'), drag.base + dy));
    drag.v = dy / Math.max(1, e.timeStamp - drag.t); // px per ms, + is down
    place(drag.offset, false);
    e.preventDefault();
  }

  function end(e) {
    if (!drag || e.pointerId !== drag.id) return;
    var d = drag;
    drag = null;
    if (!d.moved) {
      // A tap on the grip or the empty part of the head steps up.
      if (e.type === 'pointerup') step();
      return;
    }
    var stops = LEVELS.map(function (value) { return { value: value, offset: offsetFor(value) }; });
    var target;
    if (Math.abs(d.v || 0) > 0.5) {
      // A flick goes to the next stop that way from where it was let go.
      var ahead = stops.filter(function (s) { return d.v < 0 ? s.offset < d.offset - 1 : s.offset > d.offset + 1; });
      ahead.sort(function (a, b) { return Math.abs(a.offset - d.offset) - Math.abs(b.offset - d.offset); });
      target = ahead[0];
    }
    if (!target) {
      target = stops.slice().sort(function (a, b) { return Math.abs(a.offset - d.offset) - Math.abs(b.offset - d.offset); })[0];
    }
    set(target.value);
  }

  function step() {
    set(level === 'peek' ? 'controls' : level === 'controls' ? 'full' : 'peek');
  }

  sheet.addEventListener('pointerdown', start);
  sheet.addEventListener('pointermove', move);
  sheet.addEventListener('pointerup', end);
  sheet.addEventListener('pointercancel', end);
  // The grip is a button so the keyboard can reach it; pointer taps are
  // handled above, this covers Enter and Space.
  // On a computer every click lands here (start() leaves WIDE alone).
  grip.addEventListener('click', function (e) { if (e.detail === 0 || WIDE.matches) step(); });
  head.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && level !== 'peek') set(level === 'full' ? 'controls' : 'peek');
  });

  // Keep each stop in the right place when the body's height changes
  // (seek bar appears, pending-seek note, caption note, rotation).
  function resync() { if (!drag) set(level); }
  // Switching between phone and computer layouts: that one's own stop.
  function modeChanged() { hide(gone); set(WIDE.matches ? remembered() : 'peek'); }
  if (WIDE.addEventListener) WIDE.addEventListener('change', modeChanged);
  else if (WIDE.addListener) WIDE.addListener(modeChanged);
  window.addEventListener('resize', resync);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resync).observe(body);

  // Put away entirely (the "remote" button by the search box), peek bar
  // and all, for more room on a phone. Remembered; casting brings it back.
  var GONE_KEY = 'tvc.remote.hidden';
  var gone = false;
  function hide(value) {
    gone = !!value && !WIDE.matches;
    sheet.classList.toggle('cn-remote-gone', gone);
    document.body.classList.toggle('cn-remote-off', gone);
    sheet.setAttribute('aria-hidden', gone ? 'true' : 'false');
    try { localStorage.setItem(GONE_KEY, gone ? '1' : '0'); } catch (e) { /* private mode */ }
    if (onHidden) onHidden(gone);
  }
  var onHidden = null;
  try { gone = localStorage.getItem(GONE_KEY) === '1'; } catch (e) { /* private mode */ }

  set(WIDE.matches ? remembered() : 'peek');
  hide(gone);
  return {
    open: function () { hide(false); set(remembered()); },
    hidden: function () { return gone; },
    setHidden: hide,
    onHiddenChange: function (fn) { onHidden = fn; fn(gone); },
    close: function () { set('peek'); },
    isOpen: function () { return level !== 'peek'; },
    level: function () { return level; }
  };
}

if (typeof module !== 'undefined') module.exports = createRemoteSheet;
