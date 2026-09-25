'use strict';

// Shared addon URLs remain a TV Casting setting. Core owns every fetched
// descriptor and all addon capability checks after these URLs are installed.
function createStremioSettings(config) {
  var NORMAL_KEY = 'tvc.stremio.addons';
  var ADULT_KEY = 'tvc.stremio.plus18';
  var MERGED_KEY = 'tvc.stremio.addonsShared';
  var SERVER_KEY = 'tvc.stremio.server';

  function read(key, fallback) {
    try { var value = localStorage.getItem(key); return value === null ? fallback : JSON.parse(value); }
    catch (e) { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }
  function key(section) { return section === 'plus18' ? ADULT_KEY : NORMAL_KEY; }
  function getUrls(section) {
    var urls = read(key(section), null);
    return Array.isArray(urls) ? urls.slice() : section === 'plus18' ? [] : (config.STREMIO_ADDONS || []).slice();
  }
  function normalize(input) {
    var url = String(input || '').trim().replace(/^stremio:\/\//i, 'https://');
    if (!/^https?:\/\//i.test(url)) throw new Error('An addon URL starts with https:// or stremio://');
    if (!/\/manifest\.json$/i.test(url)) url = url.replace(/\/+$/, '') + '/manifest.json';
    new URL(url);
    return url;
  }
  function request(body) {
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, 5000);
    return fetch('api/stremio-settings', {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
      signal: controller ? controller.signal : undefined
    }).then(function (response) {
      clearTimeout(timer);
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    }, function (error) { clearTimeout(timer); throw error; });
  }
  function remember(saved) {
    write(NORMAL_KEY, saved.addons || []);
    write(ADULT_KEY, saved.plus18 || []);
    write(MERGED_KEY, true);
  }
  function sync() {
    var before = JSON.stringify([getUrls('normal'), getUrls('plus18')]);
    return request().then(function (shared) {
      var local = read(NORMAL_KEY, null);
      if (!shared.addons) {
        return request({ addons: getUrls('normal'), plus18: getUrls('plus18') });
      }
      if (!read(MERGED_KEY, false) && Array.isArray(local)) {
        var extra = local.filter(function (url) { return shared.addons.indexOf(url) === -1; });
        if (extra.length) return request({ addons: shared.addons.concat(extra), plus18: shared.plus18 || [] });
      }
      return shared;
    }).then(function (saved) {
      remember(saved);
      return JSON.stringify([getUrls('normal'), getUrls('plus18')]) !== before;
    });
  }
  function change(section, updater) {
    return sync().catch(function () {}).then(function () {
      var next = updater(getUrls(section));
      var body = { addons: section === 'normal' ? next : getUrls('normal'),
        plus18: section === 'plus18' ? next : getUrls('plus18') };
      return request(body).then(function (saved) { remember(saved); return true; }, function () {
        write(key(section), next);
        return false;
      });
    });
  }
  function getServerUrl() {
    var stored = read(SERVER_KEY, null);
    return String(stored === null ? config.STREMIO_SERVER_URL || '' : stored).replace(/\/+$/, '');
  }
  return {
    normalize: normalize, getUrls: getUrls, sync: sync, change: change,
    getServerUrl: getServerUrl,
    setServerUrl: function (value) { write(SERVER_KEY, String(value || '').trim()); }
  };
}

if (typeof module !== 'undefined') module.exports = createStremioSettings;
