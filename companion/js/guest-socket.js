'use strict';

// For guests: a stand-in for WebSocket that reaches their own casting
// channel on the guest door (guest-cast.js) instead of the relay. It
// receives over server-sent events and sends with POST, and has the parts
// of WebSocket that relay-client.js and browser-receiver.js use:
// readyState, onopen, onmessage, onclose, onerror, send and close. Loaded
// after config.js; it only takes over on the guest door.
function GuestSocket() {
  var self = this;
  self.readyState = GuestSocket.CONNECTING;
  self.conn = '';
  var events = new EventSource('/api/cast/stream');
  self._events = events;
  events.onmessage = function (event) {
    var msg;
    try { msg = JSON.parse(event.data); } catch (_) { return; }
    if (msg.type === '_open') {
      self.conn = msg.conn;
      self.readyState = GuestSocket.OPEN;
      if (self.onopen) self.onopen({});
      return;
    }
    if (self.onmessage) self.onmessage({ data: event.data });
  };
  // EventSource would quietly retry on its own; the pages already
  // reconnect after a close, so hand it back to them instead.
  events.onerror = function () { self.close(); };
}
GuestSocket.CONNECTING = 0;
GuestSocket.OPEN = 1;
GuestSocket.CLOSING = 2;
GuestSocket.CLOSED = 3;
GuestSocket.prototype.send = function (data) {
  if (this.readyState !== GuestSocket.OPEN) return;
  var self = this;
  var message;
  try { message = JSON.parse(data); } catch (_) { return; }
  fetch('/api/cast/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conn: this.conn, message: message })
  }).then(function (res) { if (res.status === 404) self.close(); }, function () { self.close(); });
};
GuestSocket.prototype.close = function () {
  if (this.readyState === GuestSocket.CLOSED) return;
  this.readyState = GuestSocket.CLOSED;
  this._events.close();
  if (this.onerror) this.onerror({});
  if (this.onclose) this.onclose({});
};

if (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.GUEST) {
  APP_CONFIG.RELAY_SOCKET = GuestSocket;
  // Owner-only links (tools) hide on guest pages (.cn-owner-only).
  document.documentElement.classList.add('cn-guest');
}
