'use strict';

// Same relay deployed in Phase 1. No Jellyfin server URL here -- that's
// entered at sign-in, like any other Jellyfin client (decision #6 in
// PLAN.md), since it isn't fixed the way the relay's LAN address is.
var APP_CONFIG = {
  RELAY_URL: 'ws://192.168.2.31:8787',
  RECONNECT_BASE_DELAY_MS: 1000,
  RECONNECT_MAX_DELAY_MS: 30000,
  // Same host as the relay, different port/process (resolver/README.md).
  RESOLVER_URL: 'http://192.168.2.31:8788',
  // stremio.html's starting addons, until the user changes the list there
  // (it's then kept per browser). Cinemeta is Stremio's official catalog
  // + metadata addon; it has no streams -- those come from whatever stream
  // addons get added on that page.
  STREMIO_ADDONS: ['https://v3-cinemeta.strem.io/manifest.json'],
  // Stremio's streaming server (stremio-service), on the same home server.
  // Only needed for torrent streams and header-proxied links; the TV
  // fetches from it directly. Overridable per browser on stremio.html.
  STREMIO_SERVER_URL: 'http://192.168.2.31:11470'
};
