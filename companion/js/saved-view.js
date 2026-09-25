'use strict';

// The "saved" tab: everything the resolver keeps on disk, from its GET
// /cache: films saved from torrents, and videos downloaded from links.
// Each has a thumbnail (a frame from 10% in, made by the resolver),
// its size, a cast button and a delete button. A film that was
// converted down for the TV (4K) also has "copy 4K link": the untouched
// original, to open in VLC or another player. A 4K film saved before
// conversions existed has "optimize for TV (1080p)" instead, which makes
// that copy from the file on disk, no download. A film that stopped part
// way (stopped by hand, failed, server restarted) is listed as partial,
// with how much is saved: "continue" picks the download up from there,
// cast plays the saved part, delete throws it away. Delete asks for a second
// tap before it deletes, since there's no undo.
//
// Items are kept and updated in place, keyed per video, so polling
// doesn't reload every thumbnail (same reason as downloads-view.js).
function createSavedView(resolver, container, opts) {
  var onCast = opts.onCast;
  var CONFIRM_MS = 4000;
  var groups = {};
  var filterText = '';
  var lastCache = null;

  var filter = document.createElement('input');
  filter.className = 'mx-input cn-saved-filter';
  filter.type = 'search';
  filter.placeholder = 'filter by title';
  filter.setAttribute('aria-label', 'filter saved videos by title');
  filter.addEventListener('input', function () {
    filterText = filter.value.trim().toLowerCase();
    if (lastCache) render(lastCache);
  });
  container.appendChild(filter);

  function formatBytes(n) {
    if (!n) return '0 MB';
    if (n >= 1e9) return (n / 1e9).toFixed(2) + ' GB';
    return Math.max(1, Math.round(n / 1e6)) + ' MB';
  }

  function formatClock(totalSec) {
    var s = Math.floor(totalSec || 0);
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (sec < 10 ? '0' : '') + sec;
  }

  function formatDate(ts) {
    if (!ts || ts < 1e12) return '';
    var d = new Date(ts);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function makeGroup(kind, label) {
    var section = document.createElement('div');
    section.className = 'cn-saved-group';
    section.innerHTML =
      '<h3 class="cn-saved-head"><span></span><span class="cn-saved-total"></span></h3>' +
      '<div class="cn-saved-list"></div>' +
      '<span class="mx-empty"></span>';
    section.querySelector('.cn-saved-head span').textContent = label;
    container.appendChild(section);
    return {
      kind: kind,
      section: section,
      total: section.querySelector('.cn-saved-total'),
      list: section.querySelector('.cn-saved-list'),
      empty: section.querySelector('.mx-empty'),
      items: {}
    };
  }

  function makeItem(group) {
    var item = document.createElement('div');
    item.className = 'cn-saved-item';
    item.innerHTML =
      '<div class="cn-saved-thumb"><img alt="" loading="lazy" decoding="async"></div>' +
      '<div class="cn-saved-body">' +
        '<span class="cn-saved-title"></span>' +
        '<span class="cn-saved-meta"></span>' +
        '<div class="cn-saved-actions">' +
          '<button class="mx-btn mx-sm mx-primary" type="button" hidden>continue</button>' +
          '<button class="mx-btn mx-sm mx-primary" type="button">cast</button>' +
          '<button class="mx-btn mx-sm" type="button" hidden>copy 4K link</button>' +
          '<button class="mx-btn mx-sm" type="button" hidden>optimize for TV (1080p)</button>' +
          '<button class="mx-btn mx-sm" type="button">delete</button>' +
        '</div>' +
      '</div>';
    var buttons = item.querySelectorAll('button');
    var it = {
      item: item,
      img: item.querySelector('img'),
      thumb: item.querySelector('.cn-saved-thumb'),
      title: item.querySelector('.cn-saved-title'),
      meta: item.querySelector('.cn-saved-meta'),
      resume: buttons[0],
      cast: buttons[1],
      original: buttons[2],
      optimize: buttons[3],
      del: buttons[4],
      entry: null,
      confirmTimer: null
    };
    it.img.addEventListener('error', function () {
      it.thumb.classList.add('cn-saved-nothumb');
    });
    it.img.addEventListener('load', function () {
      it.thumb.classList.remove('cn-saved-nothumb');
    });
    it.cast.addEventListener('click', function () {
      var entry = it.entry;
      if (!entry.needsTvCopy) {
        onCast(entry.streamUrl, entry.title || 'video');
        return;
      }
      // Too big for the TV: make the 1080p copy and cast it as it's made.
      it.cast.disabled = true;
      it.cast.textContent = 'starting…';
      MX.toast(true, 'Making the 1080p copy; the TV starts in a few seconds.');
      resolver.castOptimized(entry.key).then(function (result) {
        onCast(result.streamUrl, entry.title || 'video');
      }).catch(function (err) {
        MX.toast(false, err.message);
      }).then(function () {
        it.cast.disabled = false;
        update(it, it.entry);
      });
    });
    it.resume.addEventListener('click', function () {
      var entry = it.entry;
      it.resume.disabled = true;
      resolver.resumeSaved(entry.key).then(function () {
        MX.toast(true, 'Continuing: ' + (entry.title || 'film') + ' (see downloads)');
        entry.canResume = false;
        entry.downloading = true;
        update(it, entry);
      }).catch(function (err) {
        MX.toast(false, err.message);
      }).then(function () {
        it.resume.disabled = false;
      });
    });
    it.original.addEventListener('click', function () {
      copyLink(it.entry.originalUrl);
    });
    it.optimize.addEventListener('click', function () {
      var entry = it.entry;
      it.optimize.disabled = true;
      resolver.optimizeSaved(entry.key).then(function (state) {
        MX.toast(true, 'Optimizing for TV: ' + (entry.title || 'film'));
        entry.canOptimize = false;
        entry.optimize = state;
        update(it, entry);
      }).catch(function (err) {
        MX.toast(false, err.message);
      }).then(function () {
        it.optimize.disabled = false;
      });
    });
    it.del.addEventListener('click', function () {
      if (!it.del.classList.contains('cn-confirm')) {
        it.del.classList.add('cn-confirm');
        it.del.textContent = 'sure? delete';
        clearTimeout(it.confirmTimer);
        it.confirmTimer = setTimeout(function () {
          it.del.classList.remove('cn-confirm');
          it.del.textContent = 'delete';
        }, CONFIRM_MS);
        return;
      }
      clearTimeout(it.confirmTimer);
      it.del.disabled = true;
      it.del.textContent = 'deleting…';
      var entry = it.entry;
      resolver.deleteSaved(group.kind, entry.key).then(function () {
        MX.toast(true, 'Deleted: ' + (entry.title || 'video'));
        it.item.remove();
        delete group.items[entry.key];
        if (lastCache) {
          var field = group.kind === 'torrents' ? 'torrents' : 'entries';
          lastCache[field] = (lastCache[field] || []).filter(function (e) { return e.key !== entry.key; });
          render(lastCache);
        }
      }).catch(function (err) {
        it.del.disabled = false;
        it.del.classList.remove('cn-confirm');
        it.del.textContent = 'delete';
        MX.toast(false, err.message);
      });
    });
    return it;
  }

  // The clipboard API only exists on https or localhost; the companion is
  // usually plain http on the LAN, so fall back to a box to copy from.
  function copyLink(url) {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(url).then(function () {
        MX.toast(true, 'Copied the 4K link. Open it in VLC: Media > Open Network Stream.');
      }, function () {
        window.prompt('Copy this link, then open it in VLC (Media > Open Network Stream):', url);
      });
      return;
    }
    window.prompt('Copy this link, then open it in VLC (Media > Open Network Stream):', url);
  }

  function update(it, entry) {
    it.entry = entry;
    it.title.textContent = entry.title || entry.sourceUrl || 'video';
    it.title.title = entry.title || entry.sourceUrl || '';
    var meta = [formatBytes(entry.bytes)];
    if (entry.height) {
      meta.unshift(entry.height + 'p' + (entry.originalUrl ? ' (TV: 1080p)' : entry.needsTvCopy ? ', TV gets 1080p' : ''));
    }
    if (entry.partial) {
      var part = entry.durationSec
        ? formatClock(entry.savedSec) + ' of ' + formatClock(entry.durationSec) +
          ' (' + Math.floor(Math.min(100, (entry.savedSec / entry.durationSec) * 100)) + '%)'
        : formatClock(entry.savedSec) + ' saved';
      meta.push((entry.downloading ? 'downloading: ' : 'partial: ') + part);
    }
    var opt = entry.optimize;
    if (opt && opt.state === 'running') meta.push('optimizing for TV ' + Math.floor(opt.pct || 0) + '%');
    else if (opt && opt.state === 'queued') meta.push('optimizing for TV: queued');
    else if (opt && opt.state === 'error') meta.push('optimize failed: ' + opt.error);
    var date = formatDate(entry.createdAt);
    if (date) meta.push('saved ' + date);
    it.meta.textContent = meta.join(' · ');
    it.original.hidden = !entry.originalUrl;
    it.resume.hidden = !entry.canResume;
    // The server refuses to delete a film that's downloading right now.
    it.del.hidden = !!entry.downloading || !!(opt && (opt.state === 'running' || opt.state === 'queued'));
    it.cast.classList.toggle('mx-primary', !entry.canResume);
    // Never cast a film bigger than the TV plays: for one of those, cast
    // makes the 1080p copy and plays that (see the click handler).
    if (!it.cast.disabled) it.cast.textContent = entry.needsTvCopy ? 'cast (1080p)' : 'cast';
    it.optimize.hidden = !(entry.canOptimize || (opt && opt.state === 'error'));
    it.optimize.textContent = opt && opt.state === 'error' ? 'try optimizing again' : 'optimize for TV (1080p)';
    if (entry.thumbUrl && it.img.getAttribute('src') !== entry.thumbUrl) it.img.src = entry.thumbUrl;
  }

  function renderGroup(group, entries) {
    var total = entries.reduce(function (n, e) { return n + (e.bytes || 0); }, 0);
    group.total.textContent = entries.length ? entries.length + ' · ' + formatBytes(total) : '';
    var shown = filterText
      ? entries.filter(function (e) { return (e.title || e.sourceUrl || '').toLowerCase().indexOf(filterText) !== -1; })
      : entries;
    var keep = {};
    shown.forEach(function (entry, i) {
      keep[entry.key] = true;
      var it = group.items[entry.key] || (group.items[entry.key] = makeItem(group));
      update(it, entry);
      if (group.list.children[i] !== it.item) group.list.insertBefore(it.item, group.list.children[i] || null);
    });
    Object.keys(group.items).forEach(function (key) {
      if (!keep[key]) {
        group.items[key].item.remove();
        delete group.items[key];
      }
    });
    group.empty.textContent = entries.length ? (shown.length ? '' : 'nothing matches.') : 'nothing saved yet.';
    group.empty.hidden = !!shown.length;
  }

  // Takes the resolver's /cache body ({ entries, torrents }).
  function render(cache) {
    lastCache = cache;
    if (!groups.torrents) {
      groups.torrents = makeGroup('torrents', 'films (torrents)');
      groups.media = makeGroup('media', 'videos (links)');
    }
    renderGroup(groups.torrents, cache.torrents || []);
    renderGroup(groups.media, cache.entries || []);
  }

  return { render: render };
}
