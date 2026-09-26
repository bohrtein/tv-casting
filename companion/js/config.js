'use strict';

// The home server's address on the Wi-Fi. The TV is only on the LAN, so
// every URL it's sent to play must use this host.
var LAN_HOST = '192.168.2.31';

// Relay, resolver and Stremio's server run on the same machine as the App
// Hub serving this page, so reach them on whatever host the page itself came
// from: the LAN IP at home, the Tailscale IP/name when away. Only fall back
// to LAN_HOST for a local dev server.
var SERVER_HOST = (function () {
  var host = typeof location !== 'undefined' ? location.hostname : '';
  if (!host || /^(localhost|127\.0\.0\.1|\[?::1\]?)$/.test(host)) return LAN_HOST;
  return host.indexOf(':') >= 0 && host.charAt(0) !== '[' ? '[' + host + ']' : host;
})();

var APP_CONFIG = {
  LAN_HOST: LAN_HOST,
  SERVER_HOST: SERVER_HOST,
  RELAY_URL: 'ws://' + SERVER_HOST + ':8787',
  RECONNECT_BASE_DELAY_MS: 1000,
  RECONNECT_MAX_DELAY_MS: 30000,
  // Same host as the relay, different port/process (resolver/README.md).
  RESOLVER_URL: 'http://' + SERVER_HOST + ':8788',
  // stremio.html's starting addons, until the user changes the list there
  // (it's then saved by serve.js and shared by every device). Cinemeta is Stremio's official catalog
  // + metadata addon; it has no streams -- those come from whatever stream
  // addons get added on that page.
  STREMIO_ADDONS: ['https://v3-cinemeta.strem.io/manifest.json'],
  // Stremio's streaming server on the same home server (the
  // tv-casting-stremio unit, see stremio-server/). Only needed for torrent
  // streams and header-proxied links; the TV fetches from it directly.
  // Overridable per browser on stremio.html.
  STREMIO_SERVER_URL: 'http://' + SERVER_HOST + ':11470'
};
