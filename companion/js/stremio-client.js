'use strict';

// Talks to Stremio addons directly over HTTPS using the open Stremio addon
// protocol (github.com/Stremio/stremio-addon-sdk, docs/protocol.md) -- the
// same thing the Stremio apps do, just without the Stremio app. Addons
// answer plain GET <base>/<resource>/<type>/<id>[/<extra>].json with CORS
// enabled, so the browser can call them with no server of ours in between,
// and like Jellyfin, never through the relay (root README.md hard rule).
//
// What gets cast is worked out by toCastable() below; the TV always ends
// up with one plain http(s) URL, which it fetches itself.
function createStremioClient(config) {
  var ADDONS_KEY = 'tvc.stremio.addons';
  var SERVER_KEY = 'tvc.stremio.server';
  // Addon URLs with many trackers make torrent URLs long, and the relay
  // caps a message at 16 KiB (relay/src/index.js). The streaming server
  // finds peers over DHT anyway, so trackers are a hint, not a need.
  var MAX_TRACKERS = 12;

  // --- settings (the streaming server is per browser, like the Jellyfin
  // session; the addon list is shared, see syncAddons) ---

  function readStore(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function writeStore(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      // Private mode / blocked storage -- the change just won't survive
      // a reload, which is better than taking the page down.
    }
  }

  function normalizeManifestUrl(input) {
    var url = String(input || '').trim().replace(/^stremio:\/\//i, 'https://');
    if (!/^https?:\/\//i.test(url)) {
      throw new Error('An addon URL starts with https:// or stremio://');
    }
    if (!/\/manifest\.json$/i.test(url)) url = url.replace(/\/+$/, '') + '/manifest.json';
    new URL(url); // throws on anything that still isn't a URL
    return url;
  }

  function getAddonUrls() {
    return readStore(ADDONS_KEY, null) || (config.STREMIO_ADDONS || []).slice();
  }

  // --- shared addon list (serve.js keeps one copy for every device) ---
  //
  // localStorage above is now just this browser's cached copy, used when
  // serve.js can't be reached. Relative URL so it works under whatever
  // path the page is served from.
  var SETTINGS_URL = 'api/stremio-settings';
  // Set once this browser's pre-sharing list has been folded into the
  // shared one, so addons added on each device before the switch all
  // survive, but an addon removed later doesn't come back from an old
  // browser copy.
  var MERGED_KEY = 'tvc.stremio.addonsShared';

  function settingsRequest(body) {
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, 5000);
    return fetch(SETTINGS_URL, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
      signal: controller ? controller.signal : undefined
    }).then(function (res) {
      clearTimeout(timer);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }, function (err) {
      clearTimeout(timer);
      throw err;
    });
  }

  function pushAddonUrls(urls) {
    return settingsRequest({ addons: urls }).then(function (saved) {
      writeStore(ADDONS_KEY, saved.addons);
      return saved.addons;
    });
  }

  // Pulls the shared list into this browser. Resolves true if it changed
  // this browser's list. Rejects if serve.js can't be reached; callers
  // then carry on with the cached copy.
  function syncAddons() {
    var before = JSON.stringify(getAddonUrls());
    return settingsRequest(null).then(function (shared) {
      var local = readStore(ADDONS_KEY, null);
      var alreadyMerged = readStore(MERGED_KEY, false);
      if (!shared.addons) {
        // First device since the switch: its list becomes the shared one.
        return pushAddonUrls(getAddonUrls());
      }
      if (!alreadyMerged && local) {
        var extra = local.filter(function (u) { return shared.addons.indexOf(u) === -1; });
        if (extra.length) return pushAddonUrls(shared.addons.concat(extra));
      }
      writeStore(ADDONS_KEY, shared.addons);
      return shared.addons;
    }).then(function (urls) {
      writeStore(MERGED_KEY, true);
      return JSON.stringify(urls) !== before;
    });
  }

  // Read-modify-write against the shared list, so a change made on
  // another device since this page loaded isn't overwritten. Falls back
  // to this browser only if serve.js is unreachable; resolves with
  // whether the change reached the shared list.
  function changeAddonUrls(change) {
    return syncAddons().then(function () {
      return pushAddonUrls(change(getAddonUrls())).then(function () { return true; });
    }).catch(function () {
      writeStore(ADDONS_KEY, change(getAddonUrls()));
      return false;
    });
  }

  function getServerUrl() {
    var stored = readStore(SERVER_KEY, null);
    var url = stored == null ? (config.STREMIO_SERVER_URL || '') : stored;
    return url.replace(/\/+$/, '');
  }

  function setServerUrl(url) {
    writeStore(SERVER_KEY, String(url || '').trim());
  }

  // Resolves if the streaming server answers at all, rejects with a
  // readable reason if not. Without this, a stopped or unreachable server
  // only shows up as the TV's player failing with no useful message.
  // no-cors: only reachability matters here, not the (opaque) body.
  function checkServer() {
    var server = getServerUrl();
    var timeout = new Promise(function (resolve, reject) {
      setTimeout(function () { reject(new Error('timed out')); }, 5000);
    });
    return Promise.race([fetch(server + '/settings', { mode: 'no-cors', cache: 'no-store' }), timeout])
      .catch(function (err) {
        throw new Error("Can't reach the Stremio server at " + server + ' (' + err.message +
          '). Is it running? Check Developer Tools > Stremio Server, and the VPN log.');
      });
  }

  // --- transport ---

  function getJson(url) {
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status + ' from ' + new URL(url).host);
      return res.json();
    });
  }

  function resourceUrl(addon, resource, type, id, extra) {
    var extraPart = '';
    if (extra) {
      var pairs = [];
      Object.keys(extra).forEach(function (k) {
        if (extra[k] != null && extra[k] !== '') {
          pairs.push(encodeURIComponent(k) + '=' + encodeURIComponent(extra[k]));
        }
      });
      if (pairs.length) extraPart = '/' + pairs.join('&');
    }
    return addon.base + '/' + resource + '/' + encodeURIComponent(type) + '/' +
      encodeURIComponent(id) + extraPart + '.json';
  }

  // --- addons ---

  var manifestCache = {}; // manifest url -> promise of manifest

  function fetchManifest(url) {
    if (!manifestCache[url]) {
      manifestCache[url] = getJson(url).catch(function (err) {
        throw new Error("Couldn't load that addon (" + err.message + ').');
      }).then(function (m) {
        if (!m || !m.id || !m.name) throw new Error("That URL isn't a Stremio addon manifest.");
        return m;
      });
      manifestCache[url].catch(function () { delete manifestCache[url]; });
    }
    return manifestCache[url];
  }

  function toAddon(url, manifest) {
    return { url: url, base: url.replace(/\/manifest\.json$/i, ''), manifest: manifest };
  }

  // Resolves with every configured addon, in order; one that fails to
  // load comes back with .error set instead of failing the whole list,
  // so one dead addon doesn't blank the page.
  function loadAddons() {
    return syncAddons().catch(function () {}).then(loadCachedAddons);
  }

  function loadCachedAddons() {
    return Promise.all(getAddonUrls().map(function (url) {
      return fetchManifest(url).then(function (m) {
        return toAddon(url, m);
      }, function (err) {
        var addon = toAddon(url, null);
        addon.error = err.message;
        return addon;
      });
    }));
  }

  function addAddon(input) {
    var url = normalizeManifestUrl(input);
    var urls = getAddonUrls();
    if (urls.indexOf(url) !== -1) return Promise.reject(new Error('That addon is already added.'));
    return fetchManifest(url).then(function (m) {
      return changeAddonUrls(function (current) {
        return current.indexOf(url) === -1 ? current.concat([url]) : current;
      }).then(function (shared) {
        var addon = toAddon(url, m);
        addon.shared = shared;
        return addon;
      });
    });
  }

  // Resolves with whether the removal reached the shared list.
  function removeAddon(url) {
    return changeAddonUrls(function (current) {
      return current.filter(function (u) { return u !== url; });
    });
  }

  function findResource(manifest, name) {
    var list = manifest.resources || [];
    for (var i = 0; i < list.length; i++) {
      var r = typeof list[i] === 'string' ? { name: list[i] } : list[i];
      if (r.name === name) return r;
    }
    return null;
  }

  function supports(addon, resource, type, id) {
    if (!addon.manifest) return false;
    var r = findResource(addon.manifest, resource);
    if (!r) return false;
    var types = r.types || addon.manifest.types || [];
    if (types.indexOf(type) === -1) return false;
    var prefixes = r.idPrefixes || addon.manifest.idPrefixes;
    if (id && prefixes && prefixes.length) {
      return prefixes.some(function (p) { return id.indexOf(p) === 0; });
    }
    return true;
  }

  // --- catalogs ---

  function catalogExtra(catalog, name) {
    var extra = catalog.extra || [];
    for (var i = 0; i < extra.length; i++) if (extra[i].name === name) return extra[i];
    // Pre-v4 manifests list these as plain string arrays instead.
    if ((catalog.extraSupported || []).indexOf(name) !== -1) {
      return { name: name, isRequired: (catalog.extraRequired || []).indexOf(name) !== -1 };
    }
    return null;
  }

  function isBrowsable(catalog) {
    var extra = (catalog.extra || []).concat((catalog.extraRequired || []).map(function (n) {
      return { name: n, isRequired: true };
    }));
    return !extra.some(function (e) { return e.isRequired; });
  }

  // Every catalog that can be listed without typing anything, across all
  // loaded addons: [{ addon, catalog }].
  function browsableCatalogs(addons) {
    var out = [];
    addons.forEach(function (addon) {
      if (!addon.manifest) return;
      (addon.manifest.catalogs || []).forEach(function (catalog) {
        if (isBrowsable(catalog)) out.push({ addon: addon, catalog: catalog });
      });
    });
    return out;
  }

  function getCatalog(addon, catalog, skip) {
    var extra = skip ? { skip: skip } : null;
    return getJson(resourceUrl(addon, 'catalog', catalog.type, catalog.id, extra))
      .then(function (body) { return body.metas || []; });
  }

  // Searches every catalog that supports it. Resolves with
  // [{ addon, catalog, metas }] -- one group per catalog that answered
  // with anything, in addon order.
  function search(addons, query) {
    var jobs = [];
    addons.forEach(function (addon) {
      if (!addon.manifest) return;
      (addon.manifest.catalogs || []).forEach(function (catalog) {
        if (!catalogExtra(catalog, 'search')) return;
        jobs.push(getJson(resourceUrl(addon, 'catalog', catalog.type, catalog.id, { search: query }))
          .then(function (body) {
            return { addon: addon, catalog: catalog, metas: body.metas || [] };
          }, function () { return null; }));
      });
    });
    return Promise.all(jobs).then(function (groups) {
      return groups.filter(function (g) { return g && g.metas.length; });
    });
  }

  // --- meta + streams ---

  // First addon that has a full meta (with the episode list, for series)
  // wins -- normally Cinemeta for tt... ids.
  function getMeta(addons, type, id) {
    var candidates = addons.filter(function (a) { return supports(a, 'meta', type, id); });
    function tryNext(i) {
      if (i >= candidates.length) return Promise.resolve(null);
      return getJson(resourceUrl(candidates[i], 'meta', type, id))
        .then(function (body) { return body.meta || tryNext(i + 1); }, function () { return tryNext(i + 1); });
    }
    return tryNext(0);
  }

  // --- seeders ---
  // The addon protocol has no seeders field, so addons put the count in
  // the text: Torrentio and most forks write "👤 123", a few "Seeders: 123".
  // Returns the number, or null when the stream doesn't say.
  function seeders(stream) {
    var text = [stream.title, stream.description, stream.name].filter(Boolean).join('\n');
    var m = /👤\s*(\d+)/.exec(text) || /\bseed(?:er)?s?\s*[:=]?\s*(\d+)/i.exec(text);
    return m ? parseInt(m[1], 10) : null;
  }

  function isTorrent(stream) {
    return !!stream.infoHash || /^magnet:/i.test(stream.url || '');
  }

  // Direct links (debrid, plain http) first, as the addons gave them:
  // they don't need peers. Then torrents, most seeders first, with the
  // ones that don't say at the end.
  function sortStreams(streams) {
    function rank(s) {
      if (!isTorrent(s)) return Infinity;
      var n = seeders(s);
      return n == null ? -1 : n;
    }
    return streams
      .map(function (s, i) { return { s: s, i: i, r: rank(s) }; })
      .sort(function (a, b) { return a.r === b.r ? a.i - b.i : b.r - a.r; })
      .map(function (x) { return x.s; });
  }

  // Asks every stream addon at once. Resolves with { streams, errors },
  // each stream tagged with the addon it came from; one slow or broken
  // addon only costs its own streams.
  function getStreams(addons, type, id) {
    var candidates = addons.filter(function (a) { return supports(a, 'stream', type, id); });
    var errors = [];
    return Promise.all(candidates.map(function (addon) {
      return getJson(resourceUrl(addon, 'stream', type, id)).then(function (body) {
        return (body.streams || []).map(function (s) {
          s.addonName = addon.manifest.name;
          return s;
        });
      }, function (err) {
        errors.push(addon.manifest.name + ': ' + err.message);
        return [];
      });
    })).then(function (lists) {
      return {
        streams: sortStreams([].concat.apply([], lists)),
        errors: errors,
        addonCount: candidates.length
      };
    });
  }

  // --- turning a stream into something the TV can open ---
  // Mirrors stremio-core's own conversion (src/types/resource/stream.rs):
  //   url      -> as-is, or through the streaming server's /proxy/ when
  //               the addon says the request needs extra headers
  //   infoHash -> <server>/<infoHash>/<fileIdx or -1>?tr=...
  //   ytId     -> our own resolver, which already turns YouTube into MP4
  // Returns { kind: 'direct' | 'resolve' | 'unsupported', url, reason },
  // with viaServer set when the stream comes from the streaming server,
  // and torrent set when it's a torrent (saved on the server first).

  function torrentUrl(server, infoHash, fileIdx, trackers, fileMustInclude) {
    var params = [];
    (trackers || []).slice(0, MAX_TRACKERS).forEach(function (t) {
      params.push('tr=' + encodeURIComponent(t));
    });
    (fileMustInclude || []).forEach(function (f) {
      params.push('f=' + encodeURIComponent(f));
    });
    // -1 tells the server to pick the biggest file in the torrent.
    var idx = typeof fileIdx === 'number' ? fileIdx : -1;
    return server + '/' + infoHash.toLowerCase() + '/' + idx + (params.length ? '?' + params.join('&') : '');
  }

  function proxyUrl(server, target, headers) {
    var url = new URL(target);
    var params = [['d', url.protocol + '//' + url.host]];
    Object.keys(headers.request || {}).forEach(function (k) {
      params.push(['h', k + ':' + headers.request[k]]);
    });
    Object.keys(headers.response || {}).forEach(function (k) {
      params.push(['r', k + ':' + headers.response[k]]);
    });
    var query = new URLSearchParams(params).toString();
    return server + '/proxy/' + query + '/' + url.pathname.replace(/^\//, '') + url.search;
  }

  function fromMagnet(magnet) {
    var hash = /[?&]xt=urn:btih:([0-9a-f]{40})(?:&|$)/i.exec(magnet);
    if (!hash) return null;
    var trackers = [];
    var re = /[?&]tr=([^&]+)/g;
    var m;
    while ((m = re.exec(magnet))) trackers.push(decodeURIComponent(m[1]));
    return { infoHash: hash[1], trackers: trackers };
  }

  var NEEDS_SERVER = 'needs a Stremio streaming server -- set one under "addons"';

  function toCastable(stream) {
    var server = getServerUrl();

    if (stream.url && /^magnet:/i.test(stream.url)) {
      var parsed = fromMagnet(stream.url);
      if (!parsed) return { kind: 'unsupported', reason: 'unreadable magnet link' };
      if (!server) return { kind: 'unsupported', reason: NEEDS_SERVER };
      return { kind: 'direct', viaServer: true, torrent: true, url: torrentUrl(server, parsed.infoHash, null, parsed.trackers) };
    }

    if (stream.url) {
      var headers = stream.behaviorHints && stream.behaviorHints.proxyHeaders;
      if (headers && (headers.request || headers.response)) {
        if (!server) return { kind: 'unsupported', reason: NEEDS_SERVER };
        return { kind: 'direct', viaServer: true, url: proxyUrl(server, stream.url, headers) };
      }
      return { kind: 'direct', url: stream.url };
    }

    if (stream.infoHash) {
      if (!/^[0-9a-f]{40}$/i.test(stream.infoHash)) {
        return { kind: 'unsupported', reason: 'unreadable torrent hash' };
      }
      if (!server) return { kind: 'unsupported', reason: NEEDS_SERVER };
      // Addons put trackers in `sources` as "tracker:<url>" / "dht:<hash>";
      // the server takes them as-is, same as stremio-core passes them.
      return {
        kind: 'direct',
        viaServer: true,
        torrent: true,
        url: torrentUrl(server, stream.infoHash, stream.fileIdx, stream.sources || stream.announce, stream.fileMustInclude)
      };
    }

    if (stream.ytId) {
      return { kind: 'resolve', url: 'https://www.youtube.com/watch?v=' + encodeURIComponent(stream.ytId) };
    }

    if (stream.externalUrl) return { kind: 'unsupported', reason: 'opens in another app, not castable' };
    return { kind: 'unsupported', reason: 'stream type not supported yet' };
  }

  return {
    normalizeManifestUrl: normalizeManifestUrl,
    getAddonUrls: getAddonUrls,
    loadAddons: loadAddons,
    syncAddons: syncAddons,
    addAddon: addAddon,
    removeAddon: removeAddon,
    getServerUrl: getServerUrl,
    setServerUrl: setServerUrl,
    checkServer: checkServer,
    browsableCatalogs: browsableCatalogs,
    getCatalog: getCatalog,
    search: search,
    getMeta: getMeta,
    getStreams: getStreams,
    toCastable: toCastable,
    seeders: seeders,
    isTorrent: isTorrent
  };
}
