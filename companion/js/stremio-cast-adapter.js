'use strict';

// The boundary between a selected Stremio stream and TV Casting playback.
// Accepts a raw addon-protocol stream and returns a source the existing
// resolver/casting flow understands. Core output will be mapped here once its
// selected-stream shape has been verified against the pinned web bridge.
function createStremioCastAdapter(getServerUrl) {
  var MAX_TRACKERS = 12; // keep relay play messages below its 16 KiB limit
  var NEEDS_SERVER = 'needs a Stremio streaming server -- set one under "addons"';

  function torrentUrl(server, infoHash, fileIdx, trackers, fileMustInclude) {
    var params = [];
    (trackers || []).slice(0, MAX_TRACKERS).forEach(function (t) {
      params.push('tr=' + encodeURIComponent(t));
    });
    (fileMustInclude || []).forEach(function (f) {
      params.push('f=' + encodeURIComponent(f));
    });
    var idx = typeof fileIdx === 'number' ? fileIdx : -1;
    return server + '/' + infoHash.toLowerCase() + '/' + idx + (params.length ? '?' + params.join('&') : '');
  }

  function proxyUrl(server, target, headers) {
    var url = new URL(target);
    var params = [['d', url.protocol + '//' + url.host]];
    Object.keys(headers.request || {}).forEach(function (k) {
      params.push(['h', k + ':' + headers.request[k]]);
    });
    Object.keys(headers.response || {}).forEach(function (k) {
      params.push(['r', k + ':' + headers.response[k]]);
    });
    return server + '/proxy/' + new URLSearchParams(params).toString() + '/' +
      url.pathname.replace(/^\//, '') + url.search;
  }

  function fromMagnet(magnet) {
    var hash = /[?&]xt=urn:btih:([0-9a-f]{40})(?:&|$)/i.exec(magnet);
    if (!hash) return null;
    var trackers = [];
    var re = /[?&]tr=([^&]+)/g;
    var m;
    while ((m = re.exec(magnet))) trackers.push(decodeURIComponent(m[1]));
    return { infoHash: hash[1], trackers: trackers };
  }

  function toCastable(stream) {
    var server = String(getServerUrl() || '').replace(/\/+$/, '');
    if (stream.url && /^magnet:/i.test(stream.url)) {
      var parsed = fromMagnet(stream.url);
      if (!parsed) return { kind: 'unsupported', reason: 'unreadable magnet link' };
      if (!server) return { kind: 'unsupported', reason: NEEDS_SERVER };
      return { kind: 'direct', viaServer: true, torrent: true,
        url: torrentUrl(server, parsed.infoHash, null, parsed.trackers) };
    }
    if (stream.url) {
      var headers = stream.behaviorHints && stream.behaviorHints.proxyHeaders;
      if (headers && (headers.request || headers.response)) {
        if (!server) return { kind: 'unsupported', reason: NEEDS_SERVER };
        return { kind: 'direct', viaServer: true, url: proxyUrl(server, stream.url, headers) };
      }
      return { kind: 'direct', url: stream.url };
    }
    if (stream.infoHash) {
      if (!/^[0-9a-f]{40}$/i.test(stream.infoHash)) {
        return { kind: 'unsupported', reason: 'unreadable torrent hash' };
      }
      if (!server) return { kind: 'unsupported', reason: NEEDS_SERVER };
      return { kind: 'direct', viaServer: true, torrent: true,
        url: torrentUrl(server, stream.infoHash, stream.fileIdx,
          stream.sources || stream.announce, stream.fileMustInclude) };
    }
    if (stream.ytId) {
      return { kind: 'resolve', url: 'https://www.youtube.com/watch?v=' + encodeURIComponent(stream.ytId) };
    }
    if (stream.externalUrl) return { kind: 'unsupported', reason: 'opens in another app, not castable' };
    return { kind: 'unsupported', reason: 'stream type not supported yet' };
  }

  return { toCastable: toCastable };
}

if (typeof module !== 'undefined') module.exports = createStremioCastAdapter;
