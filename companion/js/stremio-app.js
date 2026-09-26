'use strict';

// DOM wiring for stremio.html, laid out like Stremio Web: Board, Discover,
// Library, Calendar, Search and Details, plus Addons and Settings. Stremio
// Core supplies catalogs, metadata and streams; the Library is the files
// saved on the resolver, not a Stremio library addon. Routes live in the
// hash (#/discover?..., #/detail/series/tt123/tt123:1:2) so the phone's
// back button works everywhere.
document.addEventListener('DOMContentLoaded', function () {
  var stremio = createStremioCoreClient(APP_CONFIG);
  var resolver = createResolverClient(APP_CONFIG);
  var pageParams = new URLSearchParams(location.search);
  var requestedSection = pageParams.get('section');
  var section = requestedSection ? (requestedSection === 'plus18' ? 'plus18' : 'normal') : ContentPolicy.mode();
  ContentPolicy.setMode(section);
  var matchKind = pageParams.get('matchKind');
  var matchKey = pageParams.get('matchKey');
  var CATALOG_KEY = 'tvc.stremio.catalog';
  var LIBRARY_KEY = 'tvc.stremio.library';
  var browseCache = createStremioBrowseCache(window.fetch.bind(window));
  // Results used to be cached per browser; the server holds them now.
  try { localStorage.removeItem('tvc.stremio.browse.v1'); } catch (e) {}
  var WIDE = window.matchMedia('(min-width: 1024px)');

  var addons = [];
  var catalogs = [];
  var whenAddonsReady = Promise.resolve();
  var addonsError = null;
  var addonsGeneration = 0;
  var nowCasting = createNowCasting();
  var previews = {}; // "type:id" -> catalog meta, shown while the full meta loads
  var current = { view: null, scroll: {} };

  function $(id) { return document.getElementById(id); }
  var el = {
    relayChip: $('relay-chip'), relayChipLabel: $('relay-chip-label'),
    searchForm: $('search-form'), searchInput: $('search-input'), plus18Toggle: $('plus18-toggle'),
    boardRows: $('board-rows'), boardReadout: $('board-readout'),
    discoverType: $('discover-type'), discoverCatalog: $('discover-catalog'), discoverExtra: $('discover-extra'),
    discoverReadout: $('discover-readout'), discoverGrid: $('discover-grid'), discoverMore: $('discover-more'),
    discoverPreview: $('discover-preview'),
    libraryTabs: $('library-tabs'), librarySort: $('library-sort'), libraryFilter: $('library-filter'),
    libraryReadout: $('library-readout'), libraryGrid: $('library-grid'),
    libraryYoutube: $('library-youtube'), libraryYoutubeTitle: $('library-youtube-title'), libraryYtGrid: $('library-yt-grid'),
    calendarTitle: $('calendar-title'), calendarGrid: $('calendar-grid'), calendarReadout: $('calendar-readout'),
    searchRows: $('search-rows'), searchReadout: $('search-readout'),
    searchScope: $('search-scope'), discoverSearchIn: $('discover-search-in'),
    detailBg: $('detail-bg'), detailLogo: $('detail-logo'), detailTitle: $('detail-title'), detailInfo: $('detail-info'),
    detailFacts: $('detail-facts'), detailDesc: $('detail-desc'), detailInLib: $('detail-inlib'),
    detailPosterBtn: $('detail-poster-btn'), detailBackdropBtn: $('detail-backdrop-btn'),
    detailTrailer: $('detail-trailer'), detailImdb: $('detail-imdb'),
    sideEpisodes: $('side-episodes'), episodesSeason: $('episodes-season'), episodesList: $('episodes-list'),
    streamsBack: $('streams-back'), streamsTitle: $('streams-title'), localFiles: $('local-files'),
    streamsAddon: $('streams-addon'), streamsReadout: $('streams-readout'), streamsList: $('streams-list'),
    addonsFilter: $('addons-filter'), addonsList: $('addons-list'), addonsNote: $('addons-section-note'),
    addonsUrl: $('addons-url'), addonsReadout: $('addons-readout'), addonsAdd: $('addons-add'),
    settingsServer: $('settings-server'), settingsReadout: $('settings-readout'),
    savingPanel: $('saving-panel'), savingList: $('saving-list')
  };

  // --- small helpers ---

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
  function hidden(node, value) { node.classList.toggle('cn-hidden', !!value); }
  function option(select, value, label, selected) {
    var opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    if (selected) opt.selected = true;
    select.appendChild(opt);
  }
  function store(key, value) { try { localStorage.setItem(key + '.' + section, value); } catch (e) {} }
  function stored(key) { try { return localStorage.getItem(key + '.' + section); } catch (e) { return null; } }
  function browseScope() {
    return JSON.stringify({
      addons: addons.map(function (item) { return item.url + '@' + (item.manifest && item.manifest.version || ''); }).sort(),
      catalogs: catalogs.map(function (item) { return item.addon.url + '|' + item.catalog.type + '|' + item.catalog.id; }).sort()
    });
  }
  // A row worth caching: loaded, or an addon that simply had nothing to
  // return. Real errors are left out so the next visit retries them.
  function settledRow(item) { return item.state === 'Ready' || item.empty; }
  // A row from one of this section's own addons. Keeps Plus18 from ever
  // showing the normal section's catalogs (and the reverse), including rows
  // an older page version cached without saying which addon they came from.
  function ownRow(item) {
    return !!item && addons.some(function (addon) { return addon.url === item.addonUrl; });
  }
  function ownRows(rows) { return (rows || []).filter(ownRow); }
  function usableCache(rows) { return Array.isArray(rows) && rows.every(ownRow) ? rows : null; }
  function blocked(meta) { return section === 'normal' && ContentPolicy.restricted(meta); }
  function yearOf(meta) { return meta.releaseInfo || meta.year || ''; }
  function typeLabel(type) { return type ? type.charAt(0).toUpperCase() + type.slice(1) : ''; }
  function episodeCode(v) {
    var ep = v.episode != null ? v.episode : v.number;
    if (v.season == null || ep == null) return '';
    return 'S' + (v.season < 10 ? '0' : '') + v.season + 'E' + (ep < 10 ? '0' : '') + ep;
  }
  function detailHref(type, id, videoId) {
    return '#/detail/' + encodeURIComponent(type) + '/' + encodeURIComponent(id) + (videoId ? '/' + encodeURIComponent(videoId) : '');
  }

  function progressBar(ratio) {
    var bar = document.createElement('span');
    bar.className = 'cn-st-progress';
    bar.innerHTML = '<span></span>';
    bar.firstChild.style.width = Math.round(ratio * 100) + '%';
    return bar;
  }

  // One poster, as Stremio shows it: artwork, title, and a progress line.
  function posterTile(opts) {
    var tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'mx-tile cn-poster';
    var image = stremio.largeImage(opts.poster);
    tile.innerHTML =
      '<span class="mx-slot-lead">' + (image
        ? '<span class="mx-media"><img loading="lazy" alt="" src="' + escapeHtml(image) + '"></span>'
        : '<span class="cn-poster-blank">' + escapeHtml((opts.name || '?').charAt(0)) + '</span>') + '</span>' +
      '<span class="mx-slot-main">' +
        '<span class="mx-slot-title">' + escapeHtml(opts.name) + '</span>' +
        (opts.meta ? '<span class="mx-slot-meta">' + escapeHtml(opts.meta) + '</span>' : '') +
      '</span>';
    if (opts.badge) {
      var badge = document.createElement('span');
      badge.className = 'mx-badge cn-st-badge' + (opts.badge === 'saved' ? ' cn-st-badge-saved' : '');
      badge.textContent = opts.badge;
      tile.querySelector('.mx-slot-lead').appendChild(badge);
    }
    if (opts.progress) tile.querySelector('.mx-slot-lead').appendChild(progressBar(opts.progress));
    tile.addEventListener('click', opts.onClick);
    return tile;
  }

  function metaTile(meta, onClick) {
    previews[meta.type + ':' + meta.id] = meta;
    var entry = library.items && LibraryModel.findTitle(library.items, meta.type, meta.id);
    return posterTile({
      name: meta.name, poster: meta.poster, badge: entry ? 'saved' : '',
      meta: [yearOf(meta), meta.imdbRating ? '★ ' + meta.imdbRating : ''].filter(Boolean).join(' · '),
      onClick: onClick || function () { location.hash = detailHref(meta.type, meta.id); }
    });
  }

  // Stremio's horizontal rows: a heading, "see all", and a strip of posters.
  function makeRow(parent, title, href) {
    var row = document.createElement('section');
    row.className = 'cn-st-row';
    row.innerHTML = '<header class="cn-st-row-head"><h3 class="cn-section-title"></h3></header><div class="cn-st-strip"></div>';
    row.querySelector('h3').textContent = title;
    if (href) {
      var all = document.createElement('a');
      all.className = 'mx-btn mx-sm';
      all.href = href;
      all.textContent = 'see all';
      row.querySelector('header').appendChild(all);
    }
    parent.appendChild(row);
    return { row: row, strip: row.querySelector('.cn-st-strip') };
  }

  function catalogRow(parent, rows, item) {
    var key = item.addonUrl + '|' + item.type + '|' + item.id;
    var entry = rows[key];
    if (!entry) {
      entry = rows[key] = makeRow(parent, (item.name || item.id) + ' · ' + typeLabel(item.type),
        '#/discover?' + new URLSearchParams({ addon: item.addonUrl, type: item.type, catalog: item.id }).toString());
      entry.state = null;
    }
    if (entry.state === item.state) return;
    entry.state = item.state;
    entry.strip.innerHTML = '';
    var metas = item.metas.filter(function (meta) { return meta && meta.id && !blocked(meta); });
    // Like Stremio, catalogs that failed or came back empty are left out.
    entry.row.hidden = item.state === 'Err' || (item.state === 'Ready' && !metas.length);
    if (item.state === 'Loading') {
      for (var i = 0; i < 6; i++) {
        var ghost = document.createElement('span');
        ghost.className = 'mx-skeleton cn-st-ghost';
        entry.strip.appendChild(ghost);
      }
      return;
    }
    metas.slice(0, 20).forEach(function (meta) { entry.strip.appendChild(metaTile(meta)); });
  }

  // --- relay, now playing, downloads ---

  function setRelayChip(state, label) {
    el.relayChip.setAttribute('data-mx-state', state);
    el.relayChipLabel.textContent = label;
  }
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

  function castToTv(url, title, subtitleUrl) {
    var payload = { url: url, title: title };
    if (subtitleUrl) payload.subtitleUrl = subtitleUrl;
    if (!relay.sendCommand('play', payload)) {
      MX.toast(false, 'Not connected to the relay yet, try again in a moment.');
      return;
    }
    nowCasting.set(url, title);
    MX.toast(true, 'Casting: ' + title);
    remoteSheet.open();
  }

  function openHereReceiver(castable, title, subtitleUrl) {
    var receiver;
    try { receiver = relay.openLocalReceiver(); }
    catch (err) {
      if (err.code !== 'POPUP_BLOCKED') { setReadout(el.streamsReadout, err.message, true); return null; }
      // Too long since the click (slow subtitle lookup): ask for another tap.
      setReadout(el.streamsReadout, ' ', false);
      el.streamsReadout.textContent = '';
      var again = document.createElement('button');
      again.type = 'button';
      again.className = 'mx-btn mx-sm mx-primary';
      again.textContent = 'open the receiver to play';
      again.addEventListener('click', function () {
        setReadout(el.streamsReadout, '', false);
        castStreamReady(castable, title, subtitleUrl, false, true);
      });
      el.streamsReadout.appendChild(again);
      return null;
    }
    receiver.catch(function (err) { setReadout(el.streamsReadout, err.message, true); });
    return receiver;
  }

  function playHere(receiver, url, title, subtitleUrl) {
    setReadout(el.streamsReadout, 'waiting for the receiver tab…', false);
    receiver.then(function () {
      setReadout(el.streamsReadout, '', false);
      castToTv(url, title, subtitleUrl);
    }, function () {});
  }

  function playLocalHere(url, title) {
    var receiver;
    try { receiver = relay.openLocalReceiver(); }
    catch (err) { MX.toast(false, err.message); return; }
    MX.toast(true, 'Opening this device…');
    receiver.then(function () {
      castToTv(url, title);
    }, function (err) {
      MX.toast(false, err.message);
    });
  }

  // The remote sheet at the bottom (remote-sheet.js, remote-controls.js).
  var remoteSheet = createRemoteSheet($('remote-sheet'));
  var remote = createRemoteControls(relay, nowCasting);
  function renderStatus(msg) {
    if (msg.state === 'tv_offline') setRelayChip('err', 'tv offline');
    remote.render(msg);
    if (msg.state === 'stopped') refreshLibrary();
  }

  var savingTimer = null;
  var downloads = createDownloadsView(resolver, el.savingPanel, el.savingList, { onCast: castToTv });
  function refreshSaving() {
    clearTimeout(savingTimer);
    resolver.listJobs().then(function (jobs) { return downloads.render(jobs.filter(ContentPolicy.visible)); }, function () { return false; })
      .then(function (busy) { savingTimer = setTimeout(refreshSaving, busy ? 2000 : 15000); });
  }
  downloads.onRefreshNeeded(refreshSaving);

  // --- your library (the resolver's saved files) ---

  var library = { cache: null, items: null, error: null, signature: '', waiting: [] };
  var libraryTimer = null;
  function refreshLibrary() {
    clearTimeout(libraryTimer);
    return resolver.getCache().then(function (cache) {
      library.cache = cache;
      library.error = null;
      library.items = LibraryModel.build(cache, section);
    }, function (err) { library.error = err; }).then(function () {
      var signature = JSON.stringify(library.items || []);
      var changed = signature !== library.signature;
      library.signature = signature;
      library.waiting.splice(0).forEach(function (resolve) { resolve(); });
      if (changed) libraryChanged();
      libraryTimer = setTimeout(refreshLibrary, document.visibilityState === 'visible' ? 5000 : 30000);
    });
  }
  function libraryReady() {
    return library.items || library.error ? Promise.resolve() : new Promise(function (resolve) { library.waiting.push(resolve); });
  }
  function libraryChanged() {
    if (current.view === 'board') renderContinueWatching();
    if (current.view === 'library') renderLibrary();
    if (current.view === 'calendar') renderCalendar();
    if (current.view === 'detail') refreshDetailLibrary();
  }

  // --- router ---

  function parseRoute() {
    var hash = location.hash.replace(/^#/, '');
    // Older links (library "browse streams") used #type/id.
    if (hash && hash.charAt(0) !== '/') {
      var legacy = /^([^/?]+)\/(.+)$/.exec(hash);
      if (legacy) return { name: 'detail', type: decodeURIComponent(legacy[1]), id: decodeURIComponent(legacy[2]), params: new URLSearchParams() };
    }
    var q = hash.indexOf('?');
    var parts = (q === -1 ? hash : hash.slice(0, q)).split('/').filter(Boolean).map(decodeURIComponent);
    var params = new URLSearchParams(q === -1 ? '' : hash.slice(q + 1));
    var route = { name: parts[0] || 'board', params: params };
    if (route.name === 'detail') { route.type = parts[1]; route.id = parts[2]; route.videoId = parts[3] || null; }
    if (route.name === 'library') route.type = parts[1] || null;
    if (['board', 'discover', 'library', 'calendar', 'search', 'detail', 'addons', 'settings'].indexOf(route.name) === -1) route.name = 'board';
    if (route.name === 'detail' && !(route.type && route.id)) route.name = 'board';
    return route;
  }

  function showView(name) {
    if (current.view && current.view !== name) current.scroll[current.view] = window.scrollY;
    var changed = current.view !== name;
    if (current.view === 'search' && name !== 'search') {
      cancelSearchWork();
      ++searchState.token;
      ++searchState.libraryToken;
    }
    current.view = name;
    document.querySelectorAll('[data-view]').forEach(function (view) { hidden(view, view.getAttribute('data-view') !== name); });
    document.querySelectorAll('.mx-nav-item').forEach(function (item) {
      if (item.getAttribute('data-route') === name) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });
    if (name !== 'detail') { ++subtitleToken; MX.sheet.close('subtitles-sheet'); }
    if (name !== 'search' && document.activeElement !== el.searchInput) el.searchInput.value = '';
    if (name !== 'search' && name !== 'discover') el.searchInput.placeholder = defaultSearchPlaceholder;
    if (changed) window.scrollTo(0, name === 'detail' || name === 'search' ? 0 : current.scroll[name] || 0);
  }

  function render() {
    var route = parseRoute();
    showView(route.name);
    if (route.name === 'board') renderBoard();
    else if (route.name === 'discover') renderDiscover(route);
    else if (route.name === 'library') renderLibrary(route);
    else if (route.name === 'calendar') renderCalendar();
    else if (route.name === 'search') renderSearch(route.params.get('q') || '', routeSearchScope(route.params));
    else if (route.name === 'detail') renderDetail(route);
    else if (route.name === 'addons') renderAddons();
  }
  window.addEventListener('hashchange', render);

  // --- Board ---

  var board = { key: null, rows: {}, token: 0, cw: null };
  var boardRenderQueue = [];
  var boardRenderFrame = 0;

  function flushBoardRenderQueue() {
    boardRenderFrame = 0;
    var painted = 0;
    while (boardRenderQueue.length && painted < 2) {
      var job = boardRenderQueue.shift();
      if (job.token !== board.token || current.view !== 'board') continue;
      catalogRow(el.boardRows, board.rows, job.item);
      painted++;
    }
    if (boardRenderQueue.length) boardRenderFrame = requestAnimationFrame(flushBoardRenderQueue);
  }

  function queueBoardRows(rows, token) {
    rows.forEach(function (item) {
      var key = rowKey(item);
      boardRenderQueue = boardRenderQueue.filter(function (job) {
        return job.token !== token || rowKey(job.item) !== key;
      });
      boardRenderQueue.push({ item: item, token: token });
    });
    if (!boardRenderFrame) boardRenderFrame = requestAnimationFrame(flushBoardRenderQueue);
  }
  function renderContinueWatching() {
    if (!board.cw) return;
    var list = library.items ? LibraryModel.continueWatching(library.items) : [];
    board.cw.row.hidden = !list.length;
    board.cw.strip.innerHTML = '';
    list.slice(0, 20).forEach(function (entry) {
      var item = entry.item, video = entry.video;
      board.cw.strip.appendChild(posterTile({
        name: item.name, poster: item.poster,
        meta: video ? [episodeCode(video), entry.progress ? 'continue' : 'next episode'].filter(Boolean).join(' · ') : 'continue',
        progress: entry.progress ? Math.max(0.02, LibraryModel.progressRatio(entry.progress)) : 0,
        onClick: function () {
          location.hash = item.kind === 'title'
            ? detailHref(item.type, item.metadata.id, video && video.id)
            : detailHref('local', item.key);
        }
      }));
    });
  }
  function renderBoard(fresh) {
    var key = section + '|' + addonsGeneration;
    if (board.key === key) { renderContinueWatching(); return; }
    board.key = key;
    board.rows = {};
    var token = ++board.token;
    boardRenderQueue = [];
    if (boardRenderFrame) cancelAnimationFrame(boardRenderFrame);
    boardRenderFrame = 0;
    el.boardRows.innerHTML = '';
    board.cw = makeRow(el.boardRows, 'Continue Watching', '#/library');
    board.cw.row.hidden = true;
    libraryReady().then(function () { if (token === board.token) renderContinueWatching(); });
    setReadout(el.boardReadout, 'loading catalogs…', false);
    $('board-refresh').disabled = true;
    var requestSection = section;
    var scope, fromCache = false;
    whenAddonsReady.then(function () {
      if (token !== board.token) return null;
      if (addonsError) throw addonsError;
      scope = browseScope();
      return fresh ? null : browseCache.get('board', requestSection, scope, '');
    }).then(function (cached) {
      if (token !== board.token) return null;
      if (usableCache(cached)) { fromCache = true; return cached; }
      // No addons: nothing to ask Core for (it would only sit loading).
      if (!addons.length) return [];
      return stremio.getBoard(function (rows) {
        if (token === board.token) queueBoardRows(ownRows(rows), token);
      }, fresh).then(ownRows);
    }).then(function (rows) {
      if (!rows || token !== board.token) return;
      if (!fromCache && addons.length && rows.every(settledRow)) browseCache.put('board', requestSection, scope, '', rows);
      queueBoardRows(rows, token);
      setReadout(el.boardReadout, rows.length ? '' : section === 'plus18'
        ? 'No Plus18 catalogs yet. Install an addon under Addons.'
        : 'No catalogs yet. Install an addon under Addons (Cinemeta has them).', !rows.length);
    }).catch(function (err) {
      if (token !== board.token) return;
      board.key = null;
      setReadout(el.boardReadout, err.message, true);
    }).then(function () {
      if (token === board.token) $('board-refresh').disabled = false;
    });
  }
  $('board-refresh').addEventListener('click', function () {
    board.key = null;
    renderBoard(true);
  });

  // --- Discover ---

  var discover = { key: null, token: 0, skip: 0, seen: {}, loading: false, done: false, selected: null, entry: null, extra: {}, metas: [], filters: [], scope: null };

  function discoverHash(entry, extra) {
    var params = new URLSearchParams({ addon: entry.addon.url, type: entry.catalog.type, catalog: entry.catalog.id });
    Object.keys(extra || {}).forEach(function (name) { params.set('x.' + name, extra[name]); });
    return '#/discover?' + params.toString();
  }

  function renderDiscover(route) {
    whenAddonsReady.then(function () {
      if (current.view !== 'discover' || parseRoute().params.toString() !== route.params.toString()) return;
      if (addonsError) { setReadout(el.discoverReadout, addonsError.message, true); return; }
      if (!catalogs.length) {
        el.discoverGrid.innerHTML = '';
        typePicker.setItems([]);
        typePicker.setLabel('');
        catalogPicker.setItems([]);
        catalogPicker.setLabel('');
        setReadout(el.discoverReadout, section === 'plus18'
          ? 'No Plus18 catalogs yet. Install an addon under Addons.'
          : 'No catalogs yet. Install an addon under Addons (Cinemeta has them).', true);
        return;
      }
      var params = route.params;
      var entry = null;
      if (params.get('catalog')) {
        entry = catalogs.find(function (c) {
          return c.addon.url === params.get('addon') && c.catalog.id === params.get('catalog') && c.catalog.type === params.get('type');
        });
      }
      if (!entry) {
        var saved = stored(CATALOG_KEY);
        entry = catalogs.find(function (c) { return saved === c.addon.url + '|' + c.catalog.type + '|' + c.catalog.id; }) || catalogs[0];
        if (params.get('type')) entry = catalogs.find(function (c) { return c.catalog.type === params.get('type'); }) || entry;
      }
      var extra = {};
      params.forEach(function (value, name) { if (name.indexOf('x.') === 0) extra[name.slice(2)] = value; });
      (entry.catalog.extra || []).forEach(function (item) {
        if (item.isRequired && item.options && item.options.length && !extra[item.name]) extra[item.name] = item.options[0];
      });
      store(CATALOG_KEY, entry.addon.url + '|' + entry.catalog.type + '|' + entry.catalog.id);
      renderDiscoverSelects(entry);
      discover.entry = entry;
      renderSearchScope();
      var key = section + '|' + discoverHash(entry, extra);
      if (key === discover.key) return; // back from a title: keep the grid and scroll
      discover.key = key;
      discover.entry = entry;
      discover.extra = extra;
      discover.scope = browseScope();
      var token = ++discover.token;
      discover.loading = true;
      el.discoverGrid.innerHTML = '';
      hidden(el.discoverPreview, true);
      hidden(el.discoverMore, true);
      setReadout(el.discoverReadout, 'loading…', false);
      browseCache.get('discover', section, discover.scope, key).then(function (cached) {
        if (token !== discover.token) return;
        if (cached) restoreDiscover(cached); else loadDiscoverPage(true);
      });
    });
  }

  // Type and catalog, as the app's own dropdowns (stremio-picker.js); the
  // catalog one has a filter box for addons with long lists.
  var typePicker = createPicker({ name: 'Type', onPick: function (type) {
    var entry = catalogs.find(function (c) { return c.catalog.type === type; });
    if (entry) location.hash = discoverHash(entry, {});
  } });
  el.discoverType.replaceWith(typePicker.root);
  var catalogPicker = createPicker({ name: 'Catalog', filterPlaceholder: 'find a catalog', onPick: function (value) {
    var entry = catalogs[Number(value)];
    if (entry) location.hash = discoverHash(entry, {});
  } });
  el.discoverCatalog.replaceWith(catalogPicker.root);

  function renderDiscoverSelects(entry) {
    var types = [];
    catalogs.forEach(function (c) { if (types.indexOf(c.catalog.type) === -1) types.push(c.catalog.type); });
    typePicker.setItems(types.map(function (type) {
      return { value: type, label: typeLabel(type), selected: type === entry.catalog.type };
    }));
    typePicker.setLabel(typeLabel(entry.catalog.type));
    var sameType = catalogs.filter(function (c) { return c.catalog.type === entry.catalog.type; });
    var multi = sameType.some(function (c) { return c.addon !== sameType[0].addon; });
    catalogPicker.setItems(sameType.map(function (c) {
      return { value: String(catalogs.indexOf(c)), label: c.catalog.name || c.catalog.id,
        detail: multi ? c.addon.manifest.name : '', selected: c === entry };
    }));
    catalogPicker.setLabel(entry.catalog.name || entry.catalog.id);
  }

  function renderDiscoverFilters(filters) {
    el.discoverExtra.innerHTML = '';
    filters.forEach(function (filter) {
      if (!filter.options || !filter.options.length || filter.name === 'skip' || filter.name === 'search') return;
      var picker = createPicker({ name: filter.name, filterPlaceholder: 'find a ' + filter.name, onPick: function (value) {
        var extra = Object.assign({}, discover.extra);
        if (value) extra[filter.name] = value; else delete extra[filter.name];
        location.hash = discoverHash(discover.entry, extra);
      } });
      var chosen = filter.options.find(function (choice) { return choice.selected; });
      picker.setItems(filter.options.map(function (choice) {
        return { value: choice.value == null ? '' : choice.value, label: choice.value == null ? 'all' : choice.value, selected: !!choice.selected };
      }));
      picker.setLabel(typeLabel(filter.name) + ': ' + (chosen && chosen.value != null ? chosen.value : 'all'));
      el.discoverExtra.appendChild(picker.root);
    });
  }

  function appendDiscoverMeta(meta) {
    if (!meta || !meta.id || blocked(meta) || discover.seen[meta.type + ':' + meta.id]) return;
    discover.seen[meta.type + ':' + meta.id] = true;
    var tile = metaTile(meta, function () { selectDiscover(meta, tile); });
    el.discoverGrid.appendChild(tile);
  }
  function restoreDiscover(cached) {
    ++discover.token;
    discover.loading = false;
    discover.skip = cached.skip;
    discover.done = cached.done;
    discover.selected = null;
    discover.seen = {};
    discover.metas = cached.metas.slice();
    discover.filters = cached.filters || [];
    el.discoverGrid.innerHTML = '';
    hidden(el.discoverPreview, true);
    discover.metas.forEach(appendDiscoverMeta);
    renderDiscoverFilters(discover.filters);
    setReadout(el.discoverReadout, !discover.skip ? 'This catalog is empty.' : '', false);
    hidden(el.discoverMore, discover.done || !discover.skip);
    el.discoverMore.disabled = false;
    $('discover-refresh').disabled = false;
  }
  function saveDiscover() {
    browseCache.put('discover', section, discover.scope, discover.key, {
      metas: discover.metas, skip: discover.skip, done: discover.done, filters: discover.filters
    });
  }

  function loadDiscoverPage(reset, fresh) {
    var entry = discover.entry;
    if (!entry || discover.loading && !reset) return;
    var token = ++discover.token;
    if (reset) {
      discover.skip = 0;
      discover.seen = {};
      discover.done = false;
      discover.selected = null;
      discover.metas = [];
      discover.filters = [];
      el.discoverGrid.innerHTML = '';
      hidden(el.discoverPreview, true);
      window.scrollTo(0, 0);
      setReadout(el.discoverReadout, 'loading…', false);
    }
    discover.loading = true;
    $('discover-refresh').disabled = true;
    el.discoverMore.disabled = true;
    stremio.getCatalog(entry.addon, entry.catalog, discover.skip, discover.extra, fresh).then(function (metas) {
      if (token !== discover.token) return;
      setReadout(el.discoverReadout, reset && !metas.length ? 'This catalog is empty.' : '', false);
      discover.metas = discover.metas.concat(metas);
      metas.forEach(appendDiscoverMeta);
      discover.skip += metas.length;
      discover.done = metas.length === 0;
      saveDiscover();
    }).catch(function (err) {
      if (token === discover.token) setReadout(el.discoverReadout, err.message, true);
    }).then(function () {
      if (token !== discover.token) return;
      discover.loading = false;
      $('discover-refresh').disabled = false;
      el.discoverMore.disabled = false;
      hidden(el.discoverMore, discover.done || !discover.skip);
      stremio.getCatalogFilters().then(function (filters) {
        if (token === discover.token) {
          discover.filters = filters;
          renderDiscoverFilters(filters);
          saveDiscover();
        }
      }).catch(function () {});
    });
  }
  el.discoverMore.addEventListener('click', function () { loadDiscoverPage(false); });
  $('discover-refresh').addEventListener('click', function () {
    if (!discover.key) return;
    loadDiscoverPage(true, true);
  });

  // Wide screens: the first tap selects and previews, as in Stremio Web;
  // tapping the selected title (or "show") opens it. Phones open it directly.
  function selectDiscover(meta, tile) {
    if (!WIDE.matches || discover.selected === meta) { location.hash = detailHref(meta.type, meta.id); return; }
    discover.selected = meta;
    el.discoverGrid.querySelectorAll('.mx-selected').forEach(function (node) { node.classList.remove('mx-selected'); });
    tile.classList.add('mx-selected');
    var poster = stremio.largeImage(meta.background || meta.poster);
    el.discoverPreview.innerHTML =
      (poster ? '<img class="cn-st-preview-art" alt="" src="' + escapeHtml(poster) + '">' : '') +
      '<h2 class="mx-title"></h2><p class="cn-st-info"></p><p class="cn-st-desc"></p>' +
      '<div class="cn-np-buttons"><a class="mx-btn mx-primary">show</a></div>';
    el.discoverPreview.querySelector('h2').textContent = meta.name || '';
    el.discoverPreview.querySelector('.cn-st-info').textContent = [yearOf(meta), meta.runtime,
      (meta.genres || []).slice(0, 3).join(', '), meta.imdbRating ? 'IMDb ' + meta.imdbRating : ''].filter(Boolean).join(' · ');
    el.discoverPreview.querySelector('.cn-st-desc').textContent = meta.description || '';
    el.discoverPreview.querySelector('a').href = detailHref(meta.type, meta.id);
    hidden(el.discoverPreview, false);
  }

  // --- Library ---

  (function () {
    LibraryModel.SORTS.forEach(function (pair) { option(el.librarySort, pair[0], pair[1]); });
    el.librarySort.value = stored(LIBRARY_KEY + '.sort') || 'lastwatched';
  })();
  var libraryView = { signature: null };
  function libraryHash(type) {
    return '#/library' + (type && type !== 'all' ? '/' + encodeURIComponent(type) : '');
  }
  el.librarySort.addEventListener('change', function () { store(LIBRARY_KEY + '.sort', el.librarySort.value); renderLibrary(); });
  el.libraryFilter.addEventListener('input', function () { renderLibrary(); });

  function renderLibrary() {
    var route = parseRoute();
    if (!library.items) {
      setReadout(el.libraryReadout, library.error ? 'Library unavailable: ' + library.error.message : 'loading your library…', !!library.error);
      libraryReady().then(function () { if (current.view === 'library') renderLibrary(); });
      return;
    }
    var type = route.type || 'all';
    var list = LibraryModel.filter(library.items, { type: type, sort: el.librarySort.value, text: el.libraryFilter.value });
    var signature = JSON.stringify([type, el.librarySort.value, el.libraryFilter.value, library.signature]);
    if (signature === libraryView.signature) return;
    libraryView.signature = signature;
    renderLibraryTabs(type);
    setReadout(el.libraryReadout, library.items.length ? (list.length ? '' : 'Nothing matches.')
      : 'Your library is empty. Choose a stream from any title to save it here.', false);
    // YouTube videos get their own wide-thumbnail grid (below the posters on All).
    var videos = list.filter(function (item) { return item.type === 'youtube'; });
    list = list.filter(function (item) { return item.type !== 'youtube'; });
    el.libraryYoutube.hidden = !videos.length;
    hidden(el.libraryYoutubeTitle, type === 'youtube');
    el.libraryYtGrid.innerHTML = '';
    videos.forEach(function (item) { el.libraryYtGrid.appendChild(videoCard(item)); });
    el.libraryGrid.innerHTML = '';
    list.forEach(function (item) {
      var meta = item.type === 'series'
        ? [item.saved + ' saved', item.watched ? 'watched' : ''].filter(Boolean).join(' · ')
        : item.watched ? 'watched' : item.files.some(function (e) { return e.partial; }) ? 'partly downloaded' : LibraryModel.TYPE_LABELS[item.type];
      var ratio = LibraryModel.progressRatio(item.progress);
      el.libraryGrid.appendChild(posterTile({
        name: item.name, poster: item.poster, meta: meta,
        progress: ratio > 0 && ratio < 1 ? ratio : 0,
        badge: item.files.some(function (e) { return e.downloading; }) ? 'downloading' : 'saved',
        onClick: function () {
          location.hash = item.kind === 'title' ? detailHref(item.type, item.metadata.id) : detailHref('local', item.key);
        }
      }));
    });
  }

  // All, then one tab per kind of thing saved (Movies, Series, YouTube, …).
  function renderLibraryTabs(type) {
    el.libraryTabs.innerHTML = '';
    [{ value: 'all', label: 'All' }].concat(LibraryModel.types(library.items)).forEach(function (t) {
      var tab = document.createElement('a');
      tab.className = 'mx-tab cn-st-libtab' + (t.value === 'youtube' ? ' cn-st-libtab-yt' : '');
      tab.href = libraryHash(t.value);
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(t.value === type));
      tab.textContent = t.label;
      el.libraryTabs.appendChild(tab);
    });
  }

  function clock(sec) {
    sec = Math.round(sec);
    var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  // One YouTube video, as YouTube lists it: a 16:9 thumbnail with the
  // length in the corner and a progress line, then the title.
  function videoCard(item) {
    var card = document.createElement('button');
    card.type = 'button';
    card.className = 'cn-yt';
    var progress = item.progress || {};
    var ratio = LibraryModel.progressRatio(progress);
    var meta = item.watched ? 'Watched'
      : ratio > 0 ? Math.round(ratio * 100) + '% watched'
      : item.added ? 'Saved ' + new Date(item.added).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
    card.innerHTML =
      '<span class="cn-yt-thumb">' + (item.poster
        ? '<img loading="lazy" alt="" src="' + escapeHtml(item.poster) + '">'
        : '<span class="cn-yt-blank">▶</span>') +
        (progress.durationSec > 0 ? '<span class="cn-yt-length">' + clock(progress.durationSec) + '</span>' : '') +
      '</span>' +
      '<span class="cn-yt-title">' + escapeHtml(item.name) + '</span>' +
      (meta ? '<span class="cn-yt-meta">' + escapeHtml(meta) + '</span>' : '');
    if (ratio > 0 && ratio < 1) card.querySelector('.cn-yt-thumb').appendChild(progressBar(ratio));
    card.addEventListener('click', function () { location.hash = detailHref('local', item.key); });
    return card;
  }

  // --- Calendar ---

  var calendarMonth = new Date();
  calendarMonth = { year: calendarMonth.getFullYear(), month: calendarMonth.getMonth() };
  $('calendar-prev').addEventListener('click', function () { shiftMonth(-1); });
  $('calendar-next').addEventListener('click', function () { shiftMonth(1); });
  function shiftMonth(delta) {
    var d = new Date(calendarMonth.year, calendarMonth.month + delta, 1);
    calendarMonth = { year: d.getFullYear(), month: d.getMonth() };
    renderCalendar();
  }
  function renderCalendar() {
    var first = new Date(calendarMonth.year, calendarMonth.month, 1);
    el.calendarTitle.textContent = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    if (!library.items) {
      setReadout(el.calendarReadout, 'loading your library…', false);
      libraryReady().then(function () { if (current.view === 'calendar') renderCalendar(); });
      return;
    }
    var days = LibraryModel.calendar(library.items, calendarMonth.year, calendarMonth.month);
    var hasSeries = library.items.some(function (item) { return item.kind === 'title' && item.type === 'series'; });
    setReadout(el.calendarReadout, hasSeries ? (Object.keys(days).length ? '' : 'No episodes of your series air this month.')
      : 'Series in your library show their episode release days here.', false);
    el.calendarGrid.innerHTML = '';
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach(function (name) {
      var head = document.createElement('span');
      head.className = 'cn-st-cal-dow';
      head.textContent = name;
      el.calendarGrid.appendChild(head);
    });
    var offset = (first.getDay() + 6) % 7;
    for (var i = 0; i < offset; i++) {
      var pad = document.createElement('span');
      pad.className = 'cn-st-cal-day cn-st-cal-pad';
      el.calendarGrid.appendChild(pad);
    }
    var count = new Date(calendarMonth.year, calendarMonth.month + 1, 0).getDate();
    var today = new Date();
    for (var day = 1; day <= count; day++) {
      var cell = document.createElement('div');
      var list = days[day] || [];
      cell.className = 'cn-st-cal-day' + (list.length ? '' : ' cn-st-cal-empty');
      if (today.getFullYear() === calendarMonth.year && today.getMonth() === calendarMonth.month && today.getDate() === day) {
        cell.classList.add('cn-st-cal-today');
      }
      var date = new Date(calendarMonth.year, calendarMonth.month, day);
      cell.innerHTML = '<span class="cn-st-cal-num"></span>';
      cell.firstChild.textContent = date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
      list.forEach(function (hit) {
        var link = document.createElement('a');
        link.className = 'cn-st-cal-ep';
        link.href = detailHref('series', hit.item.metadata.id, hit.video.id);
        link.textContent = hit.item.name + ' ' + episodeCode(hit.video);
        link.title = hit.video.name || hit.video.title || '';
        cell.appendChild(link);
      });
      el.calendarGrid.appendChild(cell);
    }
  }

  // --- Search ---

  // A search runs in every addon catalog that takes one ("indexes"), plus
  // your library. The #/search?in=... params narrow it to a checked few;
  // no "in" at all means everything.
  var LIBRARY_INDEX = 'library';
  var searchState = { query: null, text: '', token: 0, libraryToken: 0, rows: {}, all: [], fetched: {}, done: false,
    scope: null, mine: null, indexSignature: null, controller: null };
  var searchTimer = null;

  function cancelSearchWork() {
    if (searchState.controller) searchState.controller.abort();
    searchState.controller = null;
    searchRenderQueue = [];
    if (searchRenderFrame) cancelAnimationFrame(searchRenderFrame);
    searchRenderFrame = 0;
  }
  var defaultSearchPlaceholder = el.searchInput.placeholder;

  function searchIndexes() {
    var list = [];
    addons.forEach(function (addon) {
      var manifest = addon.manifest || {};
      (manifest.catalogs || []).forEach(function (catalog) {
        var searchable = (catalog.extra || []).some(function (item) { return item.name === 'search'; }) ||
          (catalog.extraSupported || []).indexOf('search') !== -1;
        if (!searchable) return;
        list.push({ key: addon.url + '|' + catalog.type + '|' + catalog.id, addonUrl: addon.url, type: catalog.type,
          id: catalog.id, catalogName: catalog.name || catalog.id, version: manifest.version || '',
          name: (catalog.name || catalog.id) + ' · ' + typeLabel(catalog.type), addonName: manifest.name || '' });
      });
    });
    return list;
  }
  // Searching from a catalog's "see all": that catalog if it can search,
  // otherwise its addon's search catalogs (many addons keep search separate).
  function catalogSearchScope(entry) {
    var indexes = searchIndexes();
    var key = entry.addon.url + '|' + entry.catalog.type + '|' + entry.catalog.id;
    if (indexes.some(function (index) { return index.key === key; })) return [key];
    var sameAddon = indexes.filter(function (index) { return index.addonUrl === entry.addon.url; });
    var sameType = sameAddon.filter(function (index) { return index.type === entry.catalog.type; });
    var picked = sameType.length ? sameType : sameAddon;
    return picked.length ? picked.map(function (index) { return index.key; }) : null;
  }
  function routeSearchScope(params) { return params.has('in') ? params.getAll('in').filter(Boolean) : null; }
  function inSearchScope(key) { return !searchState.scope || searchState.scope.indexOf(key) !== -1; }
  function rowKey(item) { return item.addonUrl + '|' + item.type + '|' + item.id; }

  function searchHash(q, scope) {
    var params = new URLSearchParams({ q: q });
    if (scope && scope.length) scope.forEach(function (key) { params.append('in', key); });
    else if (scope) params.set('in', '');
    return '#/search?' + params.toString();
  }
  function nextSearchScope() {
    if (current.view === 'search') return routeSearchScope(parseRoute().params);
    if (current.view === 'discover') return discoverSearchScope();
    return null;
  }
  el.searchForm.addEventListener('submit', function (event) {
    event.preventDefault();
    clearTimeout(searchTimer);
    var q = el.searchInput.value.trim();
    if (q) location.hash = searchHash(q, nextSearchScope());
  });
  el.searchInput.addEventListener('input', function () {
    clearTimeout(searchTimer);
    var q = el.searchInput.value.trim();
    searchTimer = setTimeout(function () {
      if (q.length < 2) return;
      // Typing refines one search instead of adding a history entry per letter.
      current.cameFromApp = true;
      var hash = searchHash(q, nextSearchScope());
      if (current.view === 'search') history.replaceState(null, '', location.pathname + location.search + hash);
      else history.pushState(null, '', location.pathname + location.search + hash);
      render();
    }, 500);
  });

  // What to search in, picked on Discover (the "search in" checklist there)
  // and remembered: nothing saved follows the catalog you're looking at,
  // "all" is everything, otherwise the checked keys.
  var SEARCH_IN_KEY = 'tvc.stremio.searchIn';
  function savedSearchIn() {
    try { var value = JSON.parse(stored(SEARCH_IN_KEY)); return value === 'all' || Array.isArray(value) ? value : null; }
    catch (e) { return null; }
  }
  function saveSearchIn(scope) { store(SEARCH_IN_KEY, JSON.stringify(scope || 'all')); }
  function discoverSearchScope() {
    var saved = savedSearchIn();
    if (saved) return saved === 'all' ? null : saved;
    return discover.entry ? catalogSearchScope(discover.entry) : null;
  }

  function scopeChoices() {
    return [{ key: LIBRARY_INDEX, name: 'Your library', addonName: '' }].concat(searchIndexes());
  }
  // Everything checked is the same as no narrowing at all.
  function normalScope(keys) {
    return scopeChoices().every(function (index) { return keys.indexOf(index.key) !== -1; }) ? null : keys;
  }
  function fillScopePicker(picker, scope, prefix) {
    var choices = scopeChoices();
    picker.setItems(choices.map(function (index) {
      return { value: index.key, label: index.name, detail: index.addonName, selected: !scope || scope.indexOf(index.key) !== -1 };
    }));
    var named = scope && scope.length === 1 && choices.find(function (index) { return index.key === scope[0]; });
    picker.setLabel(prefix + (!scope ? 'everything' : !scope.length ? 'nothing' : named ? named.name : scope.length + ' indexes'));
    return !scope ? defaultSearchPlaceholder : !scope.length ? 'Nothing checked to search in'
      : 'Search ' + (named ? named.name : scope.length + ' indexes') + '…';
  }

  var searchScopePicker = createPicker({ name: 'Search in', multi: true, filterPlaceholder: 'find an index',
    className: 'cn-picker-compact', onChange: function (keys) { setSearchScope(normalScope(keys)); } });
  el.searchScope.replaceWith(searchScopePicker.root);
  var discoverScopePicker = createPicker({ name: 'Search in', multi: true, filterPlaceholder: 'find an index',
    onChange: function (keys) { saveSearchIn(normalScope(keys)); renderSearchScope(); },
    actions: [{ label: 'this catalog', onClick: function () { store(SEARCH_IN_KEY, ''); renderSearchScope(); } }] });
  el.discoverSearchIn.replaceWith(discoverScopePicker.root);

  function renderSearchScope() {
    var searchHint = fillScopePicker(searchScopePicker, searchState.scope, 'in: ');
    var discoverHint = fillScopePicker(discoverScopePicker, discoverSearchScope(), 'search in: ');
    if (current.view === 'search') el.searchInput.placeholder = searchHint;
    else if (current.view === 'discover') el.searchInput.placeholder = discoverHint;
  }
  function setSearchScope(scope) {
    saveSearchIn(scope);
    history.replaceState(null, '', location.pathname + location.search + searchHash(parseRoute().params.get('q') || '', scope));
    render();
  }

  var searchRenderQueue = [];
  var searchRenderFrame = 0;

  function flushSearchRenderQueue() {
    searchRenderFrame = 0;
    var painted = 0;
    while (searchRenderQueue.length && painted < 2) {
      var job = searchRenderQueue.shift();
      if (job.token === searchState.token && inSearchScope(rowKey(job.item))) {
        catalogRow(el.searchRows, searchState.rows, job.item);
        painted++;
      }
    }
    if (searchRenderQueue.length) searchRenderFrame = requestAnimationFrame(flushSearchRenderQueue);
  }

  function queueSearchRow(item, token) {
    var key = rowKey(item);
    searchRenderQueue = searchRenderQueue.filter(function (job) {
      return job.token !== token || rowKey(job.item) !== key;
    });
    var job = { item: item, token: token };
    if (item.state === 'Loading') searchRenderQueue.push(job);
    else searchRenderQueue.unshift(job);
    if (!searchRenderFrame) searchRenderFrame = requestAnimationFrame(flushSearchRenderQueue);
  }

  function showSearchRows(rows, token) {
    rows.forEach(function (item) { queueSearchRow(item, token); });
  }
  function updateSearchReadout() {
    var rows = searchState.all.filter(function (item) { return inSearchScope(rowKey(item)); });
    var found = rows.some(function (item) { return item.metas.some(function (meta) { return !blocked(meta); }); }) ||
      !!searchState.mine && !searchState.mine.row.hidden;
    if (searchState.scope && !searchState.scope.length) setReadout(el.searchReadout, 'Check at least one index to search in.', false);
    else if (!searchState.scope && !searchState.all.length && !found) setReadout(el.searchReadout, 'None of your addons can search. Cinemeta can.', true);
    else setReadout(el.searchReadout, found ? '' : 'Nothing found for "' + searchState.text + '"' +
      (searchState.scope ? ' in the checked indexes.' : '.'), !found);
  }

  // Everything uses the same independent per-catalog requests as a scoped
  // search. This keeps one slow addon from delaying rows that already finished.
  function searchEverything(query, token, force, signal) {
    var keys = searchIndexes().map(function (index) { return index.key; });
    return searchChecked(query, keys, token, force, signal);
  }

  // Checked indexes only: ask each of those catalogs itself, side by side,
  // filling its row as it answers. Answers are kept per index, so checking
  // another one later only asks that one.
  function searchChecked(query, scope, token, force, signal) {
    var requestSection = section, queryKey = searchState.query;
    var indexes = searchIndexes().filter(function (index) { return scope.indexOf(index.key) !== -1; });
    var rows = indexes.map(function (index) {
      return searchState.fetched[index.key] || { id: index.id, type: index.type, name: index.catalogName,
        addonName: index.addonName, addonUrl: index.addonUrl, state: 'Loading', metas: [] };
    });
    searchState.all = rows;
    showSearchRows(rows, token);
    return Promise.all(indexes.map(function (index, n) {
      if (searchState.fetched[index.key]) return null;
      var cacheKey = index.key + '@' + index.version;
      return (force ? Promise.resolve(null) : browseCache.get('search-index', requestSection, cacheKey, query, signal)).then(function (cached) {
        if (signal && signal.aborted) return null;
        if (cached) return cached;
        return stremio.searchCatalog(index.addonUrl, index.type, index.id, query, signal).then(function (metas) {
          var row = Object.assign({}, rows[n], { state: 'Ready', metas: metas, empty: !metas.length });
          browseCache.put('search-index', requestSection, cacheKey, query, row);
          return row;
        }, function (err) {
          if (err && err.name === 'AbortError') return null;
          return Object.assign({}, rows[n], { state: 'Err', error: err.message, metas: [] });
        });
      }).then(function (row) {
        if (!row || searchState.query !== queryKey || signal && signal.aborted) return;
        if (row.state === 'Ready') searchState.fetched[index.key] = row;
        if (token !== searchState.token) return;
        rows[n] = row;
        queueSearchRow(row, token);
      });
    })).then(function () {
      return token === searchState.token && !(signal && signal.aborted) ? rows : null;
    });
  }

  function renderSearch(query, scope, force) {
    if (document.activeElement !== el.searchInput) el.searchInput.value = query;
    cancelSearchWork();
    searchState.controller = typeof AbortController === 'function' ? new AbortController() : null;
    var signal = searchState.controller && searchState.controller.signal;
    searchState.scope = scope;
    renderSearchScope();
    var token = ++searchState.token;
    searchState.all = [];
    searchState.done = false;
    if (force || searchState.query !== section + '|' + query) {
      searchState.query = section + '|' + query;
      searchState.text = query;
      searchState.fetched = {};
      searchState.mine = null;
      el.searchRows.innerHTML = '';
      if (query) fillLibraryHits(query);
    } else {
      // Same words, different checklist: keep the library row and what was found.
      Object.keys(searchState.rows).forEach(function (key) { searchState.rows[key].row.remove(); });
      if (searchState.mine) searchState.mine.row.hidden = !searchState.mine.strip.children.length || !inSearchScope(LIBRARY_INDEX);
    }
    searchState.rows = {};
    $('search-refresh').disabled = !query;
    if (!query) { setReadout(el.searchReadout, 'Type a title to search your library and addons.', false); return; }
    if (scope && !scope.length) { searchState.done = true; updateSearchReadout(); return; }
    setReadout(el.searchReadout, 'searching…', false);
    $('search-refresh').disabled = true;
    whenAddonsReady.then(function () {
      if (token !== searchState.token) return null;
      if (addonsError) throw addonsError;
      renderSearchScope();
      var checked = scope && scope.filter(function (key) { return key !== LIBRARY_INDEX; });
      if (checked && !checked.length) return [];
      return checked ? searchChecked(query, checked, token, force, signal) : searchEverything(query, token, force, signal);
    }).then(function (rows) {
      if (!rows || token !== searchState.token) return;
      searchState.all = rows;
      searchState.done = true;
      showSearchRows(rows, token);
      updateSearchReadout();
    }).catch(function (err) {
      if (err && err.name === 'AbortError') return;
      if (token === searchState.token) { searchState.query = null; setReadout(el.searchReadout, err.message, true); }
    }).then(function () {
      if (token === searchState.token && !(signal && signal.aborted)) {
        searchState.controller = null;
        $('search-refresh').disabled = false;
      }
    });
  }

  function fillLibraryHits(query) {
    var libraryToken = ++searchState.libraryToken;
    var mine = searchState.mine = makeRow(el.searchRows, 'Your library', null);
    mine.row.hidden = true;
    libraryReady().then(function () {
      if (libraryToken !== searchState.libraryToken || !library.items) return;
      var hits = LibraryModel.filter(library.items, { text: query, sort: 'az' });
      hits.forEach(function (item) {
        mine.strip.appendChild(posterTile({ name: item.name, poster: item.poster, meta: LibraryModel.TYPE_LABELS[item.type],
          onClick: function () { location.hash = item.kind === 'title' ? detailHref(item.type, item.metadata.id) : detailHref('local', item.key); } }));
      });
      mine.row.hidden = !hits.length || !inSearchScope(LIBRARY_INDEX);
      if (searchState.done) updateSearchReadout();
    });
  }
  $('search-refresh').addEventListener('click', function () {
    var route = parseRoute();
    var query = route.params.get('q') || '';
    if (!query) return;
    renderSearch(query, routeSearchScope(route.params), true);
  });

  // --- Details ---

  var detail = { key: null, token: 0, meta: null, libItem: null, season: null, videoId: null, local: null };
  var streamsToken = 0;
  var subtitleToken = 0;
  var target = null; // { type, id, title } whose streams are shown

  $('detail-back').addEventListener('click', function () {
    if (history.length > 1 && current.cameFromApp) history.back();
    else location.hash = '#/';
  });
  window.addEventListener('hashchange', function () { current.cameFromApp = true; });

  function openViewer(src) {
    if (!src) return;
    $('image-viewer-img').src = src;
    MX.sheet.open('image-viewer');
  }
  el.detailPosterBtn.addEventListener('click', function () { openViewer(el.detailPosterBtn.getAttribute('data-src')); });
  el.detailBackdropBtn.addEventListener('click', function () { openViewer(el.detailBackdropBtn.getAttribute('data-src')); });

  function listOf(value, max) {
    var list = Array.isArray(value) ? value : value ? String(value).split(/\s*,\s*/) : [];
    return list.filter(Boolean).slice(0, max).join(', ');
  }
  function linksOf(meta, category) {
    return (meta.links || []).filter(function (link) { return link.category === category; }).map(function (link) { return link.name; });
  }

  function fillHero(meta) {
    el.detailTitle.textContent = meta.name || '';
    var logo = meta.logo && stremio.largeImage(meta.logo);
    hidden(el.detailLogo, !logo);
    if (logo) el.detailLogo.src = logo; else el.detailLogo.removeAttribute('src');
    var imdbLink = (meta.links || []).find(function (link) { return link.category === 'imdb'; });
    var rating = meta.imdbRating || (imdbLink && /^\d/.test(imdbLink.name) ? imdbLink.name : '');
    var info = [meta.runtime, yearOf(meta), rating ? 'IMDb ' + rating : ''];
    el.detailInfo.textContent = info.filter(Boolean).join(' · ');
    el.detailDesc.textContent = meta.description || '';
    var facts = [
      ['genres', listOf(meta.genres || meta.genre || linksOf(meta, 'Genres'), 5)],
      ['cast', listOf(meta.cast || linksOf(meta, 'Cast'), 6)],
      ['directors', listOf(meta.director || linksOf(meta, 'Directors'), 3)],
      ['writers', listOf(meta.writer || linksOf(meta, 'Writers'), 3)],
      ['country', listOf(meta.country, 3)],
      ['awards', meta.awards]
    ];
    el.detailFacts.innerHTML = facts.filter(function (f) { return f[1]; }).map(function (f) {
      return '<div><dt>' + escapeHtml(f[0]) + '</dt><dd>' + escapeHtml(f[1]) + '</dd></div>';
    }).join('');
    // Genre links open Discover filtered to that genre, as in Stremio.
    var genreLinks = (meta.links || []).filter(function (link) { return link.category === 'Genres' && discoverFromDeepLink(link.url); });
    var genreCell = el.detailFacts.querySelector('dd');
    if (genreLinks.length && genreCell && el.detailFacts.querySelector('dt').textContent === 'genres') {
      genreCell.innerHTML = '';
      genreLinks.slice(0, 5).forEach(function (link, i) {
        if (i) genreCell.appendChild(document.createTextNode(', '));
        var a = document.createElement('a');
        a.href = discoverFromDeepLink(link.url);
        a.textContent = link.name;
        genreCell.appendChild(a);
      });
    }
    var poster = stremio.largeImage(meta.poster);
    hidden(el.detailPosterBtn, !poster);
    el.detailPosterBtn.setAttribute('data-src', poster || '');
    var backdrop = stremio.largeImage(meta.background);
    hidden(el.detailBackdropBtn, !backdrop);
    el.detailBackdropBtn.setAttribute('data-src', backdrop || '');
    var bg = backdrop || poster;
    el.detailBg.style.backgroundImage = bg ? 'url("' + bg.replace(/"/g, '%22') + '")' : 'none';
    var trailer = (meta.trailerStreams || meta.trailers || []).find(function (t) { return t.ytId || t.source; });
    hidden(el.detailTrailer, !trailer);
    if (trailer) el.detailTrailer.href = 'https://www.youtube.com/watch?v=' + encodeURIComponent(trailer.ytId || trailer.source);
    var imdb = /^tt\d+$/.test(meta.imdb_id || meta.id || '') ? 'https://www.imdb.com/title/' + (meta.imdb_id || meta.id) + '/'
      : imdbLink && /^https:\/\/(www\.)?imdb\.com\/title\/tt\d+/.test(imdbLink.url) ? imdbLink.url : '';
    hidden(el.detailImdb, !imdb);
    if (imdb) el.detailImdb.href = imdb;
  }

  // stremio:///discover/<addon>/<type>/<catalog>?genre=X -> our Discover route.
  function discoverFromDeepLink(url) {
    var m = /^stremio:\/\/\/discover\/([^/]+)\/([^/]+)\/([^/?]+)(?:\?(.*))?$/.exec(url || '');
    if (!m) return '';
    var addonUrl = decodeURIComponent(m[1]);
    var entry = catalogs.find(function (c) {
      return c.addon.url === addonUrl && c.catalog.type === decodeURIComponent(m[2]) && c.catalog.id === decodeURIComponent(m[3]);
    });
    if (!entry) return '';
    var extra = {};
    new URLSearchParams(m[4] || '').forEach(function (value, name) { extra[name] = value; });
    return discoverHash(entry, extra);
  }

  function renderDetail(route) {
    if (route.type === 'local') { renderLocalDetail(route.id); return; }
    var key = section + '|' + route.type + '|' + route.id;
    if (detail.key === key && detail.meta) { showVideo(route.videoId); return; }
    detail.key = key;
    detail.local = null;
    detail.meta = null;
    detail.season = null;
    detail.videoId = route.videoId;
    var token = ++detail.token;
    var preview = previews[route.type + ':' + route.id];
    target = null;
    el.streamsList.innerHTML = '';
    el.localFiles.innerHTML = '';
    hidden(el.sideEpisodes, true);
    hidden(el.streamsBack, true);
    hidden(el.streamsAddon, true);
    fillHero(blocked(preview) ? { name: '18+ content hidden' } : preview || { name: '' });
    hidden(el.detailInLib, true);
    setReadout(el.streamsReadout, 'loading…', false);

    Promise.all([whenAddonsReady.then(function () {
      return stremio.getMeta(addons, route.type, route.id).catch(function () { return null; });
    }), libraryReady()]).then(function (values) {
      if (token !== detail.token) return;
      detail.libItem = library.items && LibraryModel.findTitle(library.items, route.type, route.id);
      // A title saved from an addon that is no longer installed still opens
      // from the metadata kept with your library.
      var meta = values[0] || (detail.libItem && detail.libItem.metadata) || preview;
      if (!meta) { fillHero({ name: route.id }); setReadout(el.streamsReadout, 'No addon has details for this title.', true); return; }
      if (blocked(meta)) {
        fillHero({ name: '18+ content hidden' });
        setReadout(el.streamsReadout, 'Switch to Plus18 to open this title.', false);
        return;
      }
      if (!meta.videos && detail.libItem && detail.libItem.videos.length) meta = Object.assign({}, meta, { videos: detail.libItem.videos });
      meta = Object.assign({ type: route.type, id: route.id }, meta);
      detail.meta = meta;
      fillHero(meta);
      hidden(el.detailInLib, !detail.libItem);
      showVideo(parseRoute().videoId);
    });
  }

  function isSeries() {
    return detail.meta && detail.meta.type !== 'movie' && (detail.meta.videos || []).length > 0;
  }

  function showVideo(videoId) {
    var meta = detail.meta;
    if (!meta) return;
    detail.videoId = videoId;
    if (!isSeries()) {
      hidden(el.sideEpisodes, true);
      hidden(el.streamsBack, true);
      hidden(el.streamsTitle.parentNode, false);
      loadStreams(meta.type, meta.id, meta.name);
      return;
    }
    var video = videoId && meta.videos.find(function (v) { return v.id === videoId; });
    if (!video) {
      // Series: the side panel lists episodes until one is chosen.
      ++streamsToken;
      target = null;
      renderSeasons();
      hidden(el.sideEpisodes, false);
      hidden($('side-streams'), true);
      return;
    }
    detail.season = typeof video.season === 'number' ? video.season : 0;
    hidden(el.sideEpisodes, true);
    hidden($('side-streams'), false);
    hidden(el.streamsBack, false);
    var label = meta.name + (episodeCode(video) ? ' ' + episodeCode(video) : '') + (video.name || video.title ? ' — ' + (video.name || video.title) : '');
    loadStreams(meta.type, video.id, label, video);
  }
  el.streamsBack.addEventListener('click', function () {
    if (current.cameFromApp && history.length > 1 && parseRoute().videoId) history.back();
    else location.hash = detailHref(detail.meta.type, detail.meta.id);
  });

  function seasonsOf(meta) {
    var seasons = {};
    meta.videos.forEach(function (v) {
      var s = typeof v.season === 'number' ? v.season : 0;
      (seasons[s] = seasons[s] || []).push(v);
    });
    return seasons;
  }
  function seasonKeys(seasons) {
    // Real seasons first, in order; specials (season 0) last.
    return Object.keys(seasons).map(Number).sort(function (a, b) { return (a === 0) - (b === 0) || a - b; });
  }

  function renderSeasons() {
    var seasons = seasonsOf(detail.meta);
    var keys = seasonKeys(seasons);
    if (detail.season == null || keys.indexOf(detail.season) === -1) {
      // Open where you left off, like Stremio.
      var next = detail.libItem && LibraryModel.continueWatching([detail.libItem])[0];
      detail.season = next && next.video && keys.indexOf(next.video.season) !== -1 ? next.video.season : keys[0];
    }
    el.episodesSeason.innerHTML = '';
    keys.forEach(function (k) {
      option(el.episodesSeason, String(k), (k === 0 ? 'Specials' : 'Season ' + k) + ' (' + seasons[k].length + ')', k === detail.season);
    });
    renderEpisodes(seasons[detail.season]);
  }
  el.episodesSeason.addEventListener('change', function () { detail.season = Number(el.episodesSeason.value); renderSeasons(); });
  function stepSeason(delta) {
    var keys = seasonKeys(seasonsOf(detail.meta));
    var index = keys.indexOf(detail.season) + delta;
    if (index < 0 || index >= keys.length) return;
    detail.season = keys[index];
    renderSeasons();
  }
  $('season-prev').addEventListener('click', function () { stepSeason(-1); });
  $('season-next').addEventListener('click', function () { stepSeason(1); });

  function renderEpisodes(list) {
    el.episodesList.innerHTML = '';
    (list || []).slice().sort(function (a, b) {
      return (a.episode || a.number || 0) - (b.episode || b.number || 0);
    }).forEach(function (v) {
      var status = detail.libItem ? LibraryModel.episodeStatus(detail.libItem, v) : { saved: 'missing', progress: v.progress || null };
      var row = document.createElement('a');
      row.className = 'cn-st-episode';
      row.href = detailHref(detail.meta.type, detail.meta.id, v.id);
      var thumb = v.thumbnail ? stremio.largeImage(v.thumbnail) : '';
      var aired = v.released ? new Date(v.released) : null;
      var upcoming = aired && aired > new Date();
      row.innerHTML =
        '<span class="cn-st-episode-thumb">' + (thumb ? '<img loading="lazy" alt="" src="' + escapeHtml(thumb) + '">' : '') + '</span>' +
        '<span class="cn-st-episode-body">' +
          '<span class="cn-row-name"></span>' +
          '<span class="cn-stream-desc"></span>' +
        '</span>';
      var number = v.episode != null ? v.episode : v.number;
      row.querySelector('.cn-row-name').textContent = (number != null ? number + '. ' : '') + (v.name || v.title || 'Episode');
      row.querySelector('.cn-stream-desc').textContent = [
        aired && !isNaN(aired) ? aired.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }) : '',
        upcoming ? 'upcoming' : '',
        status.progress && status.progress.watched ? 'watched' : ''
      ].filter(Boolean).join(' · ');
      if (status.saved !== 'missing') {
        var badge = document.createElement('span');
        badge.className = 'mx-badge cn-st-badge' + (status.saved === 'saved' ? ' cn-st-badge-saved' : '');
        badge.textContent = status.saved === 'saved' ? 'saved' : 'partial';
        row.querySelector('.cn-st-episode-thumb').appendChild(badge);
      }
      var ratio = LibraryModel.progressRatio(status.progress);
      if (ratio > 0) row.querySelector('.cn-st-episode-thumb').appendChild(progressBar(ratio));
      if (status.progress && status.progress.watched) row.classList.add('cn-st-watched');
      el.episodesList.appendChild(row);
    });
  }

  // Files from your library, above the addon streams.
  function renderLocalFiles(video) {
    el.localFiles.innerHTML = '';
    if (!target || !detail.libItem) return;
    LibraryModel.filesFor(detail.libItem, video ? video.id : null, video).forEach(function (entry) {
      el.localFiles.appendChild(createLocalFileRow(resolver, entry, {
        title: target.title, onCast: castToTv, onPlayHere: playLocalHere, onChanged: refreshLibrary,
        matchHref: 'stremio.html?matchKind=' + encodeURIComponent(entry.kind) + '&matchKey=' + encodeURIComponent(entry.key)
      }));
    });
  }

  function refreshDetailLibrary() {
    if (detail.local) { renderLocalDetail(detail.local, true); return; }
    if (!detail.meta || !library.items) return;
    detail.libItem = LibraryModel.findTitle(library.items, detail.meta.type, detail.meta.id);
    hidden(el.detailInLib, !detail.libItem);
    if (!el.sideEpisodes.classList.contains('cn-hidden')) renderSeasons();
    // Don't rebuild a row while its "more" menu is open.
    if (target && !el.localFiles.querySelector('details[open]')) renderLocalFiles(target.video);
  }

  // A saved file without Stremio metadata (YouTube, links, other videos).
  function renderLocalDetail(key, refresh) {
    detail.key = null;
    detail.meta = null;
    detail.local = key;
    target = null;
    ++detail.token;
    ++streamsToken;
    libraryReady().then(function () {
      if (detail.local !== key) return;
      var item = library.items && library.items.find(function (candidate) { return candidate.key === key; });
      if (refresh && el.localFiles.querySelector('details[open]')) return;
      hidden(el.sideEpisodes, true);
      hidden($('side-streams'), false);
      hidden(el.streamsBack, true);
      hidden(el.streamsAddon, true);
      el.streamsList.innerHTML = '';
      el.localFiles.innerHTML = '';
      if (!item) {
        fillHero({ name: 'Not in your library' });
        setReadout(el.streamsReadout, library.error ? library.error.message : 'This file was deleted.', !!library.error);
        return;
      }
      fillHero({ name: item.name, poster: item.poster, background: item.poster, description: item.files[0] && item.files[0].sourceUrl });
      hidden(el.detailInLib, false);
      el.streamsTitle.textContent = 'your library';
      setReadout(el.streamsReadout, '', false);
      item.files.forEach(function (entry) {
        el.localFiles.appendChild(createLocalFileRow(resolver, entry, {
          title: item.name, label: LibraryModel.TYPE_LABELS[item.type], onCast: castToTv, onPlayHere: playLocalHere, onChanged: refreshLibrary,
          matchHref: 'stremio.html?matchKind=' + encodeURIComponent(entry.kind) + '&matchKey=' + encodeURIComponent(entry.key)
        }));
      });
    });
  }

  // --- streams ---

  var LOW_SEEDERS = 5;
  var lastStreams = [];

  function libraryMetadata() {
    var meta = detail.meta;
    if (!meta || !target || ['movie', 'series'].indexOf(target.type) === -1) return {};
    var m = Object.assign({}, meta, { type: target.type, streamAddons: addons.map(function (a) { return a.url; }), streamingServer: stremio.getServerUrl() });
    if (section === 'plus18') m.addon = 'plus18';
    if (m.type === 'series') {
      var video = (meta.videos || []).find(function (v) { return v.id === target.id; });
      if (!video) return {};
      Object.assign(m, { videoId: video.id, season: video.season, episode: video.episode != null ? video.episode : video.number, episodeTitle: video.name || video.title });
    }
    if (section === 'plus18') return { metadata: m, category: 'plus18' };
    var adult = (meta.genres || []).some(function (g) { return /^(adult|porn|pornography|xxx)$/i.test(g); });
    return adult ? { metadata: m, category: 'porn' } : { metadata: m };
  }

  var matchButton = document.createElement('button');
  matchButton.type = 'button';
  matchButton.className = 'mx-btn mx-primary';
  matchButton.textContent = 'Apply metadata to saved file';
  matchButton.hidden = true;
  el.localFiles.parentNode.insertBefore(matchButton, el.localFiles);
  hidden($('match-banner'), !(matchKind && matchKey));
  matchButton.addEventListener('click', function () {
    var fields = libraryMetadata();
    if (!fields.metadata) return;
    matchButton.disabled = true;
    resolver.updateLibrary(matchKind, matchKey, fields).then(function () {
      setReadout(el.streamsReadout, 'Metadata saved. It is in your Library now.', false);
      refreshLibrary();
    }).catch(function (err) { setReadout(el.streamsReadout, err.message, true); })
      .then(function () { matchButton.disabled = false; });
  });

  function loadStreams(type, id, title, video) {
    ++subtitleToken;
    MX.sheet.close('subtitles-sheet');
    hidden($('side-streams'), false);
    target = { type: type, id: id, title: title, video: video || null };
    matchButton.hidden = !(['media', 'torrents'].indexOf(matchKind) !== -1 && matchKey && libraryMetadata().metadata);
    var token = ++streamsToken;
    el.streamsTitle.textContent = video ? title.replace(detail.meta.name + ' ', '') : 'streams';
    el.streamsList.innerHTML = '';
    hidden(el.streamsAddon, true);
    renderLocalFiles(video);
    setReadout(el.streamsReadout, 'asking your stream addons…', false);
    stremio.getStreams(addons, type, id).then(function (result) {
      if (token !== streamsToken) return;
      if (!result.addonCount) {
        setReadout(el.streamsReadout, 'None of your addons provide streams for this. Install a stream addon under Addons.', !el.localFiles.children.length);
        return;
      }
      var msg = result.streams.length ? '' : 'No streams found.';
      if (result.errors.length) msg = (msg ? msg + ' ' : '') + 'Failed: ' + result.errors.join('; ');
      setReadout(el.streamsReadout, msg, !result.streams.length && !el.localFiles.children.length);
      lastStreams = result.streams;
      renderAddonFilter();
      renderStreams();
    }).catch(function (err) {
      if (token === streamsToken) setReadout(el.streamsReadout, err.message, true);
    });
  }

  // Stremio's addon dropdown above the streams.
  function renderAddonFilter() {
    var names = [];
    lastStreams.forEach(function (s) { if (names.indexOf(s.addonName) === -1) names.push(s.addonName); });
    el.streamsAddon.innerHTML = '';
    option(el.streamsAddon, '', 'All addons', true);
    names.forEach(function (name) { option(el.streamsAddon, name, name); });
    hidden(el.streamsAddon, names.length < 2);
  }
  el.streamsAddon.addEventListener('change', renderStreams);

  function renderStreams() {
    el.streamsList.innerHTML = '';
    lastStreams.filter(function (s) { return !el.streamsAddon.value || s.addonName === el.streamsAddon.value; })
      .forEach(function (s) { el.streamsList.appendChild(streamRow(s, target.title)); });
  }

  function streamRow(stream, title) {
    var castable = stremio.toCastable(stream);
    var row = document.createElement('div');
    row.className = 'cn-row cn-st-stream';
    var name = String(stream.name || stream.addonName || 'stream').replace(/\n+/g, ' · ');
    var desc = stream.title || stream.description || '';
    var kind = stremio.isTorrent(stream) ? 'torrent' : stream.ytId ? 'youtube' : stream.url ? 'link' : 'other';
    // Torrents under LOW_SEEDERS usually time out before the first byte.
    var seeds = kind === 'torrent' ? stremio.seeders(stream) : null;
    var seedBadge = seeds == null ? ''
      : '<span class="mx-badge cn-seeds' + (seeds === 0 ? ' cn-seeds-dead' : seeds < LOW_SEEDERS ? ' cn-seeds-low' : '') + '"' +
        ' title="' + (seeds < LOW_SEEDERS ? 'few seeders: may not start' : 'seeders') + '">👤 ' + seeds + '</span>';
    var info = stremio.describeStream(stream);
    var chips = [info.resolution, info.source, info.codec]
      .concat(info.hdr, info.audio, info.size ? ['💾 ' + info.size] : [])
      .concat(info.languages.length ? ['🗣 ' + info.languages.join(' ')] : [])
      .filter(Boolean);
    var lines = info.release
      ? [info.release, info.filename && info.filename !== info.release ? '📄 ' + info.filename : '']
      : [desc];
    if (castable.kind === 'unsupported') lines.push('✕ ' + castable.reason);
    var source = [stream.addonName, info.site ? '⚙️ ' + info.site : '', info.group ? 'by ' + info.group : '',
      info.infoHash ? '#' + info.infoHash.slice(0, 8).toLowerCase() + (info.fileIdx != null ? ' · file ' + info.fileIdx : '') : '']
      .filter(Boolean).join(' · ');
    var play = document.createElement('button');
    play.type = 'button';
    play.className = 'cn-st-stream-play';
    play.innerHTML =
      '<span class="cn-row-name">' + escapeHtml(name) + '</span>' +
      (chips.length ? '<span class="cn-stream-tags">' + chips.map(function (c) {
        return '<span class="cn-tag">' + escapeHtml(c) + '</span>';
      }).join('') + '</span>' : '') +
      '<span class="cn-stream-desc">' + escapeHtml(lines.filter(Boolean).join('\n')) + '</span>' +
      (source ? '<span class="cn-stream-source">' + escapeHtml(source) + '</span>' : '');
    play.title = String(desc).split('\n')[0];
    var side = document.createElement('span');
    side.className = 'cn-stream-badges';
    side.innerHTML = seedBadge + '<span class="mx-badge">' + escapeHtml(kind) + '</span>';
    row.appendChild(play);
    row.appendChild(side);
    if (castable.kind === 'unsupported') {
      play.disabled = true;
      row.classList.add('cn-st-disabled');
      return row;
    }
    var here = document.createElement('button');
    here.type = 'button';
    here.className = 'mx-btn mx-sm';
    here.textContent = 'play on this device';
    here.title = 'Open the receiver in this browser and play it there';
    side.appendChild(here);
    var save = document.createElement('button');
    save.type = 'button';
    save.className = 'mx-btn mx-sm';
    save.textContent = 'save';
    save.title = 'Save to your library without casting';
    side.appendChild(save);
    play.addEventListener('click', function () { selectStream(stream, castable, title, false); });
    here.addEventListener('click', function () { selectStream(stream, castable, title, true); });
    save.addEventListener('click', function () { castStreamReady(castable, title, null, true); });
    return row;
  }

  function selectStream(stream, castable, title, here) {
    var token = ++subtitleToken;
    setReadout(el.streamsReadout, 'checking subtitles…', false);
    stremio.getSubtitles(stream, target.type, target.id).then(function (subtitles) {
      if (token !== subtitleToken) return;
      setReadout(el.streamsReadout, '', false);
      if (!subtitles.length) { castStreamReady(castable, title, null, false, here); return; }
      var list = $('subtitles-list');
      list.innerHTML = '';
      function addChoice(label, subtitle) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'cn-row';
        button.textContent = label;
        button.addEventListener('click', function () {
          if (token !== subtitleToken) return;
          MX.sheet.close('subtitles-sheet');
          castStream(castable, title, subtitle, token, here);
        });
        list.appendChild(button);
      }
      addChoice('Play without subtitles', null);
      subtitles.forEach(function (subtitle) {
        addChoice((subtitle.label || subtitle.lang || 'Subtitle') + (subtitle.origin ? ' · ' + subtitle.origin : ''), subtitle);
      });
      MX.sheet.open('subtitles-sheet');
    }).catch(function (error) {
      if (token !== subtitleToken) return;
      setReadout(el.streamsReadout, 'Subtitles unavailable: ' + error.message, true);
      castStreamReady(castable, title, null, false, here);
    });
  }

  function castStream(castable, title, subtitle, token, here) {
    if (!subtitle) { castStreamReady(castable, title, null, false, here); return; }
    setReadout(el.streamsReadout, 'preparing subtitles…', false);
    resolver.resolveSubtitle(subtitle.url).then(function (url) {
      if (token === subtitleToken) castStreamReady(castable, title, url, false, here);
    }).catch(function (error) { if (token === subtitleToken) setReadout(el.streamsReadout, error.message, true); });
  }

  // here: play in this browser's receiver tab instead of the selected
  // target. The tab is opened now, while the click still counts as a user
  // gesture, and gets the video once the resolver has it.
  function castStreamReady(castable, title, subtitleUrl, saveOnly, here) {
    var receiver = here ? openHereReceiver(castable, title, subtitleUrl) : null;
    if (here && !receiver) return;
    var fields = libraryMetadata();
    if (section === 'plus18') fields.category = 'plus18';
    fields.title = title;
    function done(result) {
      setReadout(el.streamsReadout, saveOnly ? 'Saving to your library. Progress is shown under downloads.' : '', false);
      if (receiver) playHere(receiver, result.streamUrl, title, subtitleUrl);
      else if (!saveOnly) castToTv(result.streamUrl, title, subtitleUrl);
      refreshLibrary();
      refreshSaving();
    }
    function failed(err) { setReadout(el.streamsReadout, err.message, true); }
    if (castable.torrent) {
      // The resolver saves the film on the server and answers once the
      // TV can start; the download carries on there after that.
      setReadout(el.streamsReadout, 'starting the download on the server…', false);
      var refreshed = false;
      resolver.resolveTorrent(castable.url, title, function () {
        if (!refreshed) { refreshed = true; refreshSaving(); }
      }, fields).then(done, failed);
      return;
    }
    setReadout(el.streamsReadout, 'looking up that video…', false);
    resolver.resolve(castable.url, function (job) {
      var pct = typeof job.progress === 'number' ? ' ' + Math.round(job.progress) + '%' : '';
      setReadout(el.streamsReadout, job.status === 'downloading' ? 'downloading…' + pct : 'looking up that video…', false);
    }, fields).then(done, failed);
  }

  // --- Addons ---

  var NOT_SHARED = "Couldn't reach the companion server, so this change is only on this device for now.";
  el.addonsFilter.addEventListener('input', renderAddons);

  function renderAddons() {
    el.addonsNote.textContent = section === 'plus18'
      ? 'Plus18 addons. These are separate from your normal addons.'
      : 'Addons for the normal section. Plus18 has its own list.';
    whenAddonsReady.then(function () {
      var text = el.addonsFilter.value.trim().toLowerCase();
      el.addonsList.innerHTML = '';
      if (addonsError) { el.addonsList.innerHTML = '<p class="mx-readout mx-err"></p>'; el.addonsList.firstChild.textContent = addonsError.message; return; }
      if (!addons.length) { el.addonsList.innerHTML = '<span class="mx-empty">No addons installed.</span>'; return; }
      addons.forEach(function (addon) {
        var m = addon.manifest;
        var haystack = ((m && (m.name + ' ' + (m.description || ''))) || addon.url).toLowerCase();
        if (text && haystack.indexOf(text) === -1) return;
        el.addonsList.appendChild(addonCard(addon));
      });
    });
  }

  function addonCard(addon) {
    var m = addon.manifest;
    var card = document.createElement('article');
    card.className = 'mx-panel cn-st-addon';
    var logo = m && (m.logo || m.icon);
    card.innerHTML =
      '<span class="cn-st-addon-logo">' + (logo ? '<img alt="" loading="lazy" src="' + escapeHtml(logo) + '">' : escapeHtml(((m && m.name) || '?').charAt(0))) + '</span>' +
      '<div class="cn-st-addon-body"><h3 class="cn-row-name"></h3><p class="cn-stream-desc"></p><p class="cn-stream-source"></p></div>' +
      '<div class="cn-st-addon-actions"></div>';
    card.querySelector('h3').textContent = m ? m.name + (m.version ? ' v' + m.version : '') : addon.url;
    card.querySelector('.cn-stream-desc').textContent = m ? m.description || '' : 'Failed to load: ' + addon.error;
    card.querySelector('.cn-stream-source').textContent = m ? [(m.types || []).join(', '),
      (m.resources || []).map(function (r) { return typeof r === 'string' ? r : r.name; }).join(', ')].filter(Boolean).join(' · ') : addon.url;
    var actions = card.querySelector('.cn-st-addon-actions');
    if (m && m.behaviorHints && m.behaviorHints.configurable) {
      var configure = document.createElement('a');
      configure.className = 'mx-btn mx-sm';
      configure.href = addon.base + '/configure';
      configure.target = '_blank';
      configure.rel = 'noopener';
      configure.textContent = 'configure';
      actions.appendChild(configure);
    }
    var remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'mx-btn mx-sm';
    remove.textContent = 'uninstall';
    var timer = null;
    remove.addEventListener('click', function () {
      if (!remove.classList.contains('cn-confirm')) {
        remove.classList.add('cn-confirm');
        remove.textContent = 'sure? uninstall';
        timer = setTimeout(function () { remove.classList.remove('cn-confirm'); remove.textContent = 'uninstall'; }, 4000);
        return;
      }
      clearTimeout(timer);
      remove.disabled = true;
      stremio.removeAddon(addon.url, section).then(function (shared) {
        if (!shared) MX.toast(false, NOT_SHARED);
        reloadAddons();
      }).catch(function (err) { remove.disabled = false; MX.toast(false, err.message); });
    });
    actions.appendChild(remove);
    return card;
  }

  el.addonsAdd.addEventListener('click', function () {
    var input = el.addonsUrl.value.trim();
    if (!input) return;
    el.addonsAdd.disabled = true;
    setReadout(el.addonsReadout, 'loading manifest…', false);
    Promise.resolve().then(function () { return stremio.addAddon(input, section); }).then(function (addon) {
      el.addonsAdd.disabled = false;
      el.addonsUrl.value = '';
      setReadout(el.addonsReadout, '', false);
      MX.sheet.close('addon-sheet');
      if (addon.shared) MX.toast(true, 'Installed ' + addon.manifest.name);
      else MX.toast(false, 'Installed ' + addon.manifest.name + '. ' + NOT_SHARED);
      reloadAddons();
    }).catch(function (err) {
      el.addonsAdd.disabled = false;
      setReadout(el.addonsReadout, err.message, true);
    });
  });

  // --- Settings ---

  el.settingsServer.value = stremio.getServerUrl();
  $('settings-server-save').addEventListener('click', function () {
    var url = el.settingsServer.value.trim().replace(/\/+$/, '');
    if (url && !/^https?:\/\//i.test(url)) { setReadout(el.settingsReadout, 'The server URL starts with http://', true); return; }
    stremio.setServerUrl(url);
    setReadout(el.settingsReadout, url ? 'Streaming server saved.' : 'Streaming server cleared.', false);
    // Stream rows were built against the old server.
    detail.key = null;
  });
  $('settings-server-check').addEventListener('click', function () {
    setReadout(el.settingsReadout, 'checking…', false);
    stremio.checkServer().then(function () { setReadout(el.settingsReadout, 'The streaming server answered.', false); },
      function (err) { setReadout(el.settingsReadout, err.message, true); });
  });

  // --- sections (normal and Plus18) ---

  function renderSection() {
    var adult = section === 'plus18';
    document.body.classList.toggle('cn-st-plus18', adult);
    el.plus18Toggle.setAttribute('aria-pressed', adult ? 'true' : 'false');
    el.plus18Toggle.classList.toggle('mx-primary', adult);
    el.plus18Toggle.textContent = adult ? '18+ on' : '18+';
    document.querySelector('.mx-nav-brand').textContent = adult ? 'plus18' : 'stremio';
  }
  function switchSection(next) {
    if (section === next) return;
    section = next;
    ContentPolicy.setMode(section);
    var params = new URLSearchParams(location.search);
    if (section === 'plus18') params.set('section', 'plus18'); else params.delete('section');
    var query = params.toString();
    board.key = null; discover.key = null; detail.key = null; detail.local = null; searchState.query = null; libraryView.signature = null;
    ++board.token; ++discover.token; ++searchState.token;
    ++streamsToken; ++subtitleToken;
    MX.sheet.close('subtitles-sheet');
    addons = [];
    catalogs = [];
    library.items = null;
    history.replaceState(null, '', location.pathname + (query ? '?' + query : '') + '#/');
    renderSection();
    refreshLibrary();
    reloadAddons();
  }
  el.plus18Toggle.addEventListener('click', function () {
    if (section === 'plus18') switchSection('normal');
    else MX.sheet.open('plus18-confirm');
  });
  $('plus18-cancel').addEventListener('click', function () { MX.sheet.close('plus18-confirm'); });
  $('plus18-yes').addEventListener('click', function () {
    MX.sheet.close('plus18-confirm');
    switchSection('plus18');
  });

  // --- boot ---

  function reloadAddons() {
    var loadingSection = section;
    ++addonsGeneration;
    whenAddonsReady = stremio.loadAddons(loadingSection).then(function (list) {
      if (section !== loadingSection) return;
      addonsError = null;
      addons = list;
      catalogs = stremio.browsableCatalogs(addons);
    }, function (err) {
      if (section === loadingSection) addonsError = err instanceof Error ? err : new Error(String(err && err.message || err));
    });
    board.key = null; discover.key = null; searchState.query = null;
    ++board.token; ++discover.token; ++searchState.token;
    if (detail.meta) detail.key = null;
    render();
    return whenAddonsReady;
  }

  // Pick up addons added on another device while this page sat in the background.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    refreshLibrary();
    whenAddonsReady.then(function () { return stremio.syncAddons(); })
      .then(function (changed) { if (changed) reloadAddons(); }).catch(function () {});
  });

  renderSection();
  relay.connect();
  refreshLibrary();
  refreshSaving();
  reloadAddons();
});
