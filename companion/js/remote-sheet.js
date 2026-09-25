'use strict';

// The remote as a bottom sheet. On a phone it peeks from the bottom (what's
// playing and play/pause); drag the grip up for the seek bar and the rest of
// the buttons, drag it back down to tuck them away. A tap on the grip does the
// same. On a computer (WIDE) there is room, so it stays open and can't be
// dragged.
function createRemoteSheet(sheet) {
  var WIDE = window.matchMedia('(min-width: 900px)');
  var grip = sheet.querySelector('.cn-remote-grip');
  var head = sheet.querySelector('.cn-remote-head');
  var body = sheet.querySelector('.cn-remote-body');
  var open = false;
  var drag = null;

  // How far the sheet sits below its open position when collapsed.
  function hiddenBy() { return body.offsetHeight; }

  function place(offset, animate) {
    sheet.classList.toggle('cn-remote-dragging', !animate);
    sheet.style.transform = offset ? 'translateY(' + offset + 'px)' : '';
  }

  function set(value) {
    open = WIDE.matches || !!value;
    sheet.classList.toggle('cn-remote-open', open);
    grip.setAttribute('aria-expanded', open ? 'true' : 'false');
    grip.setAttribute('aria-label', open ? 'Collapse remote' : 'Expand remote');
    place(open ? 0 : hiddenBy(), true);
  }

  function start(e) {
    if (WIDE.matches || (e.pointerType === 'mouse' && e.button !== 0)) return;
    // Only the head drags; the seek bar below must keep its own drag.
    if (!head.contains(e.target)) return;
    // Buttons in the head row keep working as buttons.
    if (e.target.closest('button') && e.target.closest('button') !== grip) return;
    drag = { id: e.pointerId, y: e.clientY, t: e.timeStamp, base: open ? 0 : hiddenBy(), offset: null, moved: false };
    try { sheet.setPointerCapture(e.pointerId); } catch (err) { /* old browsers */ }
  }

  function move(e) {
    if (!drag || e.pointerId !== drag.id) return;
    var dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dy) < 6) return;
    drag.moved = true;
    drag.offset = Math.max(0, Math.min(hiddenBy(), drag.base + dy));
    drag.v = dy / Math.max(1, e.timeStamp - drag.t); // px per ms, + is down
    place(drag.offset, false);
    e.preventDefault();
  }

  function end(e) {
    if (!drag || e.pointerId !== drag.id) return;
    var d = drag;
    drag = null;
    if (!d.moved) {
      // A tap on the grip or the empty part of the head toggles.
      if (e.type === 'pointerup') set(!open);
      return;
    }
    var fast = Math.abs(d.v || 0) > 0.5;
    set(fast ? d.v < 0 : d.offset < hiddenBy() / 2);
  }

  sheet.addEventListener('pointerdown', start);
  sheet.addEventListener('pointermove', move);
  sheet.addEventListener('pointerup', end);
  sheet.addEventListener('pointercancel', end);
  // The grip is a button so the keyboard can reach it; pointer taps are
  // handled above, this covers Enter and Space.
  grip.addEventListener('click', function (e) { if (e.detail === 0) set(!open); });
  head.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && open && !WIDE.matches) set(false);
  });

  // Keep the collapsed position right when the body's height changes
  // (seek bar appears, pending-seek note, rotation).
  function resync() { if (!drag) set(open); }
  if (WIDE.addEventListener) WIDE.addEventListener('change', resync);
  else if (WIDE.addListener) WIDE.addListener(resync);
  window.addEventListener('resize', resync);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resync).observe(body);

  set(false);
  return {
    open: function () { set(true); },
    close: function () { set(false); },
    isOpen: function () { return open; }
  };
}

if (typeof module !== 'undefined') module.exports = createRemoteSheet;
