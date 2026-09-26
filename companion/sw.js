'use strict';

// Cache the app shell only; saved files and metadata come from the resolver.
//
// __CACHE_VERSION__ is substituted by serve.js with a hash of the shell
// files' actual contents, so this cache busts itself whenever any of
// them change -- no more remembering to bump a version string by hand.
var CACHE_NAME = 'tv-casting-shell-__CACHE_VERSION__';
var SHELL_FILES = [
  './',
  'index.html',
  'stremio.html',
  'library.html',
  'tools.html',
  'manifest.webmanifest',
  'matrix/matrix.css',
  'matrix/matrix.js',
  'css/app.css',
  'css/remote.css',
  'css/stremio.css',
  'css/mobile.css',
  'js/content-policy.js',
  'js/resolver-client.js',
  'js/downloads-view.js',
  'js/now-casting.js',
  'js/relay-client.js',
  'js/stremio-cast-adapter.js',
  'js/stremio-stream-presentation.js',
  'js/stremio-settings.js',
  'js/stremio-core-transport.js',
  'js/stremio-core-client.js',
  'js/stremio-browse-cache.js',
  'js/stremio-picker.js',
  'js/library-model.js',
  'js/stremio-local-files.js',
  'js/remote-sheet.js',
  'js/remote-controls.js',
  'vendor/stremio-core/worker.js',
  'vendor/stremio-core/stremio_core_web_bg.wasm',
  'js/playback-history.js',
  'js/guest-player.js',
  'js/stremio-app.js',
  'js/app.js',
  'icon-192.png',
  'icon-512.png',
  'matrix/fonts/SpaceMono-Regular.ttf',
  'matrix/fonts/SpaceMono-Bold.ttf',
  'matrix/fonts/UnifrakturMaguntia-Book.ttf'
];
// The live copy of Matrix (/ds/1/, served by the app hub) is deliberately
// NOT in this list: it always comes from the network, so a change to the
// design system shows up without a service-worker update. The synced copy
// above is what the remote falls back to offline.

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) { return cache.addAll(SHELL_FILES); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(
        names.filter(function (name) { return name !== CACHE_NAME; })
          .map(function (name) { return caches.delete(name); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var url = new URL(event.request.url);

  // Only ever intercept same-origin shell files. Stremio addons
  // (different origins) and anything else just fall through to the
  // network untouched -- relay traffic is WebSocket, which fetch/SW never
  // sees.
  if (url.origin !== self.location.origin) return;

  var path = url.pathname.replace(/^\//, '');
  // Deployment can override relay/resolver URLs at request time. Never serve
  // an older config from the shell cache to the companion or receiver page.
  if (path === 'js/config.js') return;
  if (SHELL_FILES.indexOf(path) === -1 && path !== '') return;

  event.respondWith(
    caches.match(event.request).then(function (cached) {
      return cached || fetch(event.request);
    })
  );
});
