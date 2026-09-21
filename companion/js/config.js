'use strict';

// Same relay deployed in Phase 1. No Jellyfin server URL here -- that's
// entered at sign-in, like any other Jellyfin client (decision #6 in
// PLAN.md), since it isn't fixed the way the relay's LAN address is.
var APP_CONFIG = {
  RELAY_URL: 'ws://192.168.2.31:8787',
  RECONNECT_BASE_DELAY_MS: 1000,
  RECONNECT_MAX_DELAY_MS: 30000
};
