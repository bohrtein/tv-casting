'use strict';

// One classification rule for catalog previews, downloads and saved media.
var ContentPolicy = (function () {
  function restricted(item) {
    item = item || {};
    var m = item.metadata || item;
    if (item.category === 'porn' || item.category === 'plus18' || m.addon === 'plus18') return true;
    if (m.adult === true || Number(m.age_limit || m.ageRating) >= 18) return true;
    if ([].concat(m.genres || [], m.categories || []).some(function (g) { return /^(adult|porn|pornography|xxx|18\+)$/i.test(g); })) return true;
    return /(?:pornhub|xvideos|xnxx|xhamster|youporn|redtube)/i.test(item.extractor || '') ||
      /^https?:\/\/(?:[^/]+\.)?(?:pornhub\.com|xvideos\.com|xnxx\.com|xhamster\.com|youporn\.com|redtube\.com)(?:[/:]|$)/i.test(item.sourceUrl || '');
  }
  function mode() {
    try { return localStorage.getItem('tvc.contentMode') === 'plus18' ? 'plus18' : 'normal'; } catch (_) { return 'normal'; }
  }
  function setMode(value) {
    try { localStorage.setItem('tvc.contentMode', value === 'plus18' ? 'plus18' : 'normal'); } catch (_) {}
  }
  function visible(item) { return mode() === 'plus18' || !restricted(item); }
  return { restricted: restricted, mode: mode, setMode: setMode, visible: visible };
})();
if (typeof module !== 'undefined') module.exports = ContentPolicy;
