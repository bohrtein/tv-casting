'use strict';

// Single funnel for receiver logging, so everything worth knowing lands in
// the devtools console once the web inspector is attached (Tizen VS Code
// extension's Debug Project, or the emulator's inspector). Each line is
// timestamped and tagged by area -- relay, player, app -- so the
// interleaved events can be lined up after the fact.
//
// Deliberately never uses console.debug: Chrome devtools hides the
// "Verbose" level by default, and the whole point is that nothing is
// filtered out of view.
function createLogger(tag) {
  function emit(method, args) {
    if (typeof console === 'undefined') return;
    var fn = console[method] || console.log;
    var prefix = new Date().toISOString().slice(11, 23) + ' [' + tag + ']';
    fn.apply(console, [prefix].concat(Array.prototype.slice.call(args)));
  }

  return {
    info: function () { emit('log', arguments); },
    warn: function () { emit('warn', arguments); },
    error: function () { emit('error', arguments); }
  };
}

// Errors thrown from inside native callbacks (AVPlay listeners, the
// webapis bridge) don't always surface as uncaught errors in the
// console on their own -- catch them globally so they can't vanish.
(function () {
  var log = createLogger('global');
  window.addEventListener('error', function (e) {
    log.error('uncaught error:', e.message, 'at ' + e.filename + ':' + e.lineno + ':' + e.colno, e.error || '');
  });
  window.addEventListener('unhandledrejection', function (e) {
    log.error('unhandled promise rejection:', e.reason);
  });
})();
