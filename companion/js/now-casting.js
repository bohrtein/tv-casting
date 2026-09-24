'use strict';

// What this browser last cast, shared by index.html and stremio.html and
// kept across reloads (localStorage), so pausing on one page and pressing
// play on the other, or after the phone reloaded the page, still resumes.
//
// resumeCommand(statusTitle) picks how to resume:
//   - "play" with the same url, when the TV is showing what we cast (its
//     status title matches). The TV treats "same url already loaded" as a
//     resume, and every TV build understands it.
//   - "resume" otherwise (cast from another phone, or nothing stored): no
//     url needed, the TV un-pauses whatever it has loaded. Needs a TV
//     receiver and relay that know the action (PROTOCOL.md).
// Never re-sends a stored url the TV isn't playing, which would switch
// the TV to an older film instead of resuming.
function createNowCasting() {
  var KEY = 'tvc.nowCasting';

  function get() {
    try {
      var v = JSON.parse(localStorage.getItem(KEY) || 'null');
      return v && v.url ? v : null;
    } catch (e) {
      return null;
    }
  }

  function set(url, title) {
    try {
      localStorage.setItem(KEY, JSON.stringify({ url: url, title: title || '' }));
      memory = null;
    } catch (e) {
      // Private mode: resume still works on this page until a reload.
      memory = { url: url, title: title || '' };
    }
  }

  function clear() {
    try { localStorage.removeItem(KEY); } catch (e) { /* nothing stored */ }
    memory = null;
  }

  var memory = null;

  function current() {
    return get() || memory;
  }

  function resumeCommand(statusTitle) {
    var cast = current();
    if (cast && (statusTitle || '') === cast.title) {
      return { action: 'play', payload: { url: cast.url, title: cast.title } };
    }
    return { action: 'resume' };
  }

  return { set: set, clear: clear, current: current, resumeCommand: resumeCommand };
}
