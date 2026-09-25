'use strict';

// The remote's controls (the #remote-sheet markup): what the TV is playing,
// play/pause, stop, +/-10s and the seek bar. Feed it the relay's status
// messages through render(); buttons send commands through the relay.
function createRemoteControls(relay, nowCasting) {
  function $(id) { return document.getElementById(id); }
  var el = {
    readout: $('remote-readout'), pending: $('remote-pending'), seek: $('remote-seek'),
    seekPos: $('remote-seek-pos'), seekDur: $('remote-seek-dur'), playPause: $('remote-playpause'),
    stop: $('remote-stop'), back: $('remote-back'), fwd: $('remote-fwd')
  };
  var lastPositionSec = 0;
  var lastDurationSec = 0;
  var seeking = false; // true while the user is dragging the seek bar

  function setReadout(message, isError) {
    el.readout.textContent = message;
    el.readout.className = isError ? 'mx-readout mx-err' : 'mx-readout';
  }
  function formatTime(totalSec) {
    var m = Math.floor(totalSec / 60);
    var s = Math.floor(totalSec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function updateSeekFill() {
    var max = Number(el.seek.max) || 0;
    var pct = max > 0 ? (Number(el.seek.value) / max) * 100 : 0;
    el.seek.style.setProperty('--cn-seek-pct', pct + '%');
  }

  function render(msg) {
    if (msg.state === 'tv_offline') {
      nowCasting.clear();
      setReadout('Selected playback target is offline.', false);
      [el.playPause, el.stop, el.back, el.fwd, el.seek].forEach(function (b) { b.disabled = true; });
      el.pending.textContent = '';
      lastPositionSec = 0; lastDurationSec = 0;
      return;
    }

    if (msg.state === 'idle' || msg.state === 'stopped' || msg.state === 'ended') { lastPositionSec = 0; lastDurationSec = 0; el.pending.textContent = ''; }
    if (typeof msg.positionSec === 'number') lastPositionSec = msg.positionSec;
    if (typeof msg.durationSec === 'number') lastDurationSec = msg.durationSec;

    if (msg.pendingSeek) el.pending.textContent = msg.pendingSeek.targetSec === null ? '' : 'Seek to ' + Math.round(msg.pendingSeek.targetSec) + 's pending' + (msg.pendingSeek.error ? ' — press seek to retry' : '');
    var label;
    if (msg.state === 'error') {
      label = msg.error ? msg.error.message : 'error';
      if (msg.title) label = msg.title + ': ' + label;
    } else {
      label = msg.state;
      if (msg.title) label = msg.title + ' — ' + msg.state;
      if (typeof msg.positionSec === 'number') label += ' (' + formatTime(msg.positionSec) + ')';
    }
    setReadout(label, msg.state === 'error');

    var hasMedia = ['playing', 'paused', 'buffering'].indexOf(msg.state) !== -1;
    el.playPause.disabled = !hasMedia;
    el.playPause.textContent = (msg.state === 'playing' || msg.state === 'buffering') ? 'pause' : 'play';
    el.stop.disabled = !hasMedia;
    el.back.disabled = !hasMedia;
    el.fwd.disabled = !hasMedia;

    // The TV doesn't know duration until AVPlay has prepared the stream;
    // keep the bar inert until both numbers are real, and don't fight the
    // user mid-drag.
    var hasDuration = hasMedia && lastDurationSec > 0;
    el.seek.disabled = !hasDuration;
    if (!seeking) {
      el.seek.max = hasDuration ? lastDurationSec : 0;
      el.seek.value = hasDuration ? lastPositionSec : 0;
      updateSeekFill();
      el.seekPos.textContent = formatTime(hasMedia ? lastPositionSec : 0);
      el.seekDur.textContent = formatTime(hasDuration ? lastDurationSec : 0);
    }

    if (msg.state === 'stopped') {
      nowCasting.clear();
      lastDurationSec = 0;
    }
  }

  el.seek.addEventListener('input', function () {
    // Fires continuously while dragging: update locally, send on release.
    seeking = true;
    updateSeekFill();
    el.seekPos.textContent = formatTime(Number(el.seek.value));
  });
  el.seek.addEventListener('change', function () {
    var target = Number(el.seek.value);
    lastPositionSec = target;
    relay.sendCommand('seek', { positionSec: target });
    seeking = false;
  });
  el.playPause.addEventListener('click', function () {
    relay.sendCommand(el.playPause.textContent === 'pause' ? 'pause' : 'resume');
  });
  el.stop.addEventListener('click', function () {
    relay.sendCommand('stop');
    nowCasting.clear();
  });
  el.back.addEventListener('click', function () { relay.sendCommand('seek', { deltaSec: -10 }); });
  el.fwd.addEventListener('click', function () { relay.sendCommand('seek', { deltaSec: 10 }); });

  return { render: render };
}

if (typeof module !== 'undefined') module.exports = createRemoteControls;
