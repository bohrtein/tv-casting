'use strict';

// Bounded local cache for completed browse requests. The addon URL set is
// part of each key so changing addons cannot show results from an old setup.
function createStremioBrowseCache(storage, now) {
  var STORAGE_KEY = 'tvc.stremio.browse.v1';
  var MAX_AGE = 24 * 60 * 60 * 1000;
  var MAX_BYTES = 2 * 1024 * 1024;
  var MAX_ENTRIES = 30;
  now = now || Date.now;
  var entries = [];
  try {
    var saved = JSON.parse(storage.getItem(STORAGE_KEY) || '[]');
    if (Array.isArray(saved)) entries = saved.filter(function (item) {
      return item && typeof item.key === 'string' && typeof item.time === 'number' &&
        item.time <= now() && now() - item.time < MAX_AGE;
    });
  } catch (e) { entries = []; }

  function persist() {
    try {
      while (entries.length > MAX_ENTRIES) entries.shift();
      var value = JSON.stringify(entries);
      while (value.length > MAX_BYTES && entries.length) {
        entries.shift();
        value = JSON.stringify(entries);
      }
      storage.setItem(STORAGE_KEY, value);
    } catch (e) {
      // Storage can be disabled or full. The in-memory cache still works.
    }
  }
  function key(kind, section, addons, query) {
    return JSON.stringify([kind, section, addons, query]);
  }
  return {
    get: function (kind, section, addons, query) {
      var id = key(kind, section, addons, query);
      var index = entries.findIndex(function (item) { return item.key === id; });
      if (index === -1) return null;
      var item = entries.splice(index, 1)[0];
      if (now() - item.time >= MAX_AGE) { persist(); return null; }
      entries.push(item);
      return item.data;
    },
    put: function (kind, section, addons, query, data) {
      var id = key(kind, section, addons, query);
      entries = entries.filter(function (item) { return item.key !== id; });
      entries.push({ key: id, time: now(), data: data });
      persist();
    },
    remove: function (kind, section, addons, query) {
      var id = key(kind, section, addons, query);
      entries = entries.filter(function (item) { return item.key !== id; });
      persist();
    }
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = createStremioBrowseCache;
