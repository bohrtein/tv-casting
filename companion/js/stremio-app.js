'use strict';

// DOM wiring for stremio.html: browse addon catalogs, open a title, pick
// a stream, cast it. Same relay/resolver clients as the main companion
// page -- this page is just another companion as far as the relay knows.
document.addEventListener('DOMContentLoaded', function () {
  var stremio = createStremioClient(APP_CONFIG);
  var resolver = createResolverClient(APP_CONFIG);
  var CATALOG_KEY = 'tvc.stremio.catalog';

  var addons = [];
  var catalogs = []; // [{ addon, catalog }] -- the <select>'s options, by index
  var browse = { skip: 0, seen: {}, token: 0 };
  var detail = { token: 0, meta: null };
  var nowCasting = null; // {url, title} of the last thing this page cast

  var el = {
    relayChip: document.getElementById('relay-chip'),
    relayChipLabel: document.getElementById('relay-chip-label'),
    viewBrowse: document.getElementById('view-browse'),
    viewDetail: document.getElementById('view-detail'),
    browseSearch: document.getElementById('browse-search'),
    browseCatalog: document.getElementById('browse-catalog'),
    browseReadout: document.getElementById('browse-readout'),
    browseResults: document.getElementById('browse-results'),
    browseMore: document.getElementById('browse-more'),
    detailBack: document.getElementById('detail-back'),
    detailBg: document.getElementById('detail-bg'),
    detailPoster: document.getElementById('detail-poster'),
    detailTitle: document.getElementById('detail-title'),
    detailInfo: document.getElementById('detail-info'),
    detailDesc: document.getElementById('detail-desc'),
    episodesPanel: document.getElementById('episodes-panel'),
    episodesSeason: document.getElementById('episodes-season'),
    episodesList: document.getElementById('episodes-list'),
    streamsTitle: document.getElementById('streams-title'),
    streamsReadout: document.getElementById('streams-readout'),
    streamsList: document.getElementById('streams-list'),
    nowPlaying: document.getElementById('now-playing'),
    npReadout: document.getElementById('np-readout'),
    npPlayPause: document.getElementById('np-playpause'),
    npStop: document.getElementById('np-stop'),
    addonsList: document.getElementById('addons-list'),
    addonsUrl: document.getElementById('addons-url'),
    addonsReadout: document.getElementById('addons-readout'),
    addonsAdd: document.getElementById('addons-add'),
    addonsServer: document.getElementById('addons-server'),
    addonsServerSave: document.getElementById('addons-server-save')
  };

  function escapeHtml(s) {
    var div = document.createElement('div');
    div.textContent = s == null ? '' : String(s);
    return div.innerHTML;
  }

  function setReadout(target, message, isError) {
    target.textContent = message;
    target.className = isError ? 'mx-readout mx-err' : 'mx-readout';
    target.style.display = message ? 'block' : 'none';
  }

  function setRelayChip(state, label) {
    el.relayChip.setAttribute('data-mx-state', state);
    el.relayChipLabel.textContent = label;
  }

  // --- relay ---

  var relay = createRelayClient(APP_CONFIG, {
    onConnected: function () { setRelayChip('busy', 'connected'); },
    onDisconnected: function () { setRelayChip('err', 'reconnecting…'); },
    onJoined: function () { setRelayChip('ok', 'connected'); },
    onStatus: renderStatus,
    onError: function (msg) {
      if (msg.code !== 'TV_NOT_FOUND') return;
      setRelayChip('err', 'no tv');
      MX.toast(false, 'No TV is connected right now.');
    }
  });

  function castToTv(url, title) {
    if (!relay.sendCommand('play', { url: url, title: title })) {
      MX.toast(false, 'Not connected to the relay yet, try again in a moment.');
      return;
    }
    nowCasting = { url: url, title: title };
    MX.toast(true, 'Casting: ' + title);
  }

  // --- views (browse <-> detail), with the phone's back button working ---

  function showView(name) {
    el.viewBrowse.classList.toggle('cn-hidden', name !== 'browse');
    el.viewDetail.classList.toggle('cn-hidden', name !== 'detail');
    window.scrollTo(0, 0);
  }

  function detailHash(type, id) {
    return '#' + encodeURIComponent(type) + '/' + encodeURIComponent(id);
  }

  function parseHash() {
    var m = /^#([^/]+)\/(.+)$/.exec(location.hash);
    return m ? { type: decodeURIComponent(m[1]), id: decodeURIComponent(m[2]) } : null;
  }

  window.addEventListener('popstate', function () {
    var target = parseHash();
    if (target) openDetail(target.type, target.id, null, false);
    else showView('browse');
  });

  el.detailBack.addEventListener('click', function () {
    if (history.state && history.state.stremioDetail) history.back();
    else {
      history.replaceState(null, '', location.pathname);
      showView('browse');
    }
  });

  // --- browse ---

  function yearOf(meta) {
    return meta.releaseInfo || meta.year || '';
  }

  function posterTile(meta) {
    var tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'mx-tile cn-poster';
    var lead = meta.poster
      ? '<span class="mx-media"><img loading="lazy" alt="" src="' + escapeHtml(meta.poster) + '"></span>'
      : '<span class="cn-poster-blank">' + escapeHtml((meta.name || '?').charAt(0)) + '</span>';
    tile.innerHTML =
      '<span class="mx-slot-lead">' + lead + '</span>' +
      '<span class="mx-slot-main">' +
        '<span class="mx-slot-title">' + escapeHtml(meta.name) + '</span>' +
        '<span class="mx-slot-meta">' + escapeHtml([yearOf(meta), meta.type].filter(Boolean).join(' · ')) + '</span>' +
      '</span>';
    tile.addEventListener('click', function () { openDetail(meta.type, meta.id, meta, true); });
    return tile;
  }

  function appendPosters(grid, metas) {
    metas.forEach(function (meta) {
      if (!meta || !meta.id || browse.seen[meta.type + ':' + meta.id]) return;
      browse.seen[meta.type + ':' + meta.id] = true;
      grid.appendChild(posterTile(meta));
    });
  }

  function newGrid() {
    var grid = document.createElement('div');
    grid.className = 'mx-view-grid cn-posters';
    return grid;
  }

  function renderCatalogOptions() {
    var saved;
    try { saved = localStorage.getItem(CATALOG_KEY); } catch (e) { saved = null; }
    el.browseCatalog.innerHTML = '';
    var selected = 0;
    // Name the addon only when catalogs come from more than one.
    var multi = catalogs.some(function (c) { return c.addon !== catalogs[0].addon; });
    catalogs.forEach(function (c, i) {
      var opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = (c.catalog.name || c.catalog.id) + ' · ' + c.catalog.type +
        (multi ? ' (' + c.addon.manifest.name + ')' : '');
      el.browseCatalog.appendChild(opt);
      if (saved === c.addon.url + '|' + c.catalog.type + '|' + c.catalog.id) selected = i;
    });
    el.browseCatalog.value = String(selected);
    el.browseCatalog.disabled = catalogs.length === 0;
  }

  function currentCatalog() {
    return catalogs[Number(el.browseCatalog.value)] || null;
  }

  function loadCatalogPage(reset) {
    var c = currentCatalog();
    if (!c) {
      el.browseResults.innerHTML = '';
      el.browseMore.classList.add('cn-hidden');
      setReadout(el.browseReadout, 'No catalogs yet — add an addon (Cinemeta has them).', true);
      return;
    }
    var token = ++browse.token;
    var grid;
    if (reset) {
      browse.skip = 0;
      browse.seen = {};
      el.browseResults.innerHTML = '';
      grid = newGrid();
      el.browseResults.appendChild(grid);
      setReadout(el.browseReadout, 'loading…', false);
    } else {
      grid = el.browseResults.querySelector('.cn-posters');
    }
    el.browseMore.disabled = true;
    stremio.getCatalog(c.addon, c.catalog, browse.skip).then(function (metas) {
      if (token !== browse.token) return;
      setReadout(el.browseReadout, reset && !metas.length ? 'This catalog is empty.' : '', false);
      appendPosters(grid, metas);
      browse.skip += metas.length;
      el.browseMore.disabled = false;
      el.browseMore.classList.toggle('cn-hidden', metas.length === 0);
    }).catch(function (err) {
      if (token !== browse.token) return;
      el.browseMore.disabled = false;
      setReadout(el.browseReadout, err.message, true);
    });
  }

  function runSearch(query) {
    var token = ++browse.token;
    browse.seen = {};
    el.browseMore.classList.add('cn-hidden');
    el.browseResults.innerHTML = '';
    setReadout(el.browseReadout, 'searching…', false);
    stremio.search(addons, query).then(function (groups) {
      if (token !== browse.token) return;
      setReadout(el.browseReadout, groups.length ? '' : 'Nothing found for "' + query + '".', false);
      groups.forEach(function (g) {
        var heading = document.createElement('h3');
        heading.className = 'cn-section-title';
        heading.textContent = (g.catalog.name || g.catalog.id) + ' · ' + g.catalog.type;
        var grid = newGrid();
        el.browseResults.appendChild(heading);
        el.browseResults.appendChild(grid);
        appendPosters(grid, g.metas);
      });
    });
  }

  el.browseCatalog.addEventListener('change', function () {
    var c = currentCatalog();
    if (c) {
      try { localStorage.setItem(CATALOG_KEY, c.addon.url + '|' + c.catalog.type + '|' + c.catalog.id); } catch (e) {}
    }
    el.browseSearch.value = '';
    loadCatalogPage(true);
  });

  el.browseMore.addEventListener('click', function () { loadCatalogPage(false); });

  var searchTimer = null;
  el.browseSearch.addEventListener('input', function () {
    clearTimeout(searchTimer);
    var q = el.browseSearch.value.trim();
    searchTimer = setTimeout(function () {
      if (q.length >= 2) runSearch(q);
      else if (!q) loadCatalogPage(true);
    }, 400);
  });

  // --- detail ---

  function fillHero(meta) {
    el.detailTitle.textContent = meta.name || '';
    var info = [yearOf(meta), meta.runtime, (meta.genres || meta.genre || []).slice(0, 3).join(', ')];
    if (meta.imdbRating) info.push('IMDb ' + meta.imdbRating);
    el.detailInfo.textContent = info.filter(Boolean).join(' · ');
    el.detailDesc.textContent = meta.description || '';
    if (meta.poster) {
      el.detailPoster.src = meta.poster;
      el.detailPoster.style.display = '';
    } else {
      el.detailPoster.removeAttribute('src');
      el.detailPoster.style.display = 'none';
    }
    var bg = meta.background || meta.poster;
    el.detailBg.style.backgroundImage = bg ? 'url("' + bg.replace(/"/g, '%22') + '")' : 'none';
  }

  function openDetail(type, id, preview, push) {
    if (push) history.pushState({ stremioDetail: true }, '', detailHash(type, id));
    var token = ++detail.token;
    detail.meta = null;
    lastStreams = null;
    showView('detail');
    fillHero(preview || { name: '' });
    el.episodesPanel.classList.add('cn-hidden');
    el.streamsList.innerHTML = '';
    el.streamsTitle.textContent = 'streams';
    setReadout(el.streamsReadout, 'loading…', false);

    whenAddonsReady.then(function () {
      return stremio.getMeta(addons, type, id);
    }).then(function (meta) {
      if (token !== detail.token) return;
      meta = meta || preview || { id: id, type: type, name: id };
      detail.meta = meta;
      fillHero(meta);
      var videos = meta.videos || [];
      if (type !== 'movie' && videos.length) {
        renderSeasons(meta, videos);
        el.streamsTitle.textContent = 'streams';
        setReadout(el.streamsReadout, 'Pick an episode.', false);
      } else {
        loadStreams(type, meta.id || id, meta.name || id);
      }
    });
  }

  function seasonLabel(n) {
    return n === 0 ? 'specials' : 'season ' + n;
  }

  function renderSeasons(meta, videos) {
    var seasons = {};
    videos.forEach(function (v) {
      var s = typeof v.season === 'number' ? v.season : 0;
      (seasons[s] = seasons[s] || []).push(v);
    });
    // Real seasons first, in order; specials (season 0) last.
    var keys = Object.keys(seasons).map(Number).sort(function (a, b) {
      return (a === 0) - (b === 0) || a - b;
    });
    el.episodesSeason.innerHTML = '';
    keys.forEach(function (k) {
      var opt = document.createElement('option');
      opt.value = String(k);
      opt.textContent = seasonLabel(k) + ' (' + seasons[k].length + ')';
      el.episodesSeason.appendChild(opt);
    });
    el.episodesSeason.onchange = function () {
      renderEpisodes(meta, seasons[Number(el.episodesSeason.value)]);
    };
    el.episodesPanel.classList.remove('cn-hidden');
    renderEpisodes(meta, seasons[keys[0]]);
  }

  function episodeCode(v) {
    var ep = v.episode != null ? v.episode : v.number;
    if (v.season == null || ep == null) return '';
    return 'S' + (v.season < 10 ? '0' : '') + v.season + 'E' + (ep < 10 ? '0' : '') + ep;
  }

  function renderEpisodes(meta, list) {
    el.episodesList.innerHTML = '';
    (list || []).slice().sort(function (a, b) {
      return (a.episode || a.number || 0) - (b.episode || b.number || 0);
    }).forEach(function (v) {
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'cn-row';
      var aired = v.released ? String(v.released).slice(0, 10) : '';
      row.innerHTML =
        '<span class="cn-row-name">' + escapeHtml([episodeCode(v), v.name || v.title].filter(Boolean).join(' · ')) + '</span>' +
        '<span class="mx-badge">' + escapeHtml(aired || 'episode') + '</span>';
      row.addEventListener('click', function () {
        [].forEach.call(el.episodesList.children, function (r) { r.classList.remove('mx-selected'); });
        row.classList.add('mx-selected');
        var label = meta.name + (episodeCode(v) ? ' ' + episodeCode(v) : '') + (v.name || v.title ? ' — ' + (v.name || v.title) : '');
        loadStreams(meta.type || 'series', v.id, label);
        el.streamsTitle.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      el.episodesList.appendChild(row);
    });
  }

  // --- streams ---

  var streamsToken = 0;
  var lastStreams = null; // {type, id, title} -- re-asked when the addon list changes

  function loadStreams(type, id, title) {
    lastStreams = { type: type, id: id, title: title };
    var token = ++streamsToken;
    el.streamsTitle.textContent = 'streams' + (title && title !== (detail.meta && detail.meta.name) ? ' — ' + title : '');
    el.streamsList.innerHTML = '';
    setReadout(el.streamsReadout, 'asking your stream addons…', false);
    stremio.getStreams(addons, type, id).then(function (result) {
      if (token !== streamsToken) return;
      if (!result.addonCount) {
        setReadout(el.streamsReadout, 'None of your addons provide streams for this. Add a stream addon under "addons".', true);
        return;
      }
      var msg = result.streams.length ? '' : 'No streams found.';
      if (result.errors.length) msg = (msg ? msg + ' ' : '') + 'Failed: ' + result.errors.join('; ');
      setReadout(el.streamsReadout, msg, !result.streams.length);
      result.streams.forEach(function (s) { el.streamsList.appendChild(streamRow(s, title)); });
    });
  }

  function firstLine(text) {
    return String(text || '').split('\n')[0];
  }

  function streamRow(stream, title) {
    var castable = stremio.toCastable(stream);
    var row = document.createElement('button');
    row.type = 'button';
    row.className = 'cn-row cn-stream';
    var name = String(stream.name || stream.addonName || 'stream').replace(/\n+/g, ' · ');
    var desc = stream.title || stream.description || '';
    if (castable.kind === 'unsupported') desc = (desc ? desc + '\n' : '') + '✕ ' + castable.reason;
    var kind = stream.infoHash || /^magnet:/i.test(stream.url || '') ? 'torrent'
      : stream.ytId ? 'youtube' : stream.url ? 'link' : 'other';
    row.innerHTML =
      '<span class="cn-stream-main">' +
        '<span class="cn-row-name">' + escapeHtml(name) + '</span>' +
        '<span class="cn-stream-desc">' + escapeHtml(desc) + '</span>' +
      '</span>' +
      '<span class="mx-badge">' + escapeHtml(kind) + '</span>';
    row.title = firstLine(desc);
    if (castable.kind === 'unsupported') {
      row.disabled = true;
      return row;
    }
    row.addEventListener('click', function () { castStream(castable, title); });
    return row;
  }

  function castStream(castable, title) {
    if (castable.kind === 'direct') {
      castToTv(castable.url, title);
      return;
    }
    // YouTube: same resolver the link tab uses, which hands back an MP4.
    setReadout(el.streamsReadout, 'looking up that video…', false);
    resolver.resolve(castable.url, function (job) {
      var pct = typeof job.progress === 'number' ? ' ' + Math.round(job.progress) + '%' : '';
      setReadout(el.streamsReadout, job.status === 'downloading' ? 'downloading…' + pct : 'looking up that video…', false);
    }).then(function (result) {
      setReadout(el.streamsReadout, '', false);
      castToTv(result.streamUrl, title);
    }).catch(function (err) {
      setReadout(el.streamsReadout, err.message, true);
    });
  }

  // --- now playing ---

  function formatTime(totalSec) {
    var m = Math.floor(totalSec / 60);
    var s = Math.floor(totalSec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function renderStatus(msg) {
    if (msg.state === 'tv_offline') {
      nowCasting = null;
      setRelayChip('err', 'tv offline');
      el.nowPlaying.classList.add('cn-hidden');
      return;
    }
    var label;
    if (msg.state === 'error') {
      label = (msg.title ? msg.title + ': ' : '') + (msg.error ? msg.error.message : 'error');
    } else {
      label = (msg.title ? msg.title + ' — ' : '') + msg.state;
      if (typeof msg.positionSec === 'number') {
        label += ' (' + formatTime(msg.positionSec) +
          (msg.durationSec ? ' / ' + formatTime(msg.durationSec) : '') + ')';
      }
    }
    setReadout(el.npReadout, label, msg.state === 'error');
    var hasMedia = msg.state !== 'idle' && msg.state !== 'stopped';
    el.nowPlaying.classList.toggle('cn-hidden', !hasMedia);
    el.npPlayPause.textContent = (msg.state === 'playing' || msg.state === 'buffering') ? 'pause' : 'play';
    if (msg.state === 'stopped') nowCasting = null;
  }

  el.npPlayPause.addEventListener('click', function () {
    if (el.npPlayPause.textContent === 'pause') {
      relay.sendCommand('pause');
    } else if (nowCasting) {
      relay.sendCommand('play', { url: nowCasting.url, title: nowCasting.title });
    } else {
      // Same limitation as the main page: status doesn't carry the url.
      MX.toast(false, "Can't resume after a reload — pick the stream again.");
    }
  });

  el.npStop.addEventListener('click', function () {
    relay.sendCommand('stop');
    nowCasting = null;
  });

  // --- addons sheet ---

  function renderAddonsList() {
    el.addonsList.innerHTML = '';
    if (!addons.length) {
      el.addonsList.innerHTML = '<span class="mx-empty">no addons.</span>';
    }
    addons.forEach(function (addon) {
      var row = document.createElement('div');
      row.className = 'cn-row';
      var m = addon.manifest;
      var what = m
        ? (m.resources || []).map(function (r) { return typeof r === 'string' ? r : r.name; }).join(', ')
        : 'failed to load — ' + addon.error;
      row.innerHTML =
        '<span class="cn-stream-main">' +
          '<span class="cn-row-name">' + escapeHtml(m ? m.name : addon.url) + '</span>' +
          '<span class="cn-stream-desc">' + escapeHtml(what) + '</span>' +
        '</span>';
      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'mx-btn mx-sm';
      remove.textContent = 'remove';
      remove.addEventListener('click', function () {
        stremio.removeAddon(addon.url);
        reloadAddons();
      });
      row.appendChild(remove);
      el.addonsList.appendChild(row);
    });
  }

  el.addonsAdd.addEventListener('click', function () {
    var input = el.addonsUrl.value.trim();
    if (!input) return;
    el.addonsAdd.disabled = true;
    setReadout(el.addonsReadout, 'loading manifest…', false);
    Promise.resolve().then(function () {
      return stremio.addAddon(input);
    }).then(function (addon) {
      el.addonsAdd.disabled = false;
      el.addonsUrl.value = '';
      setReadout(el.addonsReadout, '', false);
      MX.toast(true, 'Added ' + addon.manifest.name);
      reloadAddons();
    }).catch(function (err) {
      el.addonsAdd.disabled = false;
      setReadout(el.addonsReadout, err.message, true);
    });
  });

  el.addonsServer.value = stremio.getServerUrl();
  el.addonsServerSave.addEventListener('click', function () {
    var url = el.addonsServer.value.trim().replace(/\/+$/, '');
    if (url && !/^https?:\/\//i.test(url)) {
      MX.toast(false, 'The server URL starts with http://');
      return;
    }
    stremio.setServerUrl(url);
    MX.toast(true, url ? 'Streaming server saved' : 'Streaming server cleared');
    // Stream rows were built against the old server; rebuild them.
    var target = parseHash();
    if (target && !el.viewDetail.classList.contains('cn-hidden')) openDetail(target.type, target.id, detail.meta, false);
  });

  // --- boot ---

  var whenAddonsReady;

  function reloadAddons() {
    whenAddonsReady = stremio.loadAddons().then(function (list) {
      addons = list;
      catalogs = stremio.browsableCatalogs(addons);
      renderAddonsList();
      renderCatalogOptions();
      var q = el.browseSearch.value.trim();
      if (q.length >= 2) runSearch(q);
      else loadCatalogPage(true);
      // A title left open (e.g. the "no stream addons" message) asks the
      // new addon list straight away instead of needing to be reopened.
      if (lastStreams && !el.viewDetail.classList.contains('cn-hidden')) {
        loadStreams(lastStreams.type, lastStreams.id, lastStreams.title);
      }
    });
    return whenAddonsReady;
  }

  relay.connect();
  reloadAddons();
  var initial = parseHash();
  if (initial) openDetail(initial.type, initial.id, null, false);
});
