'use strict';

// The remote's controls (the #remote-sheet markup): what the TV is playing,
// play/pause, stop, +/-10s and the seek bar. Feed it the relay's status
// messages through render(); buttons send commands through the relay.
function createRemoteControls(relay, nowCasting, resolver) {
  function $(id) { return document.getElementById(id); }
  var el = {
    readout: $('remote-readout'), pending: $('remote-pending'), seek: $('remote-seek'),
    seekPos: $('remote-seek-pos'), seekDur: $('remote-seek-dur'), playPause: $('remote-playpause'),
    stop: $('remote-stop'), back: $('remote-back'), fwd: $('remote-fwd')
  };
  var lastPositionSec = 0;
  var lastDurationSec = 0;
  var seeking = false; // true while the user is dragging the seek bar
  var captions = $('remote-captions'), captionNote = $('remote-captions-note');
  var captionUrl = $('remote-caption-url'), captionLoad = $('remote-caption-load');
  var captionState = null, captionTarget = null, captionToken = 0, convertingCaption = false;
  var captionOptions = '';
  var captionLocalError = '';

  function renderCaptions(msg) {
    if (!captions) return;
    var active = ['playing', 'paused', 'buffering'].indexOf(msg.state) !== -1;
    var next = active ? msg.captions || null : null;
    if ((next && next.mediaId) !== (captionState && captionState.mediaId) || captionTarget !== msg.targetId) {
      captionToken++; convertingCaption = false; captionUrl.value = ''; captionLocalError = '';
    }
    captionTarget = msg.targetId; captionState = next;
    var tracks = next && next.tracks || [];
    var signature = JSON.stringify(tracks);
    if (signature !== captionOptions) {
      captionOptions = signature; captions.innerHTML = '';
      [{ id: '', label: 'Off' }].concat(tracks).forEach(function (track) {
        var option = document.createElement('option'); option.value = track.id; option.textContent = track.label;
        captions.appendChild(option);
      });
    }
    captions.value = next && next.selectedId || '';
    var ready = next && next.supported && next.mediaId && ['playing', 'paused'].indexOf(msg.state) !== -1;
    captions.disabled = !ready || convertingCaption;
    captionUrl.disabled = !ready || convertingCaption;
    captionLoad.disabled = !ready || !resolver || convertingCaption || next.busy;
    captionNote.textContent = captionLocalError || (convertingCaption ? 'Preparing captions…' : next && next.busy ? 'Loading captions…' :
      next && next.error ? next.error : !active ? 'Start a video on the TV to choose captions.' :
      !next || !next.supported ? 'Caption controls are unavailable on this receiver.' :
      !tracks.length ? 'No caption tracks in this video. You can add a subtitle link.' : '');
  }

  if (captions) {
    captions.addEventListener('change', function () {
      if (!captionState || captions.disabled) return;
      captionLocalError = '';
      if (!relay.sendCommand('captions', { mediaId: captionState.mediaId, trackId: captions.value || null })) {
        captions.value = captionState.selectedId || '';
        captionNote.textContent = captionLocalError = 'Not connected. Reconnect and try again.';
      }
    });
    captionLoad.addEventListener('click', function () {
      if (!captionState || captionLoad.disabled) return;
      var url = captionUrl.value.trim();
      if (!/^https?:\/\//i.test(url)) { captionNote.textContent = captionLocalError = 'Enter an HTTP or HTTPS subtitle file link.'; return; }
      captionLocalError = '';
      var token = ++captionToken, mediaId = captionState.mediaId;
      convertingCaption = true; captionLoad.disabled = true; captions.disabled = true; captionUrl.disabled = true;
      captionNote.textContent = 'Preparing captions…';
      resolver.resolveSubtitle(url).then(function (localUrl) {
        if (token !== captionToken) return;
        if (!relay.sendCommand('captions', { mediaId: mediaId, subtitleUrl: localUrl })) throw new Error('Not connected. Reconnect and try again.');
        captionNote.textContent = 'Loading captions…';
      }).catch(function (error) {
        if (token === captionToken) captionNote.textContent = captionLocalError = error.message;
      }).then(function () {
        if (token !== captionToken) return;
        convertingCaption = false; captionLoad.disabled = false; captions.disabled = false; captionUrl.disabled = false;
      });
    });
  }

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
    renderCaptions(msg);
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
