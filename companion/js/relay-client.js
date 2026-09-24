'use strict';

// WebSocket client for the relay (see relay/PROTOCOL.md), companion
// side. No pairing: the companion joins as soon as it connects, and
// stays joined to whatever TV the relay currently has.
function createRelayClient(config, handlers) {
  var socket = null;
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
      send({ type: 'join', role: 'companion' });
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
      case 'joined':
        handlers.onJoined();
        break;
      case 'status':
        handlers.onStatus(msg);
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
