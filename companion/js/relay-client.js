'use strict';

// WebSocket client for the relay (see relay/PROTOCOL.md), companion
// side. Unlike the TV, a companion doesn't register on connect -- it
// only joins a room once it has a code, either from a scanned/typed code
// or a remembered one from a previous session (decision #2 in PLAN.md).
function createRelayClient(config, handlers) {
  var socket = null;
  var reconnectAttempts = 0;
  var reconnectTimer = null;
  var pendingCode = null; // requested but not yet confirmed by 'joined'
  var joinedCode = null; // confirmed by the relay

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
      // A dropped connection needs to rejoin the room it thinks it's
      // still in -- there's no session to resume server-side, just a
      // fresh 'join' with the same code.
      var rejoin = pendingCode || joinedCode;
      if (rejoin) send({ type: 'join', role: 'companion', code: rejoin });
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
        joinedCode = msg.code;
        pendingCode = null;
        handlers.onJoined(msg.code);
        break;
      case 'status':
        if (msg.state === 'tv_offline') joinedCode = null;
        handlers.onStatus(msg);
        break;
      case 'error':
        if (msg.code === 'TV_NOT_FOUND') joinedCode = null;
        handlers.onError(msg);
        break;
      default:
        break;
    }
  }

  function join(code) {
    pendingCode = code;
    joinedCode = null;
    if (!send({ type: 'join', role: 'companion', code: code })) {
      // Not connected yet -- connect() sends the join once the socket
      // opens, via pendingCode.
      connect();
    }
  }

  function sendCommand(action, payload) {
    var message = { type: 'command', action: action };
    if (payload) message.payload = payload;
    send(message);
  }

  function isPaired() {
    return !!joinedCode;
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
    join: join,
    sendCommand: sendCommand,
    isPaired: isPaired
  };
}
