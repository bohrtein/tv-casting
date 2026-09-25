'use strict';

// Background continuation runs after the companion browser may have closed.
// Keep this narrow server-only lookup separate from the Core-driven UI.
const createCastAdapter = require('../../companion/js/stremio-cast-adapter');

async function json(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('Addon returned HTTP ' + response.status);
  return response.json();
}

function supports(manifest, type, id) {
  return (manifest.resources || []).some((resource) => {
    const item = typeof resource === 'string' ? { name: resource } : resource;
    if (item.name !== 'stream') return false;
    const types = item.types || manifest.types || [];
    const prefixes = item.idPrefixes || manifest.idPrefixes || [];
    return types.includes(type) && (!prefixes.length || prefixes.some((prefix) => id.startsWith(prefix)));
  });
}

async function firstPlayable(addonUrls, serverUrl, type, id) {
  const adapter = createCastAdapter(() => serverUrl || '');
  const lists = await Promise.all(addonUrls.map(async (url) => {
    try {
      const manifest = await json(url);
      if (!supports(manifest, type, id)) return [];
      const base = url.replace(/\/manifest\.json$/i, '');
      const body = await json(base + '/stream/' + encodeURIComponent(type) + '/' + encodeURIComponent(id) + '.json');
      return Array.isArray(body.streams) ? body.streams : [];
    } catch (_) { return []; }
  }));
  for (const streams of lists) {
    for (const stream of streams) {
      const castable = adapter.toCastable(stream);
      if (castable.kind !== 'unsupported') return castable;
    }
  }
  throw new Error('Next episode has no playable stream.');
}

module.exports = { firstPlayable };
