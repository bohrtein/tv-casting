'use strict';

// Board, Discover and Search results cached on the companion server
// (browse-store.js), so every device reuses what one already fetched. The
// addon set is part of each key so changing addons cannot show results from
// an old setup. Any failure reads as a miss: the page just asks the addons.
function createStremioBrowseCache(fetchImpl, endpoint) {
  endpoint = endpoint || 'api/stremio-browse';
  function key(kind, section, addons, query) {
    return JSON.stringify([kind, section, addons, query]);
  }
  function call(body) {
    return Promise.resolve().then(function () {
      return fetchImpl(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
    }).then(function (response) { return response.ok ? response.json() : null; })
      .catch(function () { return null; });
  }
  return {
    get: function (kind, section, addons, query) {
      return call({ action: 'get', key: key(kind, section, addons, query) })
        .then(function (body) { return body && body.data || null; });
    },
    put: function (kind, section, addons, query, data) {
      return call({ action: 'put', key: key(kind, section, addons, query), data: data });
    }
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = createStremioBrowseCache;
