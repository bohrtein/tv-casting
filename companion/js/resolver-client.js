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

  function startJob(url) {
    return fetch(config.RESOLVER_URL + '/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url })
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
    return startJob(url).then(function (job) {
      return new Promise(function (ok, fail) {
        function tick() {
          pollJob(job.id).then(function (state) {
            if (onProgress) onProgress(state);
            if (state.status === 'ready') {
              ok({ streamUrl: state.streamUrl, title: state.title });
            } else if (state.status === 'error') {
              fail(new Error(state.error || 'Could not resolve that url.'));
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

  return {
    isDirectMediaUrl: isDirectMediaUrl,
    resolve: resolve,
    listJobs: listJobs
  };
}
