'use strict';

// Talks to Jellyfin directly -- never through the relay (root README.md
// hard rule). Session (server URL, user id, access token) persists via
// MX.store (localStorage) per decision #6 in PLAN.md: log in once, reuse
// the token until it expires or is revoked.
function createJellyfinClient() {
  var CLIENT_NAME = 'tv-casting';
  var DEVICE_NAME = 'TV Casting Companion';
  var APP_VERSION = '0.1.0';

  function getDeviceId() {
    var id = MX.store.get('jf.deviceId', null);
    if (!id) {
      id = 'cmp-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
      MX.store.set('jf.deviceId', id);
    }
    return id;
  }

  function authHeader(token) {
    var parts = [
      'MediaBrowser Client="' + CLIENT_NAME + '"',
      'Device="' + DEVICE_NAME + '"',
      'DeviceId="' + getDeviceId() + '"',
      'Version="' + APP_VERSION + '"'
    ];
    if (token) parts.push('Token="' + token + '"');
    return parts.join(', ');
  }

  function normalizeServerUrl(url) {
    return url.replace(/\/+$/, '');
  }

  function getSession() {
    return {
      serverUrl: MX.store.get('jf.serverUrl', null),
      accessToken: MX.store.get('jf.accessToken', null),
      userId: MX.store.get('jf.userId', null)
    };
  }

  function isAuthenticated() {
    var s = getSession();
    return !!(s.serverUrl && s.accessToken && s.userId);
  }

  function signOut() {
    MX.store.set('jf.serverUrl', '');
    MX.store.set('jf.accessToken', '');
    MX.store.set('jf.userId', '');
  }

  function authenticate(serverUrl, username, password) {
    serverUrl = normalizeServerUrl(serverUrl);
    return fetch(serverUrl + '/Users/AuthenticateByName', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Emby-Authorization': authHeader(null)
      },
      body: JSON.stringify({ Username: username, Pw: password })
    }).then(function (res) {
      if (!res.ok) throw new Error('Sign-in failed (HTTP ' + res.status + ')');
      return res.json();
    }).then(function (data) {
      MX.store.set('jf.serverUrl', serverUrl);
      MX.store.set('jf.accessToken', data.AccessToken);
      MX.store.set('jf.userId', data.User.Id);
      return data;
    });
  }

  function authedFetch(path) {
    var session = getSession();
    return fetch(session.serverUrl + path, {
      headers: {
        'X-Emby-Authorization': authHeader(session.accessToken),
        'X-Emby-Token': session.accessToken
      }
    }).then(function (res) {
      if (!res.ok) throw new Error('Jellyfin request failed (HTTP ' + res.status + ')');
      return res.json();
    });
  }

  function getLibraries() {
    var session = getSession();
    return authedFetch('/Users/' + session.userId + '/Views').then(function (data) {
      return data.Items || [];
    });
  }

  // Works for any folder-like parent (a top-level library, a Series, a
  // Season) -- Jellyfin's /Items endpoint is generic over item type, so
  // one drill-down function covers the whole library tree.
  function getChildren(parentId) {
    var session = getSession();
    var qs = 'ParentId=' + encodeURIComponent(parentId) +
      '&SortBy=IsFolder,SortName&SortOrder=Descending,Ascending';
    return authedFetch('/Users/' + session.userId + '/Items?' + qs).then(function (data) {
      return data.Items || [];
    });
  }

  // HLS via Jellyfin's transcoding endpoint -- broadly compatible with
  // AVPlay without negotiating per-device codec profiles (PlaybackInfo),
  // which is more machinery than a single-TV home setup needs.
  function getStreamUrl(itemId) {
    var session = getSession();
    return session.serverUrl + '/Videos/' + itemId + '/master.m3u8?api_key=' +
      encodeURIComponent(session.accessToken);
  }

  return {
    isAuthenticated: isAuthenticated,
    getSession: getSession,
    authenticate: authenticate,
    signOut: signOut,
    getLibraries: getLibraries,
    getChildren: getChildren,
    getStreamUrl: getStreamUrl
  };
}
