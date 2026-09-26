'use strict';

// The home server's address on the Wi-Fi. The TV is only on the LAN, so
// every URL it's sent to play must use this host.
var LAN_HOST = '192.168.2.31';

// Relay, resolver and Stremio's server run on the same machine as the App
// Hub serving this page.
//
// On plain HTTP/LAN access, connect directly to their normal ports.
// On HTTPS (for example through Caddy/Tailscale), use secure same-origin
// proxy paths so the browser does not block the connections as mixed content.
var SERVER_HOST = (function () {
  var host = typeof location !== 'undefined' ? location.hostname : '';

  if (!host || /^(localhost|127\.0\.0\.1|\[?::1\]?)$/.test(host)) {
    return LAN_HOST;
  }

  return host.indexOf(':') >= 0 && host.charAt(0) !== '['
    ? '[' + host + ']'
    : host;
})();

var IS_HTTPS =
  typeof location !== 'undefined' &&
  location.protocol === 'https:';

var APP_CONFIG = {
  LAN_HOST: LAN_HOST,
  SERVER_HOST: SERVER_HOST,

  // HTTPS pages must use WSS. Caddy proxies /relay to port 8787.
  RELAY_URL: IS_HTTPS
    ? 'wss://' + location.host + '/relay'
    : 'ws://' + SERVER_HOST + ':8787',

  RECONNECT_BASE_DELAY_MS: 1000,
  RECONNECT_MAX_DELAY_MS: 30000,

  // Caddy proxies /resolver to port 8788 when accessed through HTTPS.
  RESOLVER_URL: IS_HTTPS
    ? location.origin + '/resolver'
    : 'http://' + SERVER_HOST + ':8788',

  // stremio.html's starting addons, until the user changes the list there.
  STREMIO_ADDONS: [
    'https://v3-cinemeta.strem.io/manifest.json'
  ],

  // Caddy proxies /stremio to port 11470 when accessed through HTTPS.
  STREMIO_SERVER_URL: IS_HTTPS
    ? location.origin + '/stremio'
    : 'http://' + SERVER_HOST + ':11470'
};