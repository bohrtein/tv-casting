'use strict';

// Downloads and saved-library requests go directly to the resolver.
function createResolverClient(config) {
  var POLL_MS = 1500;

  // When the companion is reached through HTTPS/Caddy, the resolver still
  // reports its saved media as plain http://HOST/media/... because it runs
  // as an HTTP service behind the proxy. Rebase those URLs through the
  // browser-facing resolver prefix so receiver playback stays HTTPS.
  function browserMediaUrl(url) {
    if (typeof url !== 'string' || !config.RESOLVER_URL) return url;
    try {
      var media = new URL(url);
      var base = new URL(config.RESOLVER_URL, typeof location !== 'undefined' ? location.href : undefined);
      if (base.protocol !== 'https:' || media.hostname !== base.hostname) return url;
      var prefix = base.pathname.replace(/\/+$/, '');
      if (media.protocol === 'https:' && media.pathname.indexOf(prefix + '/') === 0) return url;
      return base.origin + prefix + media.pathname + media.search + media.hash;
    } catch (_) { return url; }
  }

  function normalizeCache(body) {
    ['entries', 'torrents'].forEach(function (key) {
      (body[key] || []).forEach(function (item) {
        if (item.streamUrl) item.streamUrl = browserMediaUrl(item.streamUrl);
        if (item.originalUrl) item.originalUrl = browserMediaUrl(item.originalUrl);
        if (item.thumbUrl) item.thumbUrl = browserMediaUrl(item.thumbUrl);
      });
    });
    return body;
  }

  function isDirectMediaUrl(url) {
    // If it's already a link straight to a media file/manifest, skip
    // the resolver entirely -- it works today (and still works if the
    // resolver happens to be down).
    var path = url.split('?')[0].split('#')[0];
    return /\.(mp4|m3u8|mpd|webm|mkv|mov|ts)$/i.test(path);
  }

  function startJob(endpoint, body) {
    return fetch(config.RESOLVER_URL + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) {
      if (!res.ok) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          throw new Error(body.error || 'Resolver request failed (HTTP ' + res.status + ')');
        });
      }
      return res.json();
    });
  }

  function pollJob(id) {
    return fetch(config.RESOLVER_URL + '/resolve/' + id).then(function (res) {
      if (!res.ok) throw new Error('Lost track of the resolve job (HTTP ' + res.status + ')');
      return res.json().then(function (job) {
        if (job.streamUrl) job.streamUrl = browserMediaUrl(job.streamUrl);
        return job;
      });
    });
  }

  // Resolves with { streamUrl, title }. Calls onProgress(job) after
  // every poll so the caller can render a live status line.
  function resolve(url, onProgress, fields) {
    return follow(startJob('/resolve', Object.assign({ url: url }, fields || {})), onProgress);
  }

  // Same, for a Stremio server torrent URL: the resolver saves the film
  // on the server and resolves as soon as the TV can start on it, while
  // the rest keeps downloading there (resolver/README.md, "Torrents").
  function resolveTorrent(url, title, onProgress, fields) {
    return follow(startJob('/torrent', Object.assign({ url: url, title: title }, fields || {})), onProgress);
  }

  function follow(started, onProgress) {
    return started.then(function (job) {
      return new Promise(function (ok, fail) {
        function tick() {
          pollJob(job.id).then(function (state) {
            if (onProgress) onProgress(state);
            if (state.status === 'ready') {
              ok({ streamUrl: state.streamUrl, title: state.title });
            } else if (state.status === 'error') {
              fail(new Error(state.error || 'Could not resolve that url.'));
            } else if (state.status === 'cancelled') {
              fail(new Error('Cancelled.'));
            } else {
              setTimeout(tick, POLL_MS);
            }
          }).catch(fail);
        }
        tick();
      });
    });
  }

  // Lists every job the resolver knows about (active + recent), newest
  // first -- not scoped to this device/tab, since the resolver itself
  // isn't. Used for the remote tab's "downloading now" section (works
  // even if a different device started the cast) and the activity log.
  function listJobs() {
    return fetch(config.RESOLVER_URL + '/jobs').then(function (res) {
      if (!res.ok) throw new Error('Could not reach the resolver (HTTP ' + res.status + ')');
      return res.json();
    }).then(function (body) {
      return body.jobs || [];
    });
  }

  // Everything saved on the server (GET /cache): { entries, torrents },
  // videos from links and films from torrents, most recently used first,
  // each with streamUrl, thumbUrl and bytes.
  function getCache() {
    return fetch(config.RESOLVER_URL + '/cache').then(function (res) {
      if (!res.ok) throw new Error('Could not reach the resolver (HTTP ' + res.status + ')');
      return res.json().then(normalizeCache);
    });
  }

  // The link videos alone (the link tab's "previously downloaded").
  function listCache() {
    return getCache().then(function (body) { return body.entries || []; });
  }

  // Casts a saved film that's too big for the TV: the resolver starts its
  // 1080p copy right away, and this resolves with { streamUrl } as soon
  // as the TV can start on it, while the rest is still being made.
  function castOptimized(key, onProgress) {
    return follow(startJob('/cache/torrents/' + encodeURIComponent(key) + '/optimize?cast=1', {}), onProgress);
  }

  // Continues a partial film's download from where its saved part ends.
  // Resolves with the job ({ id, status }), which shows in listJobs().
  function resumeSaved(key) {
    var url = config.RESOLVER_URL + '/cache/torrents/' + encodeURIComponent(key) + '/resume';
    return fetch(url, { method: 'POST' }).then(function (res) {
      if (res.ok) return res.json();
      return res.json().catch(function () { return {}; }).then(function (body) {
        throw new Error(body.error || 'Could not continue (HTTP ' + res.status + ')');
      });
    });
  }

  // Makes the 1080p TV copy of a saved 4K film, from the files on disk.
  // Progress then shows in getCache()'s torrents[].optimize.
  function optimizeSaved(key) {
    var url = config.RESOLVER_URL + '/cache/torrents/' + encodeURIComponent(key) + '/optimize';
    return fetch(url, { method: 'POST' }).then(function (res) {
      if (res.ok) return res.json();
      return res.json().catch(function () { return {}; }).then(function (body) {
        throw new Error(body.error || 'Could not optimize (HTTP ' + res.status + ')');
      });
    });
  }

  // Deletes a saved video ("media") or film ("torrents") from the server.
  function deleteSaved(kind, key) {
    var url = config.RESOLVER_URL + '/cache/' + kind + '/' + encodeURIComponent(key) + '/delete';
    return fetch(url, { method: 'POST' }).then(function (res) {
      if (res.ok) return res.json();
      return res.json().catch(function () { return {}; }).then(function (body) {
        throw new Error(body.error || 'Could not delete (HTTP ' + res.status + ')');
      });
    });
  }

  // Stops a running download on the server and deletes what it saved.
  function cancel(id) {
    return fetch(config.RESOLVER_URL + '/resolve/' + id + '/cancel', { method: 'POST' }).then(function (res) {
      if (res.ok) return res.json();
      return res.json().catch(function () { return {}; }).then(function (body) {
        throw new Error(body.error || 'Could not cancel (HTTP ' + res.status + ')');
      });
    });
  }

  return {
    startDownload: function (url, fields, torrent) { return startJob(torrent ? '/torrent' : '/resolve', Object.assign({ url: url }, fields || {})); },
    updateLibrary: function (kind, key, fields) { return startJob('/library/' + kind + '/' + encodeURIComponent(key), fields); },
    cancel: cancel,
    isDirectMediaUrl: isDirectMediaUrl,
    resolve: resolve,
    resolveTorrent: resolveTorrent,
    resolveSubtitle: function (url) { return startJob('/subtitle', { url: url }).then(function (body) { return browserMediaUrl(body.url); }); },
    listJobs: listJobs,
    getCache: getCache,
    listCache: listCache,
    deleteSaved: deleteSaved,
    optimizeSaved: optimizeSaved,
    castOptimized: castOptimized,
    resumeSaved: resumeSaved
  };
}

if (typeof module !== "undefined") module.exports = createResolverClient;
