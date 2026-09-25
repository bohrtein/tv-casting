'use strict';

// Presentation helpers for Stremio stream labels. Addon discovery lives in Core.
function createStremioStreamPresentation() {
  function seeders(stream) {
    var text = [stream.title, stream.description, stream.name].filter(Boolean).join('\n');
    var m = /👤\s*(\d+)/.exec(text) || /\bseed(?:er)?s?\s*[:=]?\s*(\d+)/i.exec(text);
    return m ? parseInt(m[1], 10) : null;
  }

  // --- what a stream is ---
  // Addons describe a release only in free text: Torrentio and its forks
  // put the release name on the first line of `title`, then
  // "👤 seeders 💾 size ⚙️ site", then flags for the audio languages;
  // `behaviorHints` sometimes carries the filename and byte size. This
  // pulls the usual scene tags out of all of it. Every field is optional.
  var TAGS = {
    resolution: [
      [/\b(2160p|4k|uhd)\b/i, '4K'], [/\b1440p\b/i, '1440p'], [/\b1080[pi]\b/i, '1080p'],
      [/\b720p\b/i, '720p'], [/\b(576|480)p\b/i, '480p'], [/\b360p\b/i, '360p']
    ],
    source: [
      [/\bremux\b/i, 'Remux'], [/\b(blu[ -]?ray|bdrip|brrip|bd25|bd50)\b/i, 'BluRay'],
      [/\bweb[ -]?dl\b/i, 'WEB-DL'], [/\bweb[ -]?rip\b/i, 'WEBRip'], [/\bweb\b/i, 'WEB'],
      [/\bhdtv\b/i, 'HDTV'], [/\b(dvdrip|dvd)\b/i, 'DVD'], [/\b(hdcam|cam|camrip)\b/i, 'CAM'],
      [/\b(telesync|hdts|ts)\b/, 'TS'], [/\b(telecine|tc)\b/, 'TC'], [/\bscr(eener)?\b/i, 'SCR']
    ],
    codec: [
      [/\b(x265|h[ .]?265|hevc)\b/i, 'HEVC'], [/\bav1\b/i, 'AV1'],
      [/\b(x264|h[ .]?264|avc)\b/i, 'H.264'], [/\bxvid\b/i, 'XviD'], [/\bvp9\b/i, 'VP9']
    ],
    hdr: [
      [/\b(dv|dovi|dolby[ .]?vision)\b/i, 'Dolby Vision'], [/\bhdr10\+|hdr10plus\b/i, 'HDR10+'],
      [/\bhdr(10)?\b/i, 'HDR'], [/\b10[ -]?bit\b/i, '10-bit']
    ],
    audio: [
      [/\batmos\b/i, 'Atmos'], [/\btrue[ -]?hd(?=\d|\b)/i, 'TrueHD'], [/\bdts[ -]?(hd|ma|x)(?=\d|\b)/i, 'DTS-HD'],
      [/\bdts(?=\d|\b)/i, 'DTS'], [/\b(ddp|dd\+|e-?ac-?3)(?=\d|\b)/i, 'DD+'], [/\b(dd|ac-?3)(?=\d|\b)/i, 'DD'],
      [/\baac(?=\d|\b)/i, 'AAC'], [/\bflac(?=\d|\b)/i, 'FLAC'], [/\bopus(?=\d|\b)/i, 'Opus'],
      [/(?:^|\D)7\.1(?!\d)/, '7.1'], [/(?:^|\D)5\.1(?!\d)/, '5.1'], [/(?:^|\D)2\.0(?!\d)/, '2.0']
    ]
  };

  function matchTags(text, table, many) {
    var found = [];
    for (var i = 0; i < table.length; i++) {
      if (table[i][0].test(text) && found.indexOf(table[i][1]) === -1) {
        found.push(table[i][1]);
        if (!many) break;
      }
    }
    if (!many) return found[0] || null;
    // "DTS" is also in "DTS-HD", "HDR" in "HDR10+": keep the specific one.
    return found.filter(function (t) {
      return !found.some(function (u) { return u !== t && u.indexOf(t) === 0; });
    });
  }

  function formatBytes(n) {
    if (!(n > 0)) return null;
    var units = ['B', 'KB', 'MB', 'GB', 'TB'];
    var i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
    return (n / Math.pow(1024, i)).toFixed(i >= 3 ? 2 : 0) + ' ' + units[i];
  }

  // Regional-indicator pairs (🇬🇧) -> "GB"; that's how Torrentio lists audio.
  function flagCodes(text) {
    var out = [];
    var re = /([\uD83C][\uDDE6-\uDDFF])([\uD83C][\uDDE6-\uDDFF])/g;
    var m;
    while ((m = re.exec(text))) {
      var code = String.fromCharCode(m[1].charCodeAt(1) - 0xDDE6 + 65, m[2].charCodeAt(1) - 0xDDE6 + 65);
      if (out.indexOf(code) === -1) out.push(code);
    }
    return out;
  }

  function describeStream(stream) {
    var hints = stream.behaviorHints || {};
    var lines = String(stream.title || stream.description || '').split('\n');
    var filename = hints.filename || null;
    // Torrentio: first line is the release name; with a season pack the
    // file inside comes on a second line, before the 👤 line.
    var release = lines[0] && !/👤|💾|⚙️/.test(lines[0]) ? lines[0].trim() : null;
    if (!filename && lines[1] && !/👤|💾|⚙️/.test(lines[1]) && /\.\w{2,4}$/.test(lines[1].trim())) {
      filename = lines[1].trim();
    }
    var all = [stream.name, stream.title, stream.description, filename].filter(Boolean).join('\n');
    // Scene names use dots for spaces; "\b" then works on each tag.
    var tagText = all.replace(/[._]/g, ' ').replace(/(\d) (\d)/g, '$1.$2');

    var sizeMatch = /💾\s*([\d.,]+\s*[KMGT]i?B)/i.exec(all) || /\b(\d+(?:[.,]\d+)?\s*[KMGT]i?B)\b/i.exec(all);
    var size = formatBytes(hints.videoSize) || (sizeMatch ? sizeMatch[1].replace(',', '.') : null);
    var site = /⚙️\s*([^\n👤💾]+)/.exec(all);
    var group = release && /-([A-Za-z0-9]+)(?:\[[^\]]*\])?(?:\.\w{2,4})?$/.exec(release);
    var languages = flagCodes(all);
    if (/multi[ -]?audio|\bmulti\b/i.test(all)) languages.unshift('Multi');

    return {
      release: release,
      filename: filename,
      resolution: matchTags(tagText, TAGS.resolution, false),
      source: matchTags(tagText, TAGS.source, false),
      codec: matchTags(tagText, TAGS.codec, false),
      hdr: matchTags(tagText, TAGS.hdr, true),
      audio: matchTags(tagText, TAGS.audio, true),
      size: size,
      site: site ? site[1].trim() : null,
      group: group ? group[1] : null,
      languages: languages,
      seeders: seeders(stream),
      infoHash: stream.infoHash || magnetHash(stream.url) || null,
      fileIdx: typeof stream.fileIdx === 'number' ? stream.fileIdx : null
    };
  }

  function magnetHash(url) {
    var hash = /^magnet:.*[?&]xt=urn:btih:([0-9a-f]{40})(?:&|$)/i.exec(url || '');
    return hash ? hash[1] : null;
  }

  // Cinemeta's artwork comes from images.metahub.space, which serves the
  // same picture at small/medium/large; catalogs link the small one.
  function largeImage(url) {
    if (!url) return url;
    return String(url).replace(/(images\.metahub\.space\/(?:poster|background|logo)\/)(?:small|medium)\//, '$1large/');
  }

  function isTorrent(stream) {
    return !!stream.infoHash || /^magnet:/i.test(stream.url || '');
  }

  // Direct links (debrid, plain http) first, as the addons gave them:
  // they don't need peers. Then torrents, most seeders first, with the
  // ones that don't say at the end.
  function sortStreams(streams) {
    function rank(s) {
      if (!isTorrent(s)) return Infinity;
      var n = seeders(s);
      return n == null ? -1 : n;
    }
    return streams
      .map(function (s, i) { return { s: s, i: i, r: rank(s) }; })
      .sort(function (a, b) { return a.r === b.r ? a.i - b.i : b.r - a.r; })
      .map(function (x) { return x.s; });
  }

  // Asks every stream addon at once. Resolves with { streams, errors },
  // each stream tagged with the addon it came from; one slow or broken
  // addon only costs its own streams.
  return { seeders: seeders, describeStream: describeStream, largeImage: largeImage, isTorrent: isTorrent, sortStreams: sortStreams };
}

if (typeof module !== 'undefined') module.exports = createStremioStreamPresentation;
