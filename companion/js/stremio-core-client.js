'use strict';

// Compatibility facade for stremio-app.js. Every addon request and capability
// decision below comes from Stremio Core's models in its WASM worker.
function createStremioCoreClient(config) {
  var settings = createStremioSettings(config);
  var display = createStremioStreamPresentation();
  var cast = createStremioCastAdapter(settings.getServerUrl);
  var transports = {};
  var activeSection = 'normal';
  var currentMetaId = {};
  var metaAddonUrl = {};
  var addonCache = {};
  var selectedCatalogs = {};
  var queues = {};

  function transport(section) {
    if (!transports[section]) {
      var core = createStremioCoreTransport(section);
      var prefix = 'tvc.core.' + section + '.';
      transports[section] = core.init().then(function () {
        // Core's guest default contains protected official addons. Seed a
        // section-local empty profile once, then install exactly the shared
        // URLs. This is essential for Plus18 isolation.
        if (localStorage.getItem(prefix + 'seeded')) return core;
        return core.getState('ctx').then(function (ctx) {
          var profile = { auth: null, addons: [], addonsLocked: false, settings: ctx.profile.settings };
          localStorage.setItem(prefix + 'profile', JSON.stringify(profile));
          core.close();
          core = createStremioCoreTransport(section);
          return core.init().then(function () {
            localStorage.setItem(prefix + 'seeded', '1');
            return core;
          });
        });
      });
    }
    return transports[section];
  }

  function queue(section, job) {
    var previous = queues[section] || Promise.resolve();
    var next = previous.catch(function () {}).then(job);
    queues[section] = next;
    return next;
  }

  function stateWhen(core, model, predicate, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var closed = false;
      var checking = false;
      var pendingCheck = false;
      var events = 0;
      var timer = setTimeout(function () { finish(new Error('Stremio Core timed out loading ' + model + '.')); }, timeoutMs || 15000);
      var unsubscribe = core.onEvent(function (event) {
        if (event && event.name === 'NewState' && event.args && event.args.indexOf(model) !== -1) {
          events++;
          check();
        }
      });
      function finish(error, value) {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        unsubscribe();
        if (error) reject(error); else resolve(value);
      }
      function check() {
        if (closed) return;
        if (checking) { pendingCheck = true; return; }
        checking = true;
        core.getState(model).then(function (state) {
          checking = false;
          if (closed) return;
          try { if (predicate(state, events)) return finish(null, state); }
          catch (error) { return finish(error); }
          if (pendingCheck) { pendingCheck = false; check(); }
        }, function (error) { finish(error); });
      }
      check();
    });
  }

  function coreError(content) {
    if (typeof content === 'string') return content;
    if (content && content.content && content.content.message) return content.content.message;
    return content && content.message || 'Addon request failed.';
  }

  function descriptor(core, url) {
    return core.dispatch({ action: 'Load', args: { model: 'AddonDetails', args: { transportUrl: url } } }, 'addon_details')
      .then(function () {
        return stateWhen(core, 'addon_details', function (state) {
          return state.remoteAddon && state.remoteAddon.transport_url === url &&
            state.remoteAddon.content && state.remoteAddon.content.type !== 'Loading';
        });
      }).then(function (state) {
        var content = state.remoteAddon.content;
        if (content.type !== 'Ready') throw new Error(coreError(content.content));
        return content.content;
      });
  }

  function reconcile(section, core, urls) {
    return core.getState('ctx').then(function (ctx) {
      var installed = ctx.profile.addons || [];
      return installed.reduce(function (promise, addon) {
        return promise.then(function () {
          if (urls.indexOf(addon.transportUrl) !== -1) return;
          return core.dispatch({ action: 'Ctx', args: { action: 'UninstallAddon', args: addon } });
        });
      }, Promise.resolve());
    }).then(function () {
      return urls.reduce(function (promise, url) {
        return promise.then(function (result) {
          return core.getState('ctx').then(function (ctx) {
            var existing = (ctx.profile.addons || []).find(function (addon) { return addon.transportUrl === url; });
            if (existing) { result.push(existing); return result; }
            return descriptor(core, url).then(function (addon) {
              return core.dispatch({ action: 'Ctx', args: { action: 'InstallAddon', args: addon } })
                .then(function () { result.push(addon); return result; });
            }, function (error) {
              result.push({ transportUrl: url, manifest: null, error: error.message || String(error) });
              return result;
            });
          });
        });
      }, Promise.resolve([]));
    }).then(function (descriptors) {
      var list = descriptors.map(function (item) {
        return { url: item.transportUrl, base: item.transportUrl.replace(/\/manifest\.json$/i, ''),
          manifest: item.manifest, descriptor: item, error: item.error };
      });
      addonCache[section] = list;
      return list;
    });
  }

  function syncStreamingServer(core) {
    var url = settings.getServerUrl();
    if (!url) return Promise.resolve();
    return core.getState('ctx').then(function (ctx) {
      if (ctx.profile.settings.streamingServerUrl === url) return;
      var next = Object.assign({}, ctx.profile.settings, { streamingServerUrl: url });
      return core.dispatch({ action: 'Ctx', args: { action: 'UpdateSettings', args: next } });
    });
  }

  function loadAddons(section) {
    section = section === 'plus18' ? 'plus18' : 'normal';
    activeSection = section;
    return queue(section, function () {
      return settings.sync().catch(function () {}).then(function () {
        return transport(section).then(function (core) {
          return syncStreamingServer(core).then(function () { return reconcile(section, core, settings.getUrls(section)); });
        });
      });
    });
  }

  function addAddon(input, section) {
    section = section === 'plus18' ? 'plus18' : 'normal';
    var url = settings.normalize(input);
    if (settings.getUrls(section).indexOf(url) !== -1) return Promise.reject(new Error('That addon is already added.'));
    return queue(section, function () {
      return transport(section).then(function (core) {
        return descriptor(core, url).then(function (addon) {
          return core.dispatch({ action: 'Ctx', args: { action: 'InstallAddon', args: addon } }).then(function () {
            return settings.change(section, function (urls) { return urls.indexOf(url) === -1 ? urls.concat([url]) : urls; })
              .then(function (shared) {
                return { url: url, base: url.replace(/\/manifest\.json$/i, ''), manifest: addon.manifest,
                  descriptor: addon, shared: shared };
              });
          });
        });
      });
    });
  }

  function removeAddon(url, section) {
    section = section === 'plus18' ? 'plus18' : 'normal';
    return queue(section, function () {
      return transport(section).then(function (core) {
        return core.getState('ctx').then(function (ctx) {
          var addon = (ctx.profile.addons || []).find(function (item) { return item.transportUrl === url; });
          return (addon ? core.dispatch({ action: 'Ctx', args: { action: 'UninstallAddon', args: addon } }) : Promise.resolve())
            .then(function () {
              return settings.change(section, function (urls) { return urls.filter(function (item) { return item !== url; }); });
            });
        });
      });
    });
  }

  function browsableCatalogs(addons) {
    return (selectedCatalogs[activeSection] || []).map(function (option) {
      var addon = addons.find(function (item) {
        return item.manifest && item.manifest.id === option.addon.manifest.id &&
          (item.manifest.catalogs || []).some(function (catalog) { return catalog.id === option.id && catalog.type === option.type; });
      });
      if (!addon) return null;
      var catalog = addon.manifest.catalogs.find(function (item) { return item.id === option.id && item.type === option.type; });
      return { addon: addon, catalog: catalog };
    }).filter(Boolean);
  }

  function refreshCatalogs(section) {
    return transport(section).then(function (core) {
      return core.getState('discover').then(function (state) {
        selectedCatalogs[section] = state.selectable && state.selectable.catalogs || [];
      });
    });
  }

  // fresh: drop Core's loaded copy first, so a refresh reaches the addon
  // instead of reusing what Core already holds for the same request.
  function getCatalog(addon, catalog, skip, extra, fresh) {
    var section = activeSection;
    return transport(section).then(function (core) {
      var request = { base: addon.url,
        path: { resource: 'catalog', type: catalog.type, id: catalog.id, extra: Object.entries(extra || {}) } };
      function matches(state) {
        var selected = state.selected && state.selected.request;
        return selected && selected.base === request.base && selected.path.type === catalog.type &&
          selected.path.id === catalog.id &&
          JSON.stringify(selected.path.extra || []) === JSON.stringify(request.path.extra);
      }
      function loadSelection() {
        var loaded = stateWhen(core, 'discover', function (state, events) {
          return events > 0 && matches(state) && state.catalog && state.catalog.content && state.catalog.content.type !== 'Loading';
        });
        return Promise.all([core.dispatch({ action: 'Load', args: {
          model: 'CatalogWithFiltersSelection', args: { request: request }
        } }, 'discover'), loaded]).then(function (values) { return values[1]; });
      }
      function unload() {
        return fresh ? core.dispatch({ action: 'Unload' }, 'discover') : Promise.resolve();
      }
      function loadNext(previousLength) {
        var loaded = stateWhen(core, 'discover', function (state, events) {
          return matches(state) && state.catalog && state.catalog.content &&
            state.catalog.content.type !== 'Loading' &&
            (state.catalog.content.type === 'Err' || state.catalog.content.content.length > previousLength ||
              events >= 2 && !state.selectable.nextPage);
        });
        return Promise.all([core.dispatch({ action: 'CatalogWithFilters', args: {
          action: 'LoadNextPage'
        } }, 'discover'), loaded]).then(function (values) { return values[1]; });
      }
      function results(state, attempts) {
        if (state.catalog.content.type === 'Err') throw new Error(coreError(state.catalog.content.content));
        var metas = state.catalog.content.content;
        if (!skip || metas.length > skip || !state.selectable.nextPage || attempts >= 100) return metas.slice(skip || 0);
        return loadNext(metas.length).then(function (next) {
          if (next.catalog.content.type === 'Ready' && next.catalog.content.content.length === metas.length) return [];
          return results(next, attempts + 1);
        });
      }
      return (skip ? core.getState('discover').then(function (state) {
        return matches(state) && state.catalog && state.catalog.content && state.catalog.content.type !== 'Loading'
          ? state : loadSelection();
      }) : unload().then(loadSelection)).then(function (state) {
        return results(state, 0);
      });
    });
  }

  function getCatalogFilters() {
    return transport(activeSection).then(function (core) {
      return core.getState('discover').then(function (state) {
        return state.selectable && state.selectable.extra || [];
      });
    });
  }

  // Stremio's Board and Search pages: one row per addon catalog, via Core's
  // CatalogsWithExtra model. onUpdate(rows) fires as each catalog arrives.
  function catalogRows(model, extra, onUpdate, fresh) {
    var section = activeSection;
    var key = JSON.stringify(extra);
    var lastRowSignatures = {};
    var updateTimer = null;
    // Core's catalog rows carry only the addon's manifest, so find its URL
    // among this section's installed addons by manifest id.
    function addonUrl(addon) {
      var id = addon && addon.manifest && addon.manifest.id;
      var hit = (addonCache[section] || []).find(function (item) { return item.manifest && item.manifest.id === id; });
      return hit ? hit.url : addon && addon.transportUrl;
    }
    function rows(state) {
      return (state.catalogs || []).map(function (item) {
        var content = item.content || { type: 'Loading' };
        return { id: item.id, type: item.type, name: item.name,
          addonName: item.addon && item.addon.manifest && item.addon.manifest.name,
          addonUrl: addonUrl(item.addon),
          state: content.type, error: content.type === 'Err' ? coreError(content.content) : '',
          empty: content.type === 'Err' && (content.content === 'EmptyContent' || !!content.content && content.content.type === 'EmptyContent'),
          metas: content.type === 'Ready' ? content.content || [] : [] };
      });
    }
    function current(state) { return state.selected && JSON.stringify(state.selected.extra || []) === key; }
    function changedRows(state) {
      return rows(state).filter(function (item) {
        var metas = item.metas || [];
        var first = metas.length && metas[0] && metas[0].id || '';
        var last = metas.length && metas[metas.length - 1] && metas[metas.length - 1].id || '';
        var signature = [item.state, item.error || '', metas.length, first, last].join('|');
        var rowKey = [item.addonUrl || '', item.type || '', item.id || ''].join('|');
        if (lastRowSignatures[rowKey] === signature) return false;
        lastRowSignatures[rowKey] = signature;
        return true;
      });
    }
    return transport(section).then(function (core) {
      var stop = core.onEvent(function (event) {
        if (!event || event.name !== 'NewState' || !event.args || event.args.indexOf(model) === -1 || updateTimer) return;
        updateTimer = setTimeout(function () {
          updateTimer = null;
          core.getState(model).then(function (state) {
            if (!current(state) || !onUpdate) return;
            var changed = changedRows(state);
            if (changed.length) onUpdate(changed);
          }).catch(function () {});
        }, 16);
      });
      return (fresh ? core.dispatch({ action: 'Unload' }, model) : Promise.resolve()).then(function () {
        return core.dispatch({ action: 'Load', args: { model: 'CatalogsWithExtra', args: { extra: extra } } }, model);
      }).then(function () { return stateWhen(core, model, function (state) { return current(state) && state.catalogs; }); })
        .then(function (state) {
          if (!state.catalogs.length) return state;
          return core.dispatch({ action: 'CatalogsWithExtra', args: {
            action: 'LoadRange', args: { start: 0, end: state.catalogs.length - 1 }
          } }, model).then(function () {
            return stateWhen(core, model, function (next) {
              return current(next) && next.catalogs.every(function (item) { return item.content && item.content.type !== 'Loading'; });
            }, 30000).catch(function () {
              // A slow addon keeps its row loading; the others are shown.
              return core.getState(model);
            });
          });
        }).then(function (state) {
          if (updateTimer) { clearTimeout(updateTimer); updateTimer = null; }
          stop();
          return rows(state);
        }, function (error) {
          if (updateTimer) { clearTimeout(updateTimer); updateTimer = null; }
          stop();
          throw error;
        });
    });
  }

  // One catalog's search, asked of its addon directly (the addon protocol's
  // /catalog/type/id/search=....json), so a narrowed search only reaches the
  // catalogs it names instead of every searchable one Core knows.
  function searchCatalog(addonUrl, type, id, query, externalSignal) {
    var base = String(addonUrl).replace(/\/manifest\.json(\?.*)?$/, '');
    var url = base + '/catalog/' + encodeURIComponent(type) + '/' + encodeURIComponent(id) +
      '/search=' + encodeURIComponent(query) + '.json';
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timedOut = false;
    function abortFromOutside() { if (controller) controller.abort(); }
    if (externalSignal && controller) {
      if (externalSignal.aborted) controller.abort();
      else externalSignal.addEventListener('abort', abortFromOutside, { once: true });
    }
    var timer = setTimeout(function () {
      timedOut = true;
      if (controller) controller.abort();
    }, 30000);
    function cleanup() {
      clearTimeout(timer);
      if (externalSignal && controller) externalSignal.removeEventListener('abort', abortFromOutside);
    }
    return fetch(url, { signal: controller ? controller.signal : externalSignal }).then(function (response) {
      if (!response.ok) throw new Error('The addon answered ' + response.status + '.');
      return response.json();
    }).then(function (body) {
      cleanup();
      return (body && Array.isArray(body.metas) ? body.metas : []).filter(function (meta) { return meta && meta.id; });
    }, function (error) {
      cleanup();
      if (externalSignal && externalSignal.aborted) {
        var cancelled = new Error('Search cancelled.');
        cancelled.name = 'AbortError';
        throw cancelled;
      }
      throw timedOut && error && error.name === 'AbortError' ? new Error('The addon took too long to answer.') : error;
    });
  }

  function search(addons, query) {
    return transport(activeSection).then(function (core) {
      return core.dispatch({ action: 'Load', args: { model: 'CatalogsWithExtra', args: { extra: [['search', query]] } } }, 'search')
        .then(function () {
          return stateWhen(core, 'search', function (state) {
            return state.selected && state.selected.extra && state.selected.extra.some(function (entry) {
              return entry[0] === 'search' && entry[1] === query;
            }) && state.catalogs;
          });
        }).then(function (state) {
          if (!state.catalogs.length) return state;
          return core.dispatch({ action: 'CatalogsWithExtra', args: {
            action: 'LoadRange', args: { start: 0, end: state.catalogs.length - 1 }
          } }, 'search').then(function () {
            return stateWhen(core, 'search', function (next) {
              return next.selected && next.selected.extra && next.selected.extra.some(function (entry) {
                return entry[0] === 'search' && entry[1] === query;
              }) && next.catalogs.every(function (item) {
                return item.content && item.content.type !== 'Loading';
              });
            });
          });
        }).then(function (state) {
          return state.catalogs.filter(function (item) { return item.content && item.content.type === 'Ready' && item.content.content.length; })
            .map(function (item) {
              var addon = addons.find(function (candidate) { return candidate.manifest && candidate.manifest.id === item.addon.manifest.id; });
              return { addon: addon, catalog: { id: item.id, type: item.type, name: item.name }, metas: item.content.content };
            });
        });
    });
  }

  function loadDetails(section, type, metaId, streamId) {
    return transport(section).then(function (core) {
      var path = { resource: 'meta', type: type, id: metaId, extra: [] };
      var streamPath = streamId ? { resource: 'stream', type: type, id: streamId, extra: [] } : null;
      return core.dispatch({ action: 'Load', args: { model: 'MetaDetails', args: {
        metaPath: path, streamPath: streamPath, guessStream: false
      } } }, 'meta_details').then(function () {
        return stateWhen(core, 'meta_details', function (state) {
          return state.selected && state.selected.metaPath && state.selected.metaPath.id === metaId &&
            (!streamId || state.selected.streamPath && state.selected.streamPath.id === streamId) &&
            (streamId ? state.streams && state.streams.every(function (item) {
              return item.content.type !== 'Loading';
            }) && state.metaItem && state.metaItem.content.type !== 'Loading'
              : !state.metaItem || state.metaItem.content.type !== 'Loading');
        });
      });
    });
  }

  function getMeta(addons, type, id) {
    var section = activeSection;
    currentMetaId[section] = id;
    return loadDetails(section, type, id, null).then(function (state) {
      metaAddonUrl[section] = state.metaItem && state.metaItem.addon && state.metaItem.addon.transportUrl;
      return state.metaItem && state.metaItem.content.type === 'Ready' ? state.metaItem.content.content : null;
    });
  }

  function getStreams(addons, type, id) {
    var section = activeSection;
    var metaId = currentMetaId[section] || id;
    return loadDetails(section, type, metaId, id).then(function (state) {
      var errors = [];
      var lists = state.streams.map(function (item) {
        if (item.content.type === 'Err') { errors.push(item.addon.manifest.name + ': ' + coreError(item.content.content)); return []; }
        return (item.content.content || []).map(function (stream) {
          stream.addonName = item.addon.manifest.name;
          stream.addonUrl = item.addon.transportUrl;
          return stream;
        });
      });
      return { streams: display.sortStreams([].concat.apply([], lists)), errors: errors, addonCount: state.streams.length };
    });
  }

  function getSubtitles(stream, type, videoId) {
    var section = activeSection;
    var embedded = (stream.subtitles || []).slice();
    return transport(section).then(function (core) {
      var raw = Object.assign({}, stream);
      ['addonName', 'addonUrl', 'deepLinks', 'progress', 'lastUsed'].forEach(function (key) { delete raw[key]; });
      var selected = {
        stream: raw,
        streamRequest: stream.addonUrl ? { base: stream.addonUrl,
          path: { resource: 'stream', type: type, id: videoId, extra: [] } } : null,
        metaRequest: metaAddonUrl[section] ? { base: metaAddonUrl[section],
          path: { resource: 'meta', type: type, id: currentMetaId[section] || videoId, extra: [] } } : null,
        subtitlesPath: { resource: 'subtitles', type: type, id: videoId, extra: [] }
      };
      return core.dispatch({ action: 'Load', args: { model: 'Player', args: selected } }, 'player')
        .then(function () {
          return core.dispatch({ action: 'Player', args: { action: 'VideoParamsChanged',
            args: { videoParams: { hash: null, size: null, filename: null } } } }, 'player');
        }).then(function () {
          return stateWhen(core, 'player', function (state) {
            return state.selected && state.selected.subtitlesPath &&
              state.selected.subtitlesPath.id === videoId && state.subtitles && state.subtitles.length > 0;
          }, 4000).then(function (state) { return state.subtitles; }, function () { return []; });
        }).then(function (coreSubtitles) {
          var seen = {};
          return embedded.concat(coreSubtitles).filter(function (item) {
            if (!item || !item.url || seen[item.url]) return false;
            seen[item.url] = true;
            return true;
          });
        });
    });
  }

  function checkServer() {
    var server = settings.getServerUrl();
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, 5000);
    return fetch(server + '/settings', { mode: 'no-cors', cache: 'no-store', signal: controller && controller.signal })
      .then(function (value) { clearTimeout(timer); return value; }, function (error) {
        clearTimeout(timer);
        throw new Error("Can't reach the Stremio server at " + server + ' (' + error.message + ').');
      });
  }

  return {
    normalizeManifestUrl: settings.normalize,
    getAddonUrls: settings.getUrls,
    loadAddons: function (section) { return loadAddons(section).then(function (list) {
      return refreshCatalogs(section).then(function () { return list; });
    }); },
    syncAddons: settings.sync,
    addAddon: addAddon,
    removeAddon: removeAddon,
    getServerUrl: settings.getServerUrl,
    setServerUrl: function (value) {
      settings.setServerUrl(value);
      Object.keys(transports).forEach(function (section) {
        transports[section].then(syncStreamingServer).catch(function () {});
      });
    },
    checkServer: checkServer,
    browsableCatalogs: browsableCatalogs,
    getCatalog: getCatalog,
    getCatalogFilters: getCatalogFilters,
    search: search,
    getBoard: function (onUpdate, fresh) { return catalogRows('board', [], onUpdate, fresh); },
    searchRows: function (query, onUpdate, fresh) { return catalogRows('search', [['search', query]], onUpdate, fresh); },
    searchCatalog: searchCatalog,
    getMeta: getMeta,
    getStreams: getStreams,
    getSubtitles: getSubtitles,
    toCastable: cast.toCastable,
    seeders: display.seeders,
    describeStream: display.describeStream,
    largeImage: display.largeImage,
    isTorrent: display.isTorrent
  };
}

if (typeof module !== 'undefined') module.exports = createStremioCoreClient;
