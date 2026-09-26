'use strict';

// WebSocket client for the relay (see relay/PROTOCOL.md), companion
// side. No pairing: the companion joins as soon as it connects, and
// stays joined to whatever TV the relay currently has.
function createRelayClient(config, handlers) {
  var socket = null;
  var targetId = 'tv', targets = [];
  try { targetId = localStorage.getItem('tvc.target') || 'tv'; } catch (_) {}
  var select = document.createElement('select');
  select.className = 'mx-input'; select.setAttribute('aria-label', 'Playback target');
  var holder = document.querySelector('[data-relay-targets]') || document.querySelector('.mx-topbar-nav') || document.querySelector('.mx-topbar');
  if (holder) {
    var label = document.createElement('label'); label.className = 'tvc-target-label'; label.textContent = 'Play on '; label.appendChild(select); holder.appendChild(label);
  }
  function renderTargets() {
    select.innerHTML = '';
    var list = targets.slice();
    if (!list.some(function (t) { return t.id === targetId; })) list.push({ id: targetId, name: targetId === 'tv' ? 'TV' : 'Selected receiver', online: false });
    list.forEach(function (t) { var o = document.createElement('option'); o.value = t.id; o.textContent = t.name + (t.online ? '' : ' (offline)'); select.appendChild(o); });
    select.value = targetId;
  }
  function selectTarget(id) {
    targetId = id;
    renderTargets();
    handlers.onStatus({ state: 'idle', title: '', positionSec: 0, durationSec: 0 });
    try { localStorage.setItem('tvc.target', targetId); } catch (_) {}
    send({ type: 'select-target', targetId: targetId });
  }
  select.addEventListener('change', function () {
    selectTarget(select.value);
  });
  var receiverChannel = null;
  if (typeof BroadcastChannel !== 'undefined') {
    receiverChannel = new BroadcastChannel('tvc.receiver');
    receiverChannel.addEventListener('message', function (event) {
      if (event.data && event.data.type === 'select-receiver' && /^browser-[\w-]+$/.test(event.data.targetId || '')) selectTarget(event.data.targetId);
    });
  }

  // "Play on this device": open (or reuse) this browser's receiver tab,
  // turn it on, and resolve once it has registered and been selected
  // here. Call from a click handler, or the browser blocks the new tab;
  // that, or no BroadcastChannel, throws right away.
  function openLocalReceiver() {
    if (!receiverChannel) throw new Error('This browser cannot hand video to a receiver tab.');
    // Reuse an open receiver tab as it is (reloading it would cut off
    // whatever it's playing); only a brand-new tab gets the page.
    var win = window.open('', 'tvc-receiver');
    if (!win) throw Object.assign(new Error('The browser blocked the receiver tab.'), { code: 'POPUP_BLOCKED' });
    var fresh = true;
    try { fresh = win.location.href === 'about:blank'; } catch (_) {}
    if (fresh) win.location.href = new URL('receiver.html?auto=1', location.href).href;
    else win.focus();
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        receiverChannel.removeEventListener('message', onMessage);
        reject(new Error('The receiver tab did not connect to the relay.'));
      }, 20000);
      function onMessage(event) {
        if (!event.data || event.data.type !== 'select-receiver' || !event.data.local) return;
        clearTimeout(timer);
        receiverChannel.removeEventListener('message', onMessage);
        resolve(event.data.targetId);
      }
      receiverChannel.addEventListener('message', onMessage);
      // An already-open receiver tab answers this; a new one announces
      // itself once it registers.
      receiverChannel.postMessage({ type: 'find-receiver' });
    });
  }
  renderTargets();
  var reconnectAttempts = 0;
  var reconnectTimer = null;

  function send(message) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
      return true;
    }
    return false;
  }

  function scheduleReconnect() {
    var delay = Math.min(
      config.RECONNECT_BASE_DELAY_MS * Math.pow(2, reconnectAttempts),
      config.RECONNECT_MAX_DELAY_MS
    );
    reconnectAttempts += 1;
    reconnectTimer = setTimeout(connect, delay);
  }

  function connect() {
    clearTimeout(reconnectTimer);
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    socket = new WebSocket(config.RELAY_URL);

    socket.onopen = function () {
      reconnectAttempts = 0;
      handlers.onConnected();
      send({ type: 'join', role: 'companion', targetId: targetId });
    };

    socket.onmessage = function (event) {
      var msg;
      try {
        msg = JSON.parse(event.data);
      } catch (e) {
        return;
      }
      handleMessage(msg);
    };

    socket.onclose = function () {
      handlers.onDisconnected();
      scheduleReconnect();
    };

    socket.onerror = function () {
      // 'close' always follows; reconnect scheduling lives there.
    };
  }

  function handleMessage(msg) {
    switch (msg.type) {
      case 'targets':
        targets = msg.targets || []; renderTargets(); break;
      case 'joined':
        handlers.onJoined();
        break;
      case 'status':
        if (!msg.targetId || msg.targetId === targetId) handlers.onStatus(msg);
        break;
      case 'error':
        handlers.onError(msg);
        break;
      default:
        break;
    }
  }

  // Off the Wi-Fi (Tailscale) the resolver hands back URLs on the host this
  // page reached it through, which the TV can't; it only knows the LAN IP.
  function forTv(url) {
    if (typeof url !== 'string' || !config.LAN_HOST || !config.SERVER_HOST || config.SERVER_HOST === config.LAN_HOST) return url;
    try {
      var parsed = new URL(url);
      if (parsed.hostname !== config.SERVER_HOST) return url;
      parsed.hostname = config.LAN_HOST;
      return parsed.toString();
    } catch (_) { return url; }
  }

  function sendCommand(action, payload) {
    var message = { type: 'command', action: action };
    if (payload && action === 'play' && targetId === 'tv') {
      payload = Object.assign({}, payload, { url: forTv(payload.url) });
      if (payload.subtitleUrl) payload.subtitleUrl = forTv(payload.subtitleUrl);
    }
    if (payload) message.payload = payload;
    return send(message);
  }

  // Mobile browsers throttle timers (including our backoff setTimeout)
  // in a backgrounded tab and may kill the socket outright -- waiting
  // out a stale backoff after the user switches back would make casting
  // feel broken for no reason, so reconnect immediately on foreground
  // instead. connect() already no-ops if a socket is open/connecting.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') connect();
  });

  return {
    connect: connect,
    sendCommand: sendCommand,
    openLocalReceiver: openLocalReceiver
  };
}
