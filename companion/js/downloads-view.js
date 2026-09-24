'use strict';

// Everything the resolver is downloading, as Matrix progress bars with
// cast and cancel buttons: YouTube/links (downloaded before playing) and
// torrents (saved on the server while the TV plays them, resolver/README.md
// "Torrents"). Shared by index.html's downloads tab and stremio.html.
// Cast shows once a download is playable, which for a torrent is while
// it's still saving; opts.onCast(streamUrl, title) does the casting.
//
// render(jobs, saved) can also take the films saved from torrents
// (resolver.listSavedFilms()): they stay listed, castable, after their
// download has dropped off the job list.
//
// `panel` is hidden while there's nothing to show. With
// opts.emptyNotice it's the other way round: `panel` is an "empty"
// notice, shown only while there's nothing.
//
// Rows are kept and updated in place, keyed per download: rebuilding
// them on every poll restarted the bars' animation, so they looked like
// they kept resetting.
function createDownloadsView(resolver, panel, list, opts) {
  var emptyNotice = !!(opts && opts.emptyNotice);
  var onCast = (opts && opts.onCast) || null;
  var KEEP_MS = 120000; // how long a finished download stays listed
  var rows = {};

  function formatClock(totalSec) {
    var s = Math.floor(totalSec || 0);
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (sec < 10 ? '0' : '') + sec;
  }

  function formatBytes(n) {
    if (!n) return '0 MB';
    if (n >= 1e9) return (n / 1e9).toFixed(2) + ' GB';
    return Math.round(n / 1e6) + ' MB';
  }

  function keyOf(job) {
    return job.torrentKey || job.id;
  }

  // Still has a yt-dlp/ffmpeg running on the server (so it can be
  // cancelled). A torrent is "ready" while it keeps downloading.
  function isRunning(job) {
    if (job.status === 'starting' || job.status === 'downloading') return true;
    return job.kind === 'torrent' && job.status === 'ready' && !job.complete;
  }

  function torrentDetail(job) {
    if (job.complete) {
      return (job.fromCache ? 'already saved' : 'fully saved') +
        (job.bytes ? ' · ' + formatBytes(job.bytes) : '') +
        (job.durationSec ? ' · ' + formatClock(job.durationSec) : '');
    }
    if (job.phase !== 'saving') return 'finding peers…';
    var parts = [];
    if (typeof job.progress === 'number' && job.durationSec) {
      parts.push(Math.floor(job.progress) + '%');
      parts.push(formatClock(job.savedSec) + ' of ' + formatClock(job.durationSec));
    } else {
      parts.push(formatClock(job.savedSec) + ' saved');
    }
    parts.push(formatBytes(job.bytes));
    parts.push((job.bytesPerSec ? (job.bytesPerSec / 1e6).toFixed(1) : '0.0') + ' MB/s');
    if (job.status === 'ready') parts.push('playable');
    return parts.join(' · ');
  }

  function detail(job) {
    if (job.status === 'cancelled') return 'cancelled';
    if (job.status === 'error') return 'failed: ' + (job.error || 'unknown error');
    if (job.kind === 'torrent') return torrentDetail(job);
    if (job.status === 'starting') return 'looking up that video…';
    if (job.status === 'downloading') {
      return 'downloading' + (typeof job.progress === 'number' ? ' ' + Math.floor(job.progress) + '%' : '…');
    }
    return job.fromCache ? 'already downloaded' : 'downloaded';
  }

  // How full the bar is, or null when there's no real number yet (a full
  // striped bar then, not a made-up percentage).
  function percent(job) {
    if (!isRunning(job)) return 100;
    if (job.kind === 'torrent') {
      return job.phase === 'saving' && typeof job.progress === 'number' && job.durationSec ? job.progress : null;
    }
    return job.status === 'downloading' && typeof job.progress === 'number' ? job.progress : null;
  }

  function makeRow() {
    var item = document.createElement('div');
    item.className = 'cn-dl-item';
    item.innerHTML =
      '<div class="cn-dl-head">' +
        '<span class="cn-dl-title"></span>' +
        '<button class="mx-btn mx-sm mx-primary cn-dl-cast" type="button" hidden>cast</button>' +
        '<button class="mx-btn mx-sm cn-dl-cancel" type="button">cancel</button>' +
      '</div>' +
      '<div class="mx-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100">' +
        '<div class="mx-progress-fill"></div>' +
      '</div>' +
      '<div class="cn-dl-detail"></div>';
    var row = {
      item: item,
      title: item.querySelector('.cn-dl-title'),
      cast: item.querySelector('.cn-dl-cast'),
      cancel: item.querySelector('.cn-dl-cancel'),
      bar: item.querySelector('.mx-progress'),
      fill: item.querySelector('.mx-progress-fill'),
      detail: item.querySelector('.cn-dl-detail'),
      job: null
    };
    row.cast.addEventListener('click', function () {
      if (onCast && row.job && row.job.streamUrl) onCast(row.job.streamUrl, row.job.title || 'download');
    });
    row.cancel.addEventListener('click', function () {
      var job = row.job;
      row.cancel.disabled = true;
      row.cancel.textContent = 'cancelling…';
      resolver.cancel(job.id).then(function () {
        MX.toast(true, 'Cancelled: ' + (job.title || 'download'));
        refreshSoon();
      }).catch(function (err) {
        row.cancel.disabled = false;
        row.cancel.textContent = 'cancel';
        MX.toast(false, err.message);
      });
    });
    return row;
  }

  function update(row, job) {
    var failed = job.status === 'error' || job.status === 'cancelled';
    var running = isRunning(job);
    var pct = percent(job);
    row.job = job;
    row.title.textContent = job.title || job.sourceUrl || 'download';
    row.fill.style.width = (pct == null ? 100 : pct).toFixed(1) + '%';
    row.fill.classList.toggle('mx-busy', running);
    row.fill.classList.toggle('mx-ok', !running && !failed);
    row.fill.classList.toggle('mx-err', failed);
    if (pct != null && running) row.bar.setAttribute('aria-valuenow', String(Math.round(pct)));
    else row.bar.removeAttribute('aria-valuenow');
    row.detail.textContent = detail(job);
    row.cancel.hidden = !running;
    row.cast.hidden = !onCast || job.status !== 'ready' || !job.streamUrl;
    if (running && row.cancel.textContent !== 'cancelling…') row.cancel.disabled = false;
  }

  // A saved film shaped like a finished torrent job, so it renders the
  // same way (full green bar, "fully saved · size", cast button).
  function savedJob(film) {
    return {
      id: 'saved:' + film.key,
      torrentKey: film.key,
      kind: 'torrent',
      status: 'ready',
      complete: true,
      title: film.title,
      bytes: film.bytes,
      streamUrl: film.streamUrl
    };
  }

  // Takes /jobs (newest first), and optionally the saved films. Returns
  // true while anything is running, so the caller can poll faster.
  function render(jobs, saved) {
    var now = Date.now();
    var seen = {};
    var shown = jobs.filter(function (job) {
      var key = keyOf(job);
      if (seen[key]) return false; // cast twice: only the latest
      seen[key] = true;
      return isRunning(job) || now - (job.finishedAt || job.createdAt || 0) < KEEP_MS;
    });
    var listed = {};
    shown.forEach(function (job) { listed[keyOf(job)] = true; });
    (saved || []).forEach(function (film) {
      if (!listed[film.key]) shown.push(savedJob(film));
    });
    var keep = {};
    shown.forEach(function (job, i) {
      var key = keyOf(job);
      keep[key] = true;
      var row = rows[key] || (rows[key] = makeRow());
      update(row, job);
      if (list.children[i] !== row.item) list.insertBefore(row.item, list.children[i] || null);
    });
    Object.keys(rows).forEach(function (key) {
      if (!keep[key]) {
        rows[key].item.remove();
        delete rows[key];
      }
    });
    panel.classList.toggle('cn-hidden', emptyNotice ? shown.length > 0 : !shown.length);
    return shown.some(isRunning);
  }

  var refreshSoon = function () {};

  return {
    render: render,
    // Lets the page re-poll right after a cancel instead of waiting.
    onRefreshNeeded: function (fn) { refreshSoon = fn; }
  };
}
