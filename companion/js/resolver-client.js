'use strict';

// Talks to the resolver directly over plain HTTP -- same pattern as
// jellyfin-client.js, never through the relay (root README.md hard
// rule: the relay is transport only). See resolver/README.md for the
// API this wraps.
function createResolverClient(config) {
  var POLL_MS = 1500;

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
      return res.json();
    });
  }

  // Resolves with { streamUrl, title }. Calls onProgress(job) after
  // every poll so the caller can render a live status line.
  function resolve(url, onProgress) {
    return follow(startJob('/resolve', { url: url }), onProgress);
  }

  // Same, for a Stremio server torrent URL: the resolver saves the film
  // on the server and resolves as soon as the TV can start on it, while
  // the rest keeps downloading there (resolver/README.md, "Torrents").
  function resolveTorrent(url, title, onProgress) {
    return follow(startJob('/torrent', { url: url, title: title }), onProgress);
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
      return res.json();
    });
  }

  // The link videos alone (the link tab's "previously downloaded").
  function listCache() {
    return getCache().then(function (body) { return body.entries || []; });
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
    cancel: cancel,
    isDirectMediaUrl: isDirectMediaUrl,
    resolve: resolve,
    resolveTorrent: resolveTorrent,
    listJobs: listJobs,
    getCache: getCache,
    listCache: listCache,
    deleteSaved: deleteSaved,
    optimizeSaved: optimizeSaved
  };
}
