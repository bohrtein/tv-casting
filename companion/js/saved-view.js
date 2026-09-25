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
  var selectedTitle = null;
  var tiles = {};
  var filterText = '';
  var lastCache = null;
  var categories = { movies: 'Movies', series: 'Television series', youtube: 'YouTube videos', porn: 'Porn', other: 'Other videos' };
  var categoryFilter = document.createElement('select');
  categoryFilter.className = 'mx-input cn-saved-filter';
  categoryFilter.setAttribute('aria-label', 'Library category');
  [['all', 'Everything']].concat(Object.keys(categories).map(function (k) { return [k, categories[k]]; })).forEach(function (pair) {
    var option = document.createElement('option'); option.value = pair[0]; option.textContent = pair[1]; categoryFilter.appendChild(option);
  });
  categoryFilter.addEventListener('change', function () { selectedTitle = null; if (lastCache) render(lastCache); });
  container.appendChild(categoryFilter);

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
  var status = document.createElement('p'); status.setAttribute('role', 'status');
  status.textContent = 'Loading library…'; container.appendChild(status);

  var back = document.createElement('button'); back.type = 'button'; back.className = 'mx-back'; back.textContent = '\u2039 Back to library'; back.hidden = true;
  back.addEventListener('click', function () { var key = selectedTitle; selectedTitle = null; render(lastCache); if (tiles[key]) tiles[key].focus(); });
  container.appendChild(back);
  var grid = document.createElement('div'); grid.className = 'mx-view-grid cn-posters'; container.appendChild(grid);

  function updateTile(key, bucket) {
    var tile = tiles[key];
    if (!tile) {
      tile = tiles[key] = document.createElement('button'); tile.type = 'button'; tile.className = 'mx-tile cn-poster';
      tile.innerHTML = '<span class="mx-slot-lead"><span class="mx-media"><img loading="lazy" alt=""></span></span><span class="mx-slot-main"><span class="mx-slot-title"></span><span class="mx-slot-meta"></span></span>';
      tile.addEventListener('click', function () { selectedTitle = key; render(lastCache); back.focus(); });
      grid.appendChild(tile);
    }
    var m = bucket.metadata, saved = bucket.entries.filter(function (e) { return !e.missing; });
    tile.querySelector('.mx-slot-title').textContent = m.name;
    tile.querySelector('.mx-slot-meta').textContent = saved.filter(function (e) { return !e.partial; }).length + ' downloaded \u00b7 ' + saved.filter(function (e) { return e.progress && e.progress.watched; }).length + ' watched';
    var img = tile.querySelector('img'); img.hidden = !m.poster;
    if (m.poster && img.getAttribute('src') !== m.poster) img.src = m.poster;
    tile.hidden = !!filterText && !(m.name || '').toLowerCase().includes(filterText) && !bucket.entries.some(function (e) { return (e.title || '').toLowerCase().includes(filterText); });
  }

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
    section.className = 'cn-saved-group' + (kind === 'youtube' ? ' cn-saved-youtube' : '');
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
      (group.kind === 'youtube'
        ? '<button class="cn-saved-thumb" type="button"><img alt="" loading="lazy" decoding="async"></button>'
        : '<div class="cn-saved-thumb"><img alt="" loading="lazy" decoding="async"></div>') +
      '<div class="cn-saved-body">' +
        '<span class="cn-saved-title"></span>' +
        '<span class="cn-saved-meta"></span>' +
        '<span class="cn-saved-overview" hidden></span>' +
        '<div class="cn-saved-actions">' +
          '<button class="mx-btn mx-sm mx-primary" type="button" hidden>continue</button>' +
          '<button class="mx-btn mx-sm mx-primary" type="button">cast</button>' +
          '<button class="mx-btn mx-sm" type="button" hidden>copy 4K link</button>' +
          '<button class="mx-btn mx-sm" type="button" hidden>optimize for TV (1080p)</button>' +
          '<button class="mx-btn mx-sm" type="button">delete</button>' +
        '</div>' +
      '</div>';
    var buttons = item.querySelectorAll('.cn-saved-actions button');
    var it = {
      item: item,
      img: item.querySelector('img'),
      thumb: item.querySelector('.cn-saved-thumb'),
      title: item.querySelector('.cn-saved-title'),
      meta: item.querySelector('.cn-saved-meta'),
      overview: item.querySelector('.cn-saved-overview'),
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
    if (group.kind === 'youtube') it.thumb.addEventListener('click', function () { it.cast.click(); });
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
      resolver.deleteSaved(entry.kind, entry.key).then(function () {
        MX.toast(true, 'Deleted: ' + (entry.title || 'video'));
        it.item.remove();
        delete group.items[entry.kind + ':' + entry.key];
        if (lastCache) {
          var field = entry.kind === 'torrents' ? 'torrents' : 'entries';
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
    var category = document.createElement('select');
    category.className = 'mx-input'; category.setAttribute('aria-label', 'Saved video category');
    Object.keys(categories).forEach(function (key) {
      var option = document.createElement('option'); option.value = key; option.textContent = categories[key]; category.appendChild(option);
    });
    it.category = category;
    category.addEventListener('change', function () {
      var entry = it.entry;
      resolver.updateLibrary(entry.kind, entry.key, { category: category.value }).then(function () {
        entry.category = category.value; render(lastCache);
      }).catch(function (err) { category.value = entry.category || 'other'; MX.toast(false, err.message); });
    });
    var extra = item.querySelector('.cn-saved-body');
    if (group.kind === 'youtube') {
      var manage = document.createElement('details');
      manage.className = 'cn-saved-manage';
      manage.innerHTML = '<summary>More options</summary><div class="cn-saved-manage-body"></div>';
      extra.appendChild(manage);
      extra = manage.querySelector('.cn-saved-manage-body');
      extra.appendChild(it.del);
    }
    extra.appendChild(category);
    var match = document.createElement('a'); match.className = 'mx-btn mx-sm'; match.textContent = 'Match Stremio metadata';
    it.match = match; extra.appendChild(match);
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
    it.overview.textContent = entry.overview || '';
    it.overview.hidden = !entry.overview;
    it.item.querySelector('.cn-saved-actions').hidden = !!entry.missing;
    it.category.hidden = !!entry.missing;
    it.match.hidden = !!entry.missing;
    if (entry.missing) {
      it.title.textContent = 'S' + entry.metadata.season + ' E' + entry.metadata.episode + ' \u00b7 ' + entry.metadata.episodeTitle;
      it.meta.textContent = 'Not downloaded' + (entry.progress && entry.progress.watched ? ' \u00b7 Watched' : entry.progress && entry.progress.positionSec ? ' \u00b7 Left at ' + formatClock(entry.progress.positionSec) : ' \u00b7 Unwatched') + (entry.released ? ' \u00b7 ' + entry.released.slice(0, 10) : '');
      it.thumb.hidden = !entry.thumbUrl;
      if (entry.thumbUrl && it.img.getAttribute('src') !== entry.thumbUrl) it.img.src = entry.thumbUrl;
      return;
    }
    it.thumb.hidden = false;
    var m = entry.metadata;
    if (m) entry.title = m.name + (m.type === 'series' ? ' · S' + m.season + ' E' + m.episode + ' · ' + (m.episodeTitle || '') : '');
    it.category.value = entry.category || 'other';
    it.match.href = 'stremio.html?matchKind=' + encodeURIComponent(entry.kind) + '&matchKey=' + encodeURIComponent(entry.key);
    it.title.textContent = entry.title || entry.sourceUrl || 'video';
    it.title.title = entry.title || entry.sourceUrl || '';
    if (it.thumb.tagName === 'BUTTON') it.thumb.setAttribute('aria-label', 'Cast ' + it.title.textContent);
    var progress = entry.progress || {};
    var meta = [entry.partial ? 'Partly downloaded' : 'Downloaded', formatBytes(entry.bytes), progress.watched ? 'Watched' : progress.positionSec ? 'Continue from ' + formatClock(progress.positionSec) : 'Unwatched'];
    if (progress.durationSec) meta.push(formatClock(progress.positionSec) + ' / ' + formatClock(progress.durationSec));
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
    it.resume.textContent = 'continue download';
    // The server refuses to delete a film that's downloading right now.
    it.del.hidden = !!entry.downloading || !!(opt && (opt.state === 'running' || opt.state === 'queued'));
    it.cast.classList.toggle('mx-primary', !entry.canResume);
    // Never cast a film bigger than the TV plays: for one of those, cast
    // makes the 1080p copy and plays that (see the click handler).
    if (!it.cast.disabled) it.cast.textContent = entry.needsTvCopy ? 'cast (1080p)' : progress.watched ? 'watch again' : progress.positionSec ? 'continue watching' : 'cast';
    it.optimize.hidden = !(entry.canOptimize || (opt && opt.state === 'error'));
    it.optimize.textContent = opt && opt.state === 'error' ? 'try optimizing again' : 'optimize for TV (1080p)';
    if (entry.thumbUrl && it.img.getAttribute('src') !== entry.thumbUrl) it.img.src = entry.thumbUrl;
  }

  function renderGroup(group, entries) {
    var total = entries.reduce(function (n, e) { return n + (e.bytes || 0); }, 0);
    var savedCount = entries.filter(function (entry) { return !entry.missing; }).length;
    group.total.textContent = entries.length ? savedCount + ' saved · ' + formatBytes(total) : '';
    if (group.season) entries = entries.filter(function (e) { return String(e.metadata.season) === group.season.value; });
    var shown = filterText
      ? entries.filter(function (e) { return (e.title || e.sourceUrl || '').toLowerCase().indexOf(filterText) !== -1; })
      : entries;
    var keep = {};
    shown.forEach(function (entry, i) {
      var key = entry.kind + ':' + entry.key;
      keep[key] = true;
      var it = group.items[key] || (group.items[key] = makeItem(group));
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

  function titleKey(m) { return JSON.stringify([m.type, m.addon || '', m.id]); }
  function fillTitle(group, meta) {
    if (!group.hero) {
      group.hero = document.createElement('section'); group.hero.className = 'mx-hero cn-library-hero';
      group.hero.innerHTML = '<div class="mx-hero-bg"></div><div class="mx-hero-body"><img class="mx-hero-media cn-hero-poster" alt=""><div class="mx-hero-text"><h2 class="mx-title"></h2><p class="cn-library-info"></p><p class="cn-desc"></p><p class="cn-library-cast"></p><a class="mx-btn mx-sm">Browse streams</a></div></div>';
      group.section.insertBefore(group.hero, group.list);
    }
    group.hero.querySelector('h2').textContent = meta.name;
    group.hero.querySelector('.cn-library-info').textContent = [meta.releaseInfo, meta.runtime, (meta.genres || []).join(', '), meta.imdbRating ? 'IMDb ' + meta.imdbRating : ''].filter(Boolean).join(' \u00b7 ');
    group.hero.querySelector('.cn-desc').textContent = meta.description || '';
    group.hero.querySelector('.cn-library-cast').textContent = (meta.cast || []).slice(0, 6).join(', ');
    group.hero.querySelector('a').href = 'stremio.html#' + meta.type + '/' + encodeURIComponent(meta.id);
    var poster = group.hero.querySelector('img'); poster.hidden = !meta.poster;
    if (meta.poster && poster.getAttribute('src') !== meta.poster) poster.src = meta.poster;
    group.hero.querySelector('.mx-hero-bg').style.backgroundImage = meta.background ? 'url(' + JSON.stringify(meta.background) + ')' : 'none';
    if (meta.type === 'series' && !group.season) {
      group.season = document.createElement('select'); group.season.className = 'mx-input mx-select';
      group.season.setAttribute('aria-label', meta.name + ' season');
      group.season.addEventListener('change', function () { render(lastCache); });
      group.section.insertBefore(group.season, group.list);
    }
  }

  // Takes the resolver's /cache body ({ entries, torrents }).
  function render(cache) {
    lastCache = cache;
    var total = (cache.entries || []).length + (cache.torrents || []).length;
    status.textContent = total ? total + ' saved files' : 'No saved files yet. Save a link or choose a Stremio stream to get started.';
    var buckets = {};
    Object.keys(categories).forEach(function (key) { buckets[key] = { label: categories[key], entries: [] }; });
    (cache.entries || []).concat(cache.torrents || []).forEach(function (entry) {
      var category = entry.category || 'other';
      if (!categories[category]) category = 'other';
      if (categoryFilter.value !== 'all' && categoryFilter.value !== category) return;
      var m = entry.metadata;
      var key = (category === 'series' || category === 'movies') && m ? 'title:' + titleKey(m) : category;
      if (!buckets[key]) buckets[key] = { label: 'Television series · ' + m.name, entries: [] };
      buckets[key].entries.push(entry);
    });
    (cache.titles || []).forEach(function (m) {
      var bucket = buckets['title:' + titleKey(m)];
      // Retain a series even when its last episode is deleted.
      if (!bucket && m.type === 'series' && (categoryFilter.value === 'all' || categoryFilter.value === 'series')) {
        var elsewhere = (cache.entries || []).concat(cache.torrents || []).some(function (e) { return e.metadata && titleKey(e.metadata) === titleKey(m) && e.category !== 'series'; });
        if (!elsewhere) bucket = buckets['title:' + titleKey(m)] = { label: 'Television series \u00b7 ' + m.name, entries: [], metadata: m };
      }
      if (!bucket) return;
      bucket.metadata = m;
      if (m.type !== 'series') return;
      (m.videos || []).forEach(function (v) {
        var saved = bucket.entries.find(function (e) { return e.metadata.videoId === v.id || (e.metadata.season === v.season && e.metadata.episode === v.episode); });
        if (saved) { if (v.thumbnail) saved.thumbUrl = v.thumbnail; return; }
        bucket.entries.push({ missing: true, kind: 'missing', key: v.id, title: m.name + ' ' + (v.name || ''),
          metadata: Object.assign({}, m, { videoId: v.id, season: v.season, episode: v.episode, episodeTitle: v.name }),
          overview: v.overview, released: v.released, thumbUrl: v.thumbnail, progress: v.progress });
      });
    });
    if (selectedTitle && !buckets[selectedTitle]) selectedTitle = null;
    back.hidden = !selectedTitle; grid.hidden = !!selectedTitle;
    Object.keys(tiles).forEach(function (key) { tiles[key].hidden = true; });
    Object.keys(buckets).forEach(function (key) {
      var bucket = buckets[key];
      if (!groups[key]) groups[key] = makeGroup(key, bucket.label);
      if (bucket.metadata) { fillTitle(groups[key], bucket.metadata); updateTile(key, bucket); }
      if (bucket.metadata && bucket.metadata.type === 'series') {
        bucket.entries.sort(function (a, b) { return (a.metadata.season === 0) - (b.metadata.season === 0) || a.metadata.season - b.metadata.season || a.metadata.episode - b.metadata.episode; });
        var select = groups[key].season, selected = select.value;
        var seasons = [];
        bucket.entries.forEach(function (e) { if (seasons.indexOf(e.metadata.season) === -1) seasons.push(e.metadata.season); });
        if (select.dataset.seasons !== seasons.join(',')) {
          select.innerHTML = ''; select.dataset.seasons = seasons.join(',');
          seasons.forEach(function (n) { var option = document.createElement('option'); option.value = n; option.textContent = n === 0 ? 'Specials' : 'Season ' + n; select.appendChild(option); });
          if (seasons.indexOf(Number(selected)) !== -1) select.value = selected;
        }
      }
      groups[key].section.hidden = !bucket.entries.length || (bucket.metadata ? selectedTitle !== key : !!selectedTitle);
      renderGroup(groups[key], bucket.entries);
    });
    Object.keys(groups).forEach(function (key) { if (!buckets[key]) { groups[key].section.hidden = true; renderGroup(groups[key], []); } });
  }

  return { render: render, error: function (err) { status.textContent = 'Library unavailable: ' + err.message; } };
}
