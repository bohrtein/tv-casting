'use strict';

document.addEventListener('DOMContentLoaded', function () {
  var jellyfin = createJellyfinClient();
  var resolver = createResolverClient(APP_CONFIG);
  var currentFolderId = null;
  var folderStack = []; // [{id, name}, ...] breadcrumb trail
  var nowCasting = null; // {url, title} of the last thing WE told the TV to play
  var lastPositionSec = 0;
  var lastDurationSec = 0;
  var seeking = false; // true while the user is dragging the seek bar

  var el = {
    relayChip: document.getElementById('relay-chip'),
    relayChipLabel: document.getElementById('relay-chip-label'),
    loginServer: document.getElementById('login-server'),
    loginUser: document.getElementById('login-user'),
    loginPass: document.getElementById('login-pass'),
    loginReadout: document.getElementById('login-readout'),
    loginSubmit: document.getElementById('login-submit'),
    libraryLogin: document.getElementById('library-login'),
    libraryBrowser: document.getElementById('library-browser'),
    libraryBreadcrumb: document.getElementById('library-breadcrumb'),
    libraryList: document.getElementById('library-list'),
    linkUrl: document.getElementById('link-url'),
    linkTitle: document.getElementById('link-title'),
    linkReadout: document.getElementById('link-readout'),
    linkCast: document.getElementById('link-cast'),
    linkDownloaded: document.getElementById('link-downloaded'),
    linkDownloadedList: document.getElementById('link-downloaded-list'),
    remoteDownloads: document.getElementById('remote-downloads'),
    remoteDownloadsList: document.getElementById('remote-downloads-list'),
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

  function route() {
    updateLibraryAuthUI();
    if (jellyfin.isAuthenticated() && !currentFolderId) loadLibraryRoot();
  }

  function updateLibraryAuthUI() {
    var authed = jellyfin.isAuthenticated();
    el.libraryLogin.classList.toggle('cn-hidden', authed);
    el.libraryBrowser.classList.toggle('cn-hidden', !authed);
  }

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
      route();
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

  // --- login ---

  el.loginSubmit.addEventListener('click', function () {
    var server = el.loginServer.value.trim();
    var user = el.loginUser.value.trim();
    var pass = el.loginPass.value;
    if (!server || !user) return;
    el.loginSubmit.disabled = true;
    setReadout(el.loginReadout, '', false);
    jellyfin.authenticate(server, user, pass).then(function () {
      el.loginSubmit.disabled = false;
      MX.toast(true, 'Signed in to Jellyfin');
      updateLibraryAuthUI();
      loadLibraryRoot();
    }).catch(function (err) {
      el.loginSubmit.disabled = false;
      setReadout(el.loginReadout, err.message, true);
    });
  });

  // --- library ---

  function escapeHtml(s) {
    var div = document.createElement('div');
    div.textContent = s == null ? '' : String(s);
    return div.innerHTML;
  }

  function renderBreadcrumb() {
    el.libraryBreadcrumb.innerHTML = '';
    var homeBtn = document.createElement('button');
    homeBtn.className = 'mx-badge cn-crumb';
    homeBtn.type = 'button';
    homeBtn.textContent = 'library';
    homeBtn.addEventListener('click', function () { goToBreadcrumb(-1); });
    el.libraryBreadcrumb.appendChild(homeBtn);
    folderStack.forEach(function (crumb, i) {
      var btn = document.createElement('button');
      btn.className = 'mx-badge cn-crumb';
      btn.type = 'button';
      btn.textContent = crumb.name;
      btn.addEventListener('click', function () { goToBreadcrumb(i); });
      el.libraryBreadcrumb.appendChild(btn);
    });
  }

  function showLibraryError(err) {
    el.libraryList.innerHTML = '';
    var readout = document.createElement('div');
    readout.className = 'mx-readout mx-err';
    readout.textContent = err.message;
    el.libraryList.appendChild(readout);
  }

  function renderItems(items) {
    el.libraryList.innerHTML = '';
    if (!items.length) {
      el.libraryList.innerHTML = '<span class="mx-empty">nothing here.</span>';
      return;
    }
    items.forEach(function (item) {
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'cn-row';
      var typePill = item.Type || (item.IsFolder ? 'folder' : 'item');
      row.innerHTML =
        '<span class="cn-row-name">' + escapeHtml(item.Name) + '</span>' +
        '<span class="mx-badge">' + escapeHtml(typePill) + '</span>';
      row.addEventListener('click', function () {
        if (item.IsFolder) {
          openFolder(item);
        } else {
          cast(item);
        }
      });
      el.libraryList.appendChild(row);
    });
  }

  function loadLibraryRoot() {
    folderStack = [];
    currentFolderId = null;
    renderBreadcrumb();
    el.libraryList.innerHTML = '<span class="mx-empty">loading…</span>';
    jellyfin.getLibraries().then(renderItems).catch(showLibraryError);
  }

  function openFolder(item) {
    folderStack.push({ id: item.Id, name: item.Name });
    currentFolderId = item.Id;
    renderBreadcrumb();
    el.libraryList.innerHTML = '<span class="mx-empty">loading…</span>';
    jellyfin.getChildren(item.Id).then(renderItems).catch(showLibraryError);
  }

  function goToBreadcrumb(index) {
    if (index < 0) {
      loadLibraryRoot();
      return;
    }
    folderStack = folderStack.slice(0, index + 1);
    currentFolderId = folderStack[folderStack.length - 1].id;
    renderBreadcrumb();
    el.libraryList.innerHTML = '<span class="mx-empty">loading…</span>';
    jellyfin.getChildren(currentFolderId).then(renderItems).catch(showLibraryError);
  }

  function castToTv(url, title) {
    nowCasting = { url: url, title: title };
    relay.sendCommand('play', { url: url, title: title });
    MX.toast(true, 'Casting: ' + title);
    if (MX.view) MX.view.show('remote');
  }

  function cast(item) {
    castToTv(jellyfin.getStreamUrl(item.Id), item.Name);
  }

  // --- cast a link (no Jellyfin involved) ---
  // A direct media url (.mp4/.m3u8/...) goes straight to the TV, same as
  // before. Anything else (a YouTube/Twitter/etc. page with a video
  // embedded in it) goes through the resolver first, which downloads and
  // serves back a plain MP4 the TV can actually load -- AVPlay can't
  // parse a webpage to find the video itself (resolver/README.md).

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

    if (resolver.isDirectMediaUrl(url)) {
      setReadout(el.linkReadout, '', false);
      castToTv(url, typedTitle || url);
      return;
    }

    el.linkCast.disabled = true;
    setReadout(el.linkReadout, 'looking up that video…', false);
    resolver.resolve(url, function (job) {
      setReadout(el.linkReadout, describeResolveProgress(job), false);
    }).then(function (result) {
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
        '<span class="mx-pill">cached</span>';
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

  // Progress bars + cancel, same view as the Stremio page's.
  var downloadsView = createDownloadsView(resolver, el.remoteDownloads, el.remoteDownloadsList);
  downloadsView.onRefreshNeeded(function () { pollJobs(); });

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
      renderActivity(allJobs);
    }).catch(function () {
      // Resolver unreachable -- leave whatever was last rendered up
      // rather than blank a working UI over a transient LAN hiccup.
    });
    resolver.listCache().then(renderDownloaded).catch(function () {});
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
      nowCasting = null;
      setRelayChip('err', 'tv offline');
      MX.toast(false, 'The TV disconnected.');
      return;
    }

    if (typeof msg.positionSec === 'number') lastPositionSec = msg.positionSec;
    if (typeof msg.durationSec === 'number') lastDurationSec = msg.durationSec;

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
      nowCasting = null;
      lastDurationSec = 0;
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
    if (nowCasting) {
      relay.sendCommand('play', { url: nowCasting.url, title: nowCasting.title });
    } else {
      // Companion reloaded mid-cast: status broadcasts don't carry the
      // stream url (PROTOCOL.md keeps status lightweight), so there's
      // nothing to resume with until something is cast again.
      MX.toast(false, "Can't resume after a reload — pick something from the library again.");
    }
  });

  el.remoteStop.addEventListener('click', function () {
    relay.sendCommand('stop');
    nowCasting = null;
  });

  el.remoteBack.addEventListener('click', function () {
    relay.sendCommand('seek', { positionSec: Math.max(0, lastPositionSec - 10) });
  });

  el.remoteFwd.addEventListener('click', function () {
    relay.sendCommand('seek', { positionSec: lastPositionSec + 10 });
  });

  // --- boot ---

  if (jellyfin.isAuthenticated()) {
    el.loginServer.value = jellyfin.getSession().serverUrl || '';
  }

  relay.connect();
  route();
  // stremio.html's "remote" link lands here.
  if (location.hash === '#remote' && MX.view) MX.view.show('remote');
});
