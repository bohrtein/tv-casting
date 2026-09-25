'use strict';

// The home page's library: the files saved on the resolver at home, grouped
// by LibraryModel into one poster per movie, series or video. Tapping a
// poster opens a sheet with its saved files (episodes in order for a series),
// each with play and the usual file actions. No Stremio account or addon is
// involved; the resolver is the only source.
function createHomeLibrary(resolver, el, opts) {
  var SORT_KEY = 'tvc.home.library.sort';
  var TYPE_KEY = 'tvc.home.library.type';
  var section = ContentPolicy.mode();
  var items = null;
  var signature = '';
  var viewSignature = null;
  var openKey = null;
  var timer = null;

  function escapeHtml(s) {
    var div = document.createElement('div');
    div.textContent = s == null ? '' : String(s);
    return div.innerHTML;
  }
  function setReadout(target, message, isError) {
    target.textContent = message || '';
    target.className = isError ? 'mx-readout mx-err' : 'mx-readout';
    target.style.display = message ? 'block' : 'none';
  }
  function stored(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function store(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* private mode */ } }
  function option(select, value, label) {
    var opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    select.appendChild(opt);
  }
  function episodeCode(season, episode) {
    if (season == null || episode == null) return '';
    return 'S' + (season < 10 ? '0' : '') + season + 'E' + (episode < 10 ? '0' : '') + episode;
  }

  LibraryModel.SORTS.forEach(function (pair) { option(el.sort, pair[0], pair[1]); });
  el.sort.value = stored(SORT_KEY) || 'lastwatched';
  el.sort.addEventListener('change', function () { store(SORT_KEY, el.sort.value); render(); });
  el.type.addEventListener('change', function () { store(TYPE_KEY, el.type.value); render(); });
  el.filter.addEventListener('input', render);

  function refresh() {
    clearTimeout(timer);
    resolver.getCache().then(function (cache) {
      items = LibraryModel.build(cache, section);
      var next = JSON.stringify(items);
      if (next !== signature) {
        signature = next;
        render();
        if (openKey) renderDetail(openKey);
      }
    }, function (err) {
      if (!items) setReadout(el.readout, 'Library unavailable: ' + err.message, true);
    }).then(function () {
      timer = setTimeout(refresh, document.visibilityState === 'visible' ? 5000 : 30000);
    });
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') refresh(); });

  function poster(item) {
    var tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'mx-tile cn-poster';
    tile.innerHTML =
      '<span class="mx-slot-lead">' + (item.poster
        ? '<span class="mx-media"><img loading="lazy" alt="" src="' + escapeHtml(item.poster) + '"></span>'
        : '<span class="cn-poster-blank">' + escapeHtml((item.name || '?').charAt(0)) + '</span>') + '</span>' +
      '<span class="mx-slot-main">' +
        '<span class="mx-slot-title">' + escapeHtml(item.name) + '</span>' +
        '<span class="mx-slot-meta"></span>' +
      '</span>';
    tile.querySelector('.mx-slot-meta').textContent = item.type === 'series'
      ? [item.saved + ' saved', item.watched ? 'watched' : ''].filter(Boolean).join(' · ')
      : item.watched ? 'watched' : item.files.some(function (e) { return e.partial; }) ? 'partly downloaded' : LibraryModel.TYPE_LABELS[item.type];
    var lead = tile.querySelector('.mx-slot-lead');
    if (item.files.some(function (e) { return e.downloading; })) {
      var badge = document.createElement('span');
      badge.className = 'mx-badge cn-st-badge';
      badge.textContent = 'downloading';
      lead.appendChild(badge);
    }
    var ratio = LibraryModel.progressRatio(item.progress);
    if (ratio > 0 && ratio < 1) {
      var bar = document.createElement('span');
      bar.className = 'cn-st-progress';
      bar.innerHTML = '<span></span>';
      bar.firstChild.style.width = Math.round(ratio * 100) + '%';
      lead.appendChild(bar);
    }
    tile.addEventListener('click', function () { openItem(item.key); });
    return tile;
  }

  function render() {
    if (!items) { setReadout(el.readout, 'loading your library…', false); return; }
    var wanted = el.type.value || stored(TYPE_KEY) || 'all';
    var types = LibraryModel.types(items);
    el.type.innerHTML = '';
    option(el.type, 'all', 'All');
    types.forEach(function (t) { option(el.type, t.value, t.label); });
    el.type.value = types.some(function (t) { return t.value === wanted; }) ? wanted : 'all';

    var list = LibraryModel.filter(items, { type: el.type.value, sort: el.sort.value, text: el.filter.value });
    var next = JSON.stringify([el.type.value, el.sort.value, el.filter.value, signature]);
    if (next === viewSignature) return;
    viewSignature = next;
    setReadout(el.readout, items.length ? (list.length ? '' : 'Nothing matches.')
      : 'Your library is empty. Save a link from tools, or a stream from Stremio, and it shows up here.', false);
    el.grid.innerHTML = '';
    list.forEach(function (item) { el.grid.appendChild(poster(item)); });
  }

  // --- one title's saved files, in a sheet ---

  function openItem(key) {
    openKey = key;
    renderDetail(key);
    MX.sheet.open(el.sheet.id);
  }
  el.sheet.addEventListener('mx:close', function () { openKey = null; });

  function episodeOf(item, entry) {
    var m = entry.metadata || {};
    var video = item.videos.find(function (v) { return v.id === m.videoId; }) || null;
    var season = m.season != null ? m.season : video && video.season;
    var episode = m.episode != null ? m.episode : video && (video.episode != null ? video.episode : video.number);
    return { season: season, episode: episode, name: (video && video.name) || m.episodeTitle || '' };
  }

  function renderDetail(key) {
    var item = items && items.find(function (i) { return i.key === key; });
    if (!item) { MX.sheet.close(el.sheet.id); return; }
    el.detailTitle.textContent = item.name;
    var m = item.metadata || {};
    el.detailInfo.textContent = [LibraryModel.TYPE_LABELS[item.type], m.releaseInfo, m.runtime,
      (m.genres || []).slice(0, 3).join(', ')].filter(Boolean).join(' · ');
    el.detailDesc.textContent = m.description || '';
    el.detailDesc.style.display = m.description ? '' : 'none';
    el.detailFiles.innerHTML = '';

    var files = item.files.map(function (entry) {
      return { entry: entry, ep: item.type === 'series' ? episodeOf(item, entry) : null };
    });
    if (item.type === 'series') {
      files.sort(function (a, b) {
        return ((a.ep.season || 0) === 0) - ((b.ep.season || 0) === 0) ||
          (a.ep.season || 0) - (b.ep.season || 0) || (a.ep.episode || 0) - (b.ep.episode || 0);
      });
    }
    if (!files.length) {
      setReadout(el.detailReadout, 'No episodes of this series are saved right now.', false);
    } else setReadout(el.detailReadout, '', false);

    files.forEach(function (f) {
      var code = f.ep ? episodeCode(f.ep.season, f.ep.episode) : '';
      var title = code ? item.name + ' ' + code : item.name;
      el.detailFiles.appendChild(createLocalFileRow(resolver, f.entry, {
        title: title,
        label: code ? code + (f.ep.name ? ' · ' + f.ep.name : '') : 'Saved file',
        onCast: function (url, castTitle) { MX.sheet.close(el.sheet.id); opts.onCast(url, castTitle); },
        onChanged: refresh
      }));
    });
  }

  render();
  refresh();
  return { refresh: refresh };
}

if (typeof module !== 'undefined') module.exports = createHomeLibrary;
