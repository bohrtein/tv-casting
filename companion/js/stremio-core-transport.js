'use strict';

// A small bridge to the official @stremio/stremio-core-web worker. Each section
// has its own worker and storage namespace, so Core itself never sees addons
// installed in the other section.
function createStremioCoreTransport(section) {
  var worker = new Worker('vendor/stremio-core/worker.js');
  var prefix = 'tvc.core.' + section + '.';
  var pending = {};
  var listeners = [];
  var nextId = 0;
  var failed = null;

  function reply(id, result) {
    worker.postMessage({ response: { id: id, result: result } });
  }

  function onMessage(event) {
    var data = event.data || {};
    if (data.request) {
      var request = data.request;
      try {
        var path = request.path.join('.');
        var value;
        if (path === 'location.hash') value = '';
        else if (path === 'localStorage.getItem') value = localStorage.getItem(prefix + request.args[0]);
        else if (path === 'localStorage.setItem') value = localStorage.setItem(prefix + request.args[0], request.args[1]);
        else if (path === 'localStorage.removeItem') value = localStorage.removeItem(prefix + request.args[0]);
        else if (path === 'onCoreEvent') {
          value = null;
          listeners.slice().forEach(function (listener) { listener(request.args[0]); });
        } else throw new Error('Unknown Core bridge path: ' + path);
        reply(request.id, { data: value });
      } catch (err) {
        reply(request.id, { error: { message: err.message } });
      }
      return;
    }
    if (data.response && pending[data.response.id]) {
      var task = pending[data.response.id];
      delete pending[data.response.id];
      if (data.response.result && 'error' in data.response.result) task.reject(data.response.result.error);
      else task.resolve(data.response.result.data);
    }
  }

  worker.addEventListener('message', onMessage);
  worker.addEventListener('error', function (event) {
    failed = new Error(event.message || 'Stremio Core worker failed.');
    Object.keys(pending).forEach(function (id) { pending[id].reject(failed); delete pending[id]; });
  });

  function call(path, args) {
    if (failed) return Promise.reject(failed);
    return new Promise(function (resolve, reject) {
      var id = String(++nextId);
      pending[id] = { resolve: resolve, reject: reject };
      worker.postMessage({ request: { id: id, path: path, args: args } });
    });
  }

  function onEvent(listener) {
    listeners.push(listener);
    return function () { listeners = listeners.filter(function (item) { return item !== listener; }); };
  }

  return {
    init: function () { return call(['init'], [{ appVersion: 'tv-casting/1', shellVersion: null }]); },
    getState: function (model) { return call(['getState'], [model]); },
    dispatch: function (action, model) { return call(['dispatch'], [action, model || null, '']); },
    onEvent: onEvent,
    close: function () { worker.terminate(); }
  };
}

if (typeof module !== 'undefined') module.exports = createStremioCoreTransport;
