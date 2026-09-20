'use strict';

// WebSocket client for the relay (see relay/PROTOCOL.md). Always
// registers fresh as a TV on every connection/reconnect — the relay
// never lets a TV reclaim an old room code (decision #2 in PLAN.md), so
// there's nothing to resume here, just reconnect-with-backoff and take
// whatever new code comes back.
function createRelayClient(config, handlers) {
  var socket = null;
  var reconnectAttempts = 0;
  var reconnectTimer = null;
  var closedByApp = false;

  function scheduleReconnect() {
    if (closedByApp) return;
    var delay = Math.min(
      config.RECONNECT_BASE_DELAY_MS * Math.pow(2, reconnectAttempts),
      config.RECONNECT_MAX_DELAY_MS
    );
    reconnectAttempts += 1;
    handlers.onReconnecting(delay);
    reconnectTimer = setTimeout(connect, delay);
  }

  function send(message) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  function handleMessage(msg) {
    switch (msg.type) {
      case 'registered':
        handlers.onRegistered(msg.code);
        break;
      case 'command':
        handlers.onCommand(msg);
        break;
      case 'error':
        handlers.onRelayError(msg);
        break;
      default:
        break;
    }
  }

  function connect() {
    clearTimeout(reconnectTimer);
    closedByApp = false;

    socket = new WebSocket(config.RELAY_URL);

    socket.onopen = function () {
      reconnectAttempts = 0;
      send({ type: 'register', role: 'tv' });
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
      // The browser always follows an 'error' event with 'close' for a
      // WebSocket, so reconnect scheduling lives in onclose only.
    };
  }

  function sendStatus(statusFields) {
    var message = { type: 'status' };
    for (var key in statusFields) {
      if (Object.prototype.hasOwnProperty.call(statusFields, key)) {
        message[key] = statusFields[key];
      }
    }
    send(message);
  }

  function close() {
    closedByApp = true;
    clearTimeout(reconnectTimer);
    if (socket) socket.close();
  }

  return {
    connect: connect,
    sendStatus: sendStatus,
    close: close
  };
}
