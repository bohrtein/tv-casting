'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function setup() {
  function node() { return { value: '', textContent: '', disabled: false, children: [], handlers: {}, style: { setProperty() {} },
    addEventListener(name, fn) { this.handlers[name] = fn; }, appendChild(child) { this.children.push(child); },
    set innerHTML(value) { this.children = []; } }; }
  const nodes = {}, commands = [];
  let converted;
  const context = vm.createContext({ document: { getElementById(id) { return nodes[id] || (nodes[id] = node()); }, createElement: node } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/remote-controls.js'), 'utf8'), context);
  const relay = { sendCommand(action, payload) { commands.push({action, payload}); return true; } };
  const remote = context.createRemoteControls(relay, { clear() {} }, { resolveSubtitle() { return new Promise(resolve => { converted = resolve; }); } });
  const status = { state: 'playing', targetId: 'tv', captions: { supported: true, mediaId: '2', tracks: [{id:'embedded:2',label:'English'}], selectedId: null } };
  remote.render(status);
  return { nodes, commands, remote, relay, status, convert: url => converted(url) };
}
test('companion captions show reported tracks and send track/Off commands to current media', () => {
  const app = setup(), select = app.nodes['remote-captions'];
  assert.deepEqual(select.children.map(c => c.textContent), ['Off','English']);
  assert.equal(select.disabled, false);
  select.value = 'embedded:2'; select.handlers.change();
  assert.equal(app.commands[0].action, 'captions');
  assert.equal(app.commands[0].payload.mediaId, '2');
  assert.equal(app.commands[0].payload.trackId, 'embedded:2');
  app.status.state = 'paused'; app.status.captions.selectedId = 'embedded:2'; app.remote.render(app.status);
  assert.equal(select.value, 'embedded:2');
  select.value = ''; select.handlers.change();
  assert.equal(app.commands[1].payload.trackId, null);
  app.remote.render({state:'playing',targetId:'browser-test'});
  assert.equal(select.disabled, true);
  assert.match(app.nodes['remote-captions-note'].textContent, /unavailable/);
});
test('subtitle conversion is cancelled when target or movie changes or receiver disconnects', async () => {
  for (const next of [{state:'idle'}, {state:'tv_offline'}, {state:'playing',targetId:'browser-new'}, {state:'playing',targetId:'tv',captions:{supported:true,mediaId:'3',tracks:[]}}]) {
    const app = setup();
    app.nodes['remote-caption-url'].value = 'https://example.com/captions.srt';
    app.nodes['remote-caption-load'].handlers.click();
    app.remote.render(next);
    app.convert('http://local/captions.smi');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(app.commands.length, 0);
  }
});
test('external subtitle link is resolved before a live caption command is sent', async () => {
  const app = setup();
  app.nodes['remote-caption-url'].value = 'https://example.com/captions.srt';
  app.nodes['remote-caption-load'].handlers.click();
  assert.equal(app.commands.length, 0);
  app.convert('http://local/captions.smi');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.commands[0].payload.subtitleUrl, 'http://local/captions.smi');
  assert.equal(app.commands[0].payload.mediaId, '2');
});

test('caption connection errors stay visible across playback status updates', () => {
  const app = setup(); app.relay.sendCommand = () => false;
  app.nodes['remote-captions'].value = 'embedded:2';
  app.nodes['remote-captions'].handlers.change();
  app.remote.render(app.status);
  assert.match(app.nodes['remote-captions-note'].textContent, /Not connected/);
  assert.equal(app.nodes['remote-captions'].value, '');
});
