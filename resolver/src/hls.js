'use strict';

// The playlist of a film that's still saving, made to look finished.
//
// ffmpeg writes an "event" playlist that grows as segments land. Samsung's
// player treats one like live TV: it starts at the newest segment, i.e.
// wherever the download has got to, and ignores EXT-X-START. So while a
// film is saving, the TV gets a VOD playlist for the whole film instead:
// the segments on disk as they are, then placeholders for the rest, named
// the way ffmpeg will name them (seg00042.ts, ...). The TV starts at the
// beginning, its seek bar shows the full length, and a request for a
// segment that isn't saved yet waits for it (index.js).
//
// Placeholders assume SEGMENT_SEC each. With video copied as is, ffmpeg
// cuts at keyframes, so real segments run a bit longer and there end up
// being fewer than listed: the timeline is approximate past what's saved,
// and the last few placeholders never exist (once the film is saved,
// index.js answers those empty, so the TV just reaches the end). Never
// more real segments than listed, though: each is at least SEGMENT_SEC,
// so the end of the film is never cut off.
function fullLengthPlaylist(text, durationSec, segmentSec) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const header = [];
  const segments = [];
  let pendingInf = null;
  // Tags between segments (EXT-X-DISCONTINUITY where a continued download
  // joins the saved part) stay right before the segment they belong to.
  let pendingTags = [];
  let savedSec = 0;
  lines.forEach((line) => {
    if (line.startsWith('#EXTINF:')) {
      pendingInf = line;
      savedSec += parseFloat(line.slice(8)) || 0;
    } else if (!line.startsWith('#')) {
      if (pendingInf) segments.push([...pendingTags, pendingInf, line]);
      pendingInf = null;
      pendingTags = [];
    } else if (line === '#EXT-X-ENDLIST') {
      // Finished after all: nothing to add.
    } else if (line.startsWith('#EXT-X-PLAYLIST-TYPE') || line.startsWith('#EXT-X-START')) {
      // Replaced below.
    } else if (segments.length || line === '#EXT-X-DISCONTINUITY') {
      pendingTags.push(line);
    } else {
      header.push(line);
    }
  });

  const out = [];
  header.forEach((line) => {
    if (line.startsWith('#EXT-X-TARGETDURATION:')) {
      const target = Math.max(parseInt(line.slice(22), 10) || 0, Math.ceil(segmentSec));
      out.push(`#EXT-X-TARGETDURATION:${target}`);
    } else {
      out.push(line);
    }
    if (line === '#EXTM3U') {
      out.push('#EXT-X-PLAYLIST-TYPE:VOD');
      out.push('#EXT-X-START:TIME-OFFSET=0');
    }
  });
  segments.forEach((seg) => out.push(...seg));

  let next = segments.length;
  let remaining = durationSec - savedSec;
  while (remaining > 0.5) {
    const len = Math.min(segmentSec, remaining);
    out.push(`#EXTINF:${len.toFixed(6)},`, `seg${String(next).padStart(5, '0')}.ts`);
    next++;
    remaining -= len;
  }
  out.push('#EXT-X-ENDLIST');
  return out.join('\n') + '\n';
}

module.exports = { fullLengthPlaylist };
