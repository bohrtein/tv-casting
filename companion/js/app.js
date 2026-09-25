'use strict';

document.addEventListener('DOMContentLoaded', function () {
  var resolver = createResolverClient(APP_CONFIG);
  var nowCasting = createNowCasting(); // what this browser last cast, see now-casting.js
  var lastStatusTitle = ''; // title in the TV's latest status
  var lastPositionSec = 0;
  var lastDurationSec = 0;
  var seeking = false; // true while the user is dragging the seek bar
  var playingLibraryEntry = null;
  var lastProgressWriteSec = -1;

  var el = {
    relayChip: document.getElementById('relay-chip'),
    relayChipLabel: document.getElementById('relay-chip-label'),
    linkUrl: document.getElementById('link-url'),
    linkTitle: document.getElementById('link-title'),
    linkReadout: document.getElementById('link-readout'),
    linkCast: document.getElementById('link-cast'),
    linkDownloaded: document.getElementById('link-downloaded'),
    linkDownloadedList: document.getElementById('link-downloaded-list'),
    downloadsList: document.getElementById('downloads-list'),
    downloadsEmpty: document.getElementById('downloads-empty'),
    activityList: document.getElementById('activity-list'),
    remoteReadout: document.getElementById('remote-readout'),
    remoteSeek: document.getElementById('remote-seek'),
    remoteSeekPos: document.getElementById('remote-seek-pos'),
    remoteSeekDur: document.getElementById('remote-seek-dur'),
    remotePlayPause: document.getElementById('remote-playpause'),
    remoteStop: document.getElementById('remote-stop'),
    remoteBack: document.getElementById('remote-back'),
    remoteFwd: document.getElementById('remote-fwd')
  };

  function setRelayChip(state, label) {
    el.relayChip.setAttribute('data-mx-state', state);
    el.relayChipLabel.textContent = label;
  }

  function setReadout(target, message, isError) {
    target.textContent = message;
    target.className = isError ? 'mx-readout mx-err' : 'mx-readout';
    target.style.display = message ? 'block' : 'none';
  }

  var relay = createRelayClient(APP_CONFIG, {
    onConnected: function () {
      setRelayChip('busy', 'connected');
    },
    onDisconnected: function () {
      setRelayChip('err', 'reconnecting…');
    },
    onJoined: function () {
      setRelayChip('ok', 'connected');
    },
    onStatus: function (msg) {
      renderStatus(msg);
    },
    onError: function (msg) {
      if (msg.code !== 'TV_NOT_FOUND') return;
      setRelayChip('err', 'no tv');
      MX.toast(false, 'No TV is connected right now.');
    }
  });

  function escapeHtml(s) {
    var div = document.createElement('div');
    div.textContent = s == null ? '' : String(s);
    return div.innerHTML;
  }

  function castToTv(url, title, libraryEntry) {
    playingLibraryEntry = libraryEntry ? { kind: libraryEntry.kind, key: libraryEntry.key } : null;
    lastProgressWriteSec = -1;
    nowCasting.set(url, title);
    var resumeAt = libraryEntry && (libraryEntry.progressSec || libraryEntry.metadata && libraryEntry.metadata.progressSec) || 0;
    relay.sendCommand('play', { url: url, title: title, startPositionSec: resumeAt });
    MX.toast(true, 'Casting: ' + title);
    if (MX.view) MX.view.show('remote');
  }

  function describeResolveProgress(job) {
    if (job.status === 'starting') return 'looking up that video…';
    if (job.status === 'downloading') {
      var pct = typeof job.progress === 'number' ? Math.round(job.progress) : 0;
      return (job.title ? job.title + ' — ' : '') + 'downloading… ' + pct + '%';
    }
    return job.status;
  }

  el.linkCast.addEventListener('click', function () {
    var url = el.linkUrl.value.trim();
    if (!url) {
      setReadout(el.linkReadout, 'Paste a video URL first.', true);
      return;
    }
    try {
      new URL(url);
    } catch (e) {
      setReadout(el.linkReadout, "That doesn't look like a valid URL.", true);
      return;
    }

    var typedTitle = el.linkTitle.value.trim();

    if (resolver.isDirectMediaUrl(url) && !document.getElementById('link-save').checked) {
      setReadout(el.linkReadout, '', false);
      castToTv(url, typedTitle || url);
      return;
    }

    el.linkCast.disabled = true;
    setReadout(el.linkReadout, 'looking up that video…', false);
    resolver.resolve(url, function (job) {
      setReadout(el.linkReadout, describeResolveProgress(job), false);
    }, { category: document.getElementById('link-category').value, title: typedTitle }).then(function (result) {
      el.linkCast.disabled = false;
      setReadout(el.linkReadout, '', false);
      castToTv(result.streamUrl, typedTitle || result.title || url);
    }).catch(function (err) {
      el.linkCast.disabled = false;
      setReadout(el.linkReadout, err.message, true);
    });
  });

  // --- previously downloaded: instant recast from the resolver's
  // rewatch cache, no url needed ---

  function renderDownloaded(entries) {
    el.linkDownloaded.classList.toggle('cn-hidden', entries.length === 0);
    el.linkDownloadedList.innerHTML = '';
    entries.forEach(function (entry) {
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'cn-row';
      row.innerHTML =
        '<span class="cn-row-name">' + escapeHtml(entry.title || entry.sourceUrl) + '</span>' +
        '<span class="mx-pill">saved</span>';
      row.addEventListener('click', function () {
        castToTv(entry.streamUrl, entry.title || entry.sourceUrl);
      });
      el.linkDownloadedList.appendChild(row);
    });
  }

  // --- job activity: downloads-in-progress + activity log ---
  // Polls the resolver directly (same LAN, no auth, same pattern the
  // rest of this file already uses) rather than routing through the
  // relay -- a resolve job already runs independently of whichever
  // browser tab/device started it, so this just makes that state
  // discoverable from any device, any time, including one that wasn't
  // even open when the download started.

  var JOBS_POLL_MS = 3000;

  function formatClock(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    var h = d.getHours();
    var m = d.getMinutes();
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }

  // The downloads tab: progress bars + cancel, same view as the Stremio
  // page's.
  var downloadsView = createDownloadsView(resolver, el.downloadsEmpty, el.downloadsList, { emptyNotice: true, onCast: castToTv });
  downloadsView.onRefreshNeeded(function () { pollJobs(); });

  // The saved tab: everything on the server's disk, see saved-view.js.
  var savedView = createSavedView(resolver, document.getElementById('saved-view'), { onCast: castToTv });

  // A download that started while another tab is open puts Matrix's
  // update dot on the downloads tab. The first poll only records what's
  // already there.
  var seenDownloads = null;

  function markNewDownloads(allJobs) {
    var fresh = false;
    var first = !seenDownloads;
    seenDownloads = seenDownloads || {};
    allJobs.forEach(function (job) {
      if (job.status !== 'starting' && job.status !== 'downloading') return;
      if (!seenDownloads[job.id] && !first) fresh = true;
      seenDownloads[job.id] = true;
    });
    if (fresh && MX.view && !MX.view.visible('downloads')) MX.view.mark('downloads');
  }

  function renderActivity(allJobs) {
    el.activityList.innerHTML = '';
    if (!allJobs.length) {
      el.activityList.innerHTML = '<span class="mx-empty">nothing resolved yet.</span>';
      return;
    }
    allJobs.slice(0, 30).forEach(function (job) {
      var item = document.createElement('div');
      item.className = 'mx-log-item' + (job.status === 'ready' ? ' mx-ok' : job.status === 'error' || job.status === 'cancelled' ? ' mx-err' : '');
      var label = job.title || job.sourceUrl || job.id;
      var detail;
      if (job.status === 'error') detail = 'failed — ' + job.error;
      else if (job.status === 'cancelled') detail = 'cancelled';
      else if (job.kind === 'torrent' && !job.complete) detail = 'torrent — playing, still saving on the server';
      else if (job.kind === 'torrent') detail = job.fromCache ? 'torrent — already saved, cast instantly' : 'torrent — saved on the server';
      else if (job.status === 'ready') detail = job.fromCache ? 'already had it — cast instantly' : 'downloaded fresh';
      else detail = describeResolveProgress(job);
      item.innerHTML =
        '<time>' + formatClock(job.createdAt) + '</time>' +
        '<span>' + escapeHtml(label) + ' — ' + escapeHtml(detail) + '</span>';
      el.activityList.appendChild(item);
    });
  }

  function pollJobs() {
    resolver.listJobs().then(function (allJobs) {
      downloadsView.render(allJobs);
      markNewDownloads(allJobs);
      renderActivity(allJobs);
    }).catch(function () {
      // Resolver unreachable -- leave whatever was last rendered up
      // rather than blank a working UI over a transient LAN hiccup.
    });
    resolver.getCache().then(function (cache) {
      renderDownloaded(cache.entries || []);
      savedView.render(cache);
    }).catch(function (err) { savedView.error(err); });
  }

  pollJobs();
  setInterval(pollJobs, JOBS_POLL_MS);

  // --- remote ---

  function formatTime(totalSec) {
    var m = Math.floor(totalSec / 60);
    var s = Math.floor(totalSec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function renderStatus(msg) {
    if (msg.state === 'tv_offline') {
      nowCasting.clear();
      setRelayChip('err', 'tv offline');
      MX.toast(false, 'The TV disconnected.');
      return;
    }

    if (typeof msg.title === 'string') lastStatusTitle = msg.title;
    if (typeof msg.positionSec === 'number') lastPositionSec = msg.positionSec;
    if (typeof msg.durationSec === 'number') lastDurationSec = msg.durationSec;
    if (playingLibraryEntry && typeof msg.positionSec === 'number' &&
        (lastProgressWriteSec < 0 || Math.abs(msg.positionSec - lastProgressWriteSec) >= 10 || msg.state === 'paused' || msg.state === 'stopped')) {
      lastProgressWriteSec = msg.positionSec;
      resolver.updateLibrary(playingLibraryEntry.kind, playingLibraryEntry.key, {
        progressSec: msg.positionSec, durationSec: msg.durationSec || lastDurationSec
      }).catch(function () {});
    }

    var label;
    if (msg.state === 'error') {
      label = msg.error ? msg.error.message : 'error';
      if (msg.title) label = msg.title + ': ' + label;
    } else {
      label = msg.state;
      if (msg.title) label = msg.title + ' — ' + msg.state;
      if (typeof msg.positionSec === 'number') label += ' (' + formatTime(msg.positionSec) + ')';
    }
    setReadout(el.remoteReadout, label, msg.state === 'error');

    var hasMedia = msg.state !== 'idle' && msg.state !== 'stopped';
    el.remotePlayPause.disabled = !hasMedia;
    el.remotePlayPause.textContent = (msg.state === 'playing' || msg.state === 'buffering') ? 'pause' : 'play';
    el.remoteStop.disabled = !hasMedia;
    el.remoteBack.disabled = !hasMedia;
    el.remoteFwd.disabled = !hasMedia;

    // The TV doesn't know duration until AVPlay has actually prepared the
    // stream, so a bare positionSec with no durationSec yet is normal
    // right after "play" -- just don't let the bar go interactive until
    // both numbers are real, and don't fight the user mid-drag.
    var hasDuration = hasMedia && lastDurationSec > 0;
    el.remoteSeek.disabled = !hasDuration;
    if (!seeking) {
      el.remoteSeek.max = hasDuration ? lastDurationSec : 0;
      el.remoteSeek.value = hasDuration ? lastPositionSec : 0;
      updateSeekFill();
      el.remoteSeekPos.textContent = formatTime(hasMedia ? lastPositionSec : 0);
      el.remoteSeekDur.textContent = formatTime(hasDuration ? lastDurationSec : 0);
    }

    if (msg.state === 'stopped') {
      nowCasting.clear();
      lastDurationSec = 0;
      playingLibraryEntry = null;
    }
  }

  function updateSeekFill() {
    var max = Number(el.remoteSeek.max) || 0;
    var pct = max > 0 ? (Number(el.remoteSeek.value) / max) * 100 : 0;
    el.remoteSeek.style.setProperty('--cn-seek-pct', pct + '%');
  }

  el.remoteSeek.addEventListener('input', function () {
    // Fires continuously while dragging -- update the displayed time and
    // fill locally, but don't send a seek per pixel of drag.
    seeking = true;
    updateSeekFill();
    el.remoteSeekPos.textContent = formatTime(Number(el.remoteSeek.value));
  });

  el.remoteSeek.addEventListener('change', function () {
    // Fires once on release (mouseup/touchend/keyup) -- this is when we
    // actually tell the TV to jump.
    var target = Number(el.remoteSeek.value);
    lastPositionSec = target;
    relay.sendCommand('seek', { positionSec: target });
    seeking = false;
  });

  el.remotePlayPause.addEventListener('click', function () {
    if (el.remotePlayPause.textContent === 'pause') {
      relay.sendCommand('pause');
      return;
    }
    var cmd = nowCasting.resumeCommand(lastStatusTitle);
    relay.sendCommand(cmd.action, cmd.payload);
  });

  el.remoteStop.addEventListener('click', function () {
    relay.sendCommand('stop');
    nowCasting.clear();
  });

  el.remoteBack.addEventListener('click', function () {
    relay.sendCommand('seek', { positionSec: Math.max(0, lastPositionSec - 10) });
  });

  el.remoteFwd.addEventListener('click', function () {
    relay.sendCommand('seek', { positionSec: lastPositionSec + 10 });
  });

  document.getElementById('link-download').addEventListener('click', function () {
    var button = this; button.disabled = true;
    resolver.startDownload(el.linkUrl.value.trim(), { category: document.getElementById('link-category').value, title: el.linkTitle.value.trim() })
      .then(function () { setReadout(el.linkReadout, 'Download started. Follow progress in Downloads.', false); })
      .catch(function (err) { setReadout(el.linkReadout, err.message, true); })
      .then(function () { button.disabled = false; });
  });
  relay.connect();
});
