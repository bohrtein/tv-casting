'use strict';

// WebSocket client for the relay (see relay/PROTOCOL.md). Registers as a
// TV on every connection, but carries a resumeToken (handed out with the
// first 'registered' reply) across reconnects within the same app
// session, so a wifi blip or relay hiccup reclaims the *same* room code
// instead of stranding the companion with a stale one -- it's a plain JS
// variable, not persisted anywhere, so a genuine app restart still starts
// with none and gets a brand new code, same as decision #2 in PLAN.md.
function createRelayClient(config, handlers) {
  var socket = null;
  var reconnectAttempts = 0;
  var reconnectTimer = null;
  var closedByApp = false;
  var resume = null; // { code, token } from the most recent 'registered'

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
        resume = { code: msg.code, token: msg.resumeToken };
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
      var message = { type: 'register', role: 'tv' };
      if (resume) message.resume = resume;
      send(message);
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
