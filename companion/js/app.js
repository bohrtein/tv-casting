'use strict';

document.addEventListener('DOMContentLoaded', function () {
  var resolver = createResolverClient(APP_CONFIG);
  var nowCasting = createNowCasting(); // what this browser last cast, see now-casting.js

  var el = {
    relayChip: document.getElementById('relay-chip'),
    relayChipLabel: document.getElementById('relay-chip-label'),
    linkUrl: document.getElementById('link-url'),
    linkTitle: document.getElementById('link-title'),
    linkReadout: document.getElementById('link-readout'),
    linkCast: document.getElementById('link-cast'),
    downloadsList: document.getElementById('downloads-list'),
    downloadsEmpty: document.getElementById('downloads-empty'),
    activityList: document.getElementById('activity-list')
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
      if (msg.state === 'tv_offline') setRelayChip('err', 'tv offline');
      if (msg.state === 'tv_offline' || msg.state === 'stopped') nowCasting.clear();
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

  function castToTv(url, title) {
    if (!relay.sendCommand('play', { url: url, title: title })) { MX.toast(false, 'Relay is disconnected. Try again when connected.'); return; }
    nowCasting.set(url, title);
    MX.toast(true, 'Casting: ' + title);
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
      allJobs = allJobs.filter(ContentPolicy.visible);
      downloadsView.render(allJobs);
      markNewDownloads(allJobs);
      renderActivity(allJobs);
    }).catch(function () {
      // Resolver unreachable -- leave whatever was last rendered up
      // rather than blank a working UI over a transient LAN hiccup.
    });

  }

  pollJobs();
  setInterval(pollJobs, JOBS_POLL_MS);

  document.getElementById('link-download').addEventListener('click', function () {
    var button = this; button.disabled = true;
    resolver.startDownload(el.linkUrl.value.trim(), { category: document.getElementById('link-category').value, title: el.linkTitle.value.trim() })
      .then(function () { setReadout(el.linkReadout, 'Download started. Follow progress in Downloads.', false); })
      .catch(function (err) { setReadout(el.linkReadout, err.message, true); })
      .then(function () { button.disabled = false; });
  });
  function route() {
    var view = location.hash.slice(1) || new URLSearchParams(location.search).get('view') || 'link';
    if (['link', 'downloads', 'activity'].indexOf(view) < 0) view = 'link';
    if (MX.view) MX.view.show(view);
  }
  route();
  window.addEventListener('hashchange', route);
  document.querySelectorAll('[data-mx-tab]').forEach(function (tab) {
    tab.addEventListener('click', function () { history.replaceState(null, '', '#' + tab.getAttribute('data-mx-tab')); });
  });
  relay.connect();
});
