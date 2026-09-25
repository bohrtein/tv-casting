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
    var link = document.createElement('a'); link.className = 'mx-btn mx-sm'; link.href = 'receiver.html'; link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'Open receiver'; holder.appendChild(link);
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
  if (typeof BroadcastChannel !== 'undefined') {
    var receiverChannel = new BroadcastChannel('tvc.receiver');
    receiverChannel.onmessage = function (event) {
      if (event.data && event.data.type === 'select-receiver' && /^browser-[\w-]+$/.test(event.data.targetId || '')) selectTarget(event.data.targetId);
    };
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

  function sendCommand(action, payload) {
    var message = { type: 'command', action: action };
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
    sendCommand: sendCommand
  };
}
