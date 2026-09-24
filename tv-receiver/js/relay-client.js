'use strict';

// WebSocket client for the relay (see relay/PROTOCOL.md). Registers as
// the TV on every connection -- no code, no resume token, since there's
// no pairing to reclaim.
function createRelayClient(config, handlers) {
  var socket = null;
  var reconnectAttempts = 0;
  var reconnectTimer = null;
  var closedByApp = false;
  var log = createLogger('relay');

  function scheduleReconnect() {
    if (closedByApp) return;
    var delay = Math.min(
      config.RECONNECT_BASE_DELAY_MS * Math.pow(2, reconnectAttempts),
      config.RECONNECT_MAX_DELAY_MS
    );
    reconnectAttempts += 1;
    log.info('reconnecting in ' + delay + 'ms (attempt ' + reconnectAttempts + ')');
    handlers.onReconnecting(delay);
    reconnectTimer = setTimeout(connect, delay);
  }

  function send(message) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      // Playback position ticks go out every ~500ms while playing --
      // logging each one would bury everything else.
      if (!(message.type === 'status' && message.positionSec !== undefined)) {
        log.info('-> send', message);
      }
      socket.send(JSON.stringify(message));
    } else {
      log.warn('dropped (socket not open)', message);
    }
  }

  function handleMessage(msg) {
    switch (msg.type) {
      case 'registered':
        handlers.onRegistered();
        break;
      case 'command':
        handlers.onCommand(msg);
        break;
      case 'error':
        handlers.onRelayError(msg);
        break;
      default:
        log.warn('unknown message type', msg);
        break;
    }
  }

  function connect() {
    clearTimeout(reconnectTimer);
    closedByApp = false;

    log.info('connecting to ' + config.RELAY_URL);
    socket = new WebSocket(config.RELAY_URL);

    socket.onopen = function () {
      log.info('connected');
      reconnectAttempts = 0;
      send({ type: 'register', role: 'tv' });
    };

    socket.onmessage = function (event) {
      var msg;
      try {
        msg = JSON.parse(event.data);
      } catch (e) {
        log.warn('ignoring non-JSON message', event.data);
        return;
      }
      log.info('<- recv', msg);
      handleMessage(msg);
    };

    socket.onclose = function (event) {
      log.warn('closed code=' + event.code + ' reason=' + (event.reason || '(none)') + ' clean=' + event.wasClean);
      handlers.onDisconnected();
      scheduleReconnect();
    };

    socket.onerror = function () {
      log.error('socket error (close follows)');
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
    log.info('closing (by app)');
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
