'use strict';

// Turns the resolver's GET /cache ({ entries, torrents, titles }) into the
// items Stremio's Library shows: one item per movie or series (all of its
// files together), and one per file without Stremio metadata. Nothing here
// talks to an addon: the library is the files on the resolver.
var LibraryModel = (function () {
  var TYPE_LABELS = { movie: 'Movies', series: 'Series', youtube: 'YouTube', porn: 'Porn', other: 'Other' };
  var TYPE_ORDER = ['movie', 'series', 'youtube', 'porn', 'other'];
  var SORTS = [
    ['lastwatched', 'Last watched'],
    ['added', 'Recently added'],
    ['az', 'A-Z'],
    ['za', 'Z-A'],
    ['watched', 'Watched'],
    ['notwatched', 'Not watched']
  ];

  function restricted(entry) {
    return typeof ContentPolicy !== 'undefined' ? ContentPolicy.restricted(entry) : false;
  }
  function inSection(entry, section) {
    return section === 'plus18' ? restricted(entry) : !restricted(entry);
  }
  function titleKey(m) { return JSON.stringify([m.type, m.addon || '', m.id]); }
  function isTitle(m) { return !!(m && m.id && (m.type === 'movie' || m.type === 'series')); }
  function progressOf(entry) { return entry && entry.progress || { positionSec: 0, durationSec: 0, watched: false }; }
  function stamp(progress) { return progress && progress.updatedAt || 0; }
  function started(progress) { return !!(progress && !progress.watched && progress.positionSec > 0); }
  function allFiles(cache) { return (cache.entries || []).concat(cache.torrents || []); }

  function fileType(entry) {
    var category = entry.category || 'other';
    if (category === 'youtube' || category === 'porn') return category;
    if (category === 'movies') return 'movie';
    if (category === 'series') return 'series';
    return 'other';
  }

  function episodeOrder(a, b) {
    var sa = a.season || 0, sb = b.season || 0;
    return (sa === 0) - (sb === 0) || sa - sb || (a.episode || a.number || 0) - (b.episode || b.number || 0);
  }

  // Files saved for one movie, or for one episode of a series.
  function matches(entry, m, videoId, video) {
    var em = entry.metadata;
    if (!em || em.id !== m.id || em.type !== m.type || (em.addon || '') !== (m.addon || '')) return false;
    if (m.type !== 'series') return true;
    if (em.videoId && videoId) return em.videoId === videoId;
    return !!video && em.season === video.season && em.episode === (video.episode != null ? video.episode : video.number);
  }

  function makeTitle(m) {
    return { key: 'title:' + titleKey(m), kind: 'title', type: m.type, name: m.name || m.id,
      poster: m.poster || '', background: m.background || '', metadata: m, files: [],
      progress: null, lastWatched: 0, added: 0, watched: false, videos: [] };
  }

  function build(cache, section) {
    cache = cache || {};
    var items = {};
    var order = [];
    function add(item) { if (!items[item.key]) { items[item.key] = item; order.push(item.key); } return items[item.key]; }

    allFiles(cache).forEach(function (entry) {
      if (!inSection(entry, section)) return;
      var m = entry.metadata;
      var item;
      if (isTitle(m)) {
        item = add(makeTitle(m));
        if (!item.poster && m.poster) item.poster = m.poster;
      } else {
        var title = entry.title || entry.sourceUrl || 'video';
        item = add({ key: 'file:' + entry.kind + ':' + entry.key, kind: 'file', type: fileType(entry), name: title,
          poster: entry.thumbUrl || '', background: '', metadata: null, files: [], progress: null,
          lastWatched: 0, added: 0, watched: false, videos: [] });
      }
      item.files.push(entry);
      item.added = Math.max(item.added, entry.createdAt || 0);
      item.lastWatched = Math.max(item.lastWatched, stamp(entry.progress), entry.lastUsedAt || 0);
    });

    (cache.titles || []).forEach(function (m) {
      if (!isTitle(m) || !inSection(m, section)) return;
      var key = 'title:' + titleKey(m);
      // A series stays in the library after its last episode is deleted.
      var item = items[key] || (m.type === 'series' ? add(makeTitle(m)) : null);
      if (!item) return;
      item.metadata = Object.assign({}, item.metadata, m);
      item.name = m.name || item.name;
      if (m.poster) item.poster = m.poster;
      if (m.background) item.background = m.background;
      item.videos = (m.videos || []).slice().sort(episodeOrder);
      item.videos.forEach(function (v) { item.lastWatched = Math.max(item.lastWatched, stamp(v.progress)); });
    });

    return order.map(function (key) { return finish(items[key]); });
  }

  function finish(item) {
    var progresses = item.files.map(progressOf).concat(item.videos.map(function (v) { return v.progress; }).filter(Boolean));
    progresses.sort(function (a, b) { return stamp(b) - stamp(a); });
    item.progress = progresses[0] || { positionSec: 0, durationSec: 0, watched: false };
    if (item.type === 'series' && item.videos.length) {
      item.watched = item.videos.every(function (v) { return v.progress && v.progress.watched; });
    } else {
      item.watched = item.files.some(function (e) { return progressOf(e).watched; });
    }
    item.saved = item.files.filter(function (e) { return !e.partial; }).length;
    return item;
  }

  function types(items) {
    var present = {};
    items.forEach(function (item) { present[item.type] = true; });
    return TYPE_ORDER.filter(function (type) { return present[type]; })
      .map(function (type) { return { value: type, label: TYPE_LABELS[type] }; });
  }

  function sortItems(items, sort) {
    var list = items.slice();
    function name(item) { return String(item.name || '').toLowerCase(); }
    function byName(a, b) { return name(a) < name(b) ? -1 : name(a) > name(b) ? 1 : 0; }
    var compare = {
      lastwatched: function (a, b) { return (b.lastWatched || b.added) - (a.lastWatched || a.added) || byName(a, b); },
      added: function (a, b) { return b.added - a.added || byName(a, b); },
      az: byName,
      za: function (a, b) { return byName(b, a); },
      watched: function (a, b) { return (b.watched - a.watched) || byName(a, b); },
      notwatched: function (a, b) { return (a.watched - b.watched) || byName(a, b); }
    }[sort] || byName;
    return list.sort(compare);
  }

  function filter(items, opts) {
    opts = opts || {};
    var text = String(opts.text || '').trim().toLowerCase();
    return sortItems(items.filter(function (item) {
      if (opts.type && opts.type !== 'all' && item.type !== opts.type) return false;
      return !text || String(item.name || '').toLowerCase().indexOf(text) !== -1;
    }), opts.sort || 'lastwatched');
  }

  // Stremio's "Continue Watching": what was left part way, and for a
  // series whose last played episode ended, the episode after it.
  function continueWatching(items) {
    var result = [];
    items.forEach(function (item) {
      if (item.kind === 'title' && item.type === 'series' && item.videos.length) {
        var last = null;
        item.videos.forEach(function (v) { if (stamp(v.progress) && (!last || stamp(v.progress) > stamp(last.progress))) last = v; });
        if (!last) return;
        var target = last;
        if (last.progress.watched) {
          var index = item.videos.indexOf(last);
          target = item.videos.slice(index + 1).find(function (v) { return (v.season || 0) !== 0 && !(v.progress && v.progress.watched); });
          if (!target) return;
        } else if (!started(last.progress)) return;
        result.push({ item: item, video: target, progress: target === last ? last.progress : null, updatedAt: stamp(last.progress) });
        return;
      }
      var file = item.files.filter(function (e) { return started(progressOf(e)); })
        .sort(function (a, b) { return stamp(progressOf(b)) - stamp(progressOf(a)); })[0];
      if (file) result.push({ item: item, video: null, file: file, progress: progressOf(file), updatedAt: stamp(progressOf(file)) });
    });
    return result.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
  }

  function findTitle(items, type, id) {
    return items.find(function (item) { return item.kind === 'title' && item.type === type && item.metadata.id === id; }) || null;
  }

  // Saved files for a movie, or for one episode of a series.
  function filesFor(item, videoId, video) {
    if (!item || item.kind !== 'title') return item ? item.files : [];
    return item.files.filter(function (entry) { return matches(entry, item.metadata, videoId, video); });
  }

  // Per episode: whether it is saved (or partly), and how far it was watched.
  function episodeStatus(item, video) {
    var files = filesFor(item, video.id, video);
    var complete = files.some(function (e) { return !e.partial; });
    var local = item && item.videos.find(function (v) { return v.id === video.id; });
    var progress = files.map(progressOf).concat(local && local.progress ? [local.progress] : [])
      .sort(function (a, b) { return stamp(b) - stamp(a); })[0] || null;
    return { files: files, saved: complete ? 'saved' : files.length ? 'partial' : 'missing', progress: progress };
  }

  function progressRatio(progress) {
    if (!progress) return 0;
    if (progress.watched) return 1;
    return progress.durationSec > 0 ? Math.min(1, progress.positionSec / progress.durationSec) : 0;
  }

  // Episodes of library series by release day, for Stremio's Calendar.
  function calendar(items, year, month) {
    var days = {};
    items.forEach(function (item) {
      if (item.kind !== 'title' || item.type !== 'series') return;
      item.videos.forEach(function (v) {
        if (!v.released || (v.season || 0) === 0) return;
        var date = new Date(v.released);
        if (isNaN(date) || date.getUTCFullYear() !== year || date.getUTCMonth() !== month) return;
        var day = date.getUTCDate();
        (days[day] = days[day] || []).push({ item: item, video: v });
      });
    });
    return days;
  }

  // What the library takes on disk: in total, per kind (in TYPE_ORDER),
  // and the biggest items, for the library's storage panel.
  function storage(items, largestCount) {
    var byType = {};
    var total = 0;
    var sized = [];
    items.forEach(function (item) {
      var bytes = item.files.reduce(function (sum, e) { return sum + (e.bytes || 0); }, 0);
      if (!bytes) return;
      total += bytes;
      var t = byType[item.type] = byType[item.type] || { type: item.type, label: TYPE_LABELS[item.type], bytes: 0, count: 0 };
      t.bytes += bytes;
      t.count++;
      sized.push({ item: item, bytes: bytes });
    });
    sized.sort(function (a, b) { return b.bytes - a.bytes; });
    return {
      totalBytes: total,
      types: TYPE_ORDER.filter(function (type) { return byType[type]; }).map(function (type) { return byType[type]; }),
      largest: sized.slice(0, largestCount || 5)
    };
  }

  return {
    TYPE_LABELS: TYPE_LABELS, SORTS: SORTS, build: build, types: types, filter: filter,
    continueWatching: continueWatching, findTitle: findTitle, filesFor: filesFor,
    episodeStatus: episodeStatus, progressRatio: progressRatio, calendar: calendar, titleKey: titleKey,
    storage: storage
  };
})();

if (typeof module !== 'undefined') module.exports = LibraryModel;
