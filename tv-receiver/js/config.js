'use strict';

// Edit these two for your setup. RELAY_URL points at the relay deployed
// in Phase 1. COMPANION_BASE_URL is a placeholder until the companion
// PWA is hosted (Phase 3/5) — update it once that has a real address,
// so the QR code on the idle screen actually opens the companion app.
var APP_CONFIG = {
  RELAY_URL: 'ws://192.168.2.31:8787',
  COMPANION_BASE_URL: 'http://192.168.2.31:8080/pair',
  RECONNECT_BASE_DELAY_MS: 1000,
  RECONNECT_MAX_DELAY_MS: 30000
};
