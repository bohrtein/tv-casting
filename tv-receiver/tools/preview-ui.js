'use strict';
// Local visual fixtures: no connection to the real relay or user's media.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.ttf':'font/ttf' };
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/remote') {
    const source = fs.readFileSync(path.join(root, 'companion/stremio.html'), 'utf8');
    const markup = source.slice(source.indexOf('<section id="remote-sheet"'), source.indexOf('<div class="mx-overlay" id="addon-sheet"'));
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/companion/matrix/matrix.css"><link rel="stylesheet" href="/companion/css/app.css"><link rel="stylesheet" href="/companion/css/remote.css"><body class="mx mx-has-nav cn-st">' + markup +
      '<p id="fixture-command" role="status"></p><script src="/companion/js/remote-controls.js"></script><script src="/companion/js/remote-sheet.js"></script><script>' +
      'var fixture={state:"playing",targetId:"tv",title:"Caption preview",positionSec:42,durationSec:120,captions:{supported:true,mediaId:"1",tracks:[{id:"embedded:2",label:"English"},{id:"embedded:3",label:"French"}],selectedId:null}};' +
      'var remote=createRemoteControls({sendCommand:function(action,payload){document.getElementById("fixture-command").textContent=JSON.stringify({action:action,payload:payload});if(action==="captions"){fixture.captions.selectedId=payload.trackId;remote.render(fixture);}return true;}},{clear:function(){}},{resolveSubtitle:function(){return Promise.resolve("http://fixture/subtitle.smi");}});remote.render(fixture);createRemoteSheet(document.getElementById("remote-sheet"));</script>');
    return;
  }
  const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  if (url.pathname === '/tv-receiver/js/relay-client.js') {
    res.setHeader('Content-Type','text/javascript');
    res.end('function createRelayClient(c,h){return {connect:function(){h.onRegistered();},sendStatus:function(){}};}'); return;
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type',types[path.extname(file)] || 'application/octet-stream');
    if (url.pathname === '/tv-receiver/index.html') data = data.toString().replace('<script src="$WEBAPIS/webapis/webapis.js"></script>', '');
    res.end(data);
  });
}).listen(8879,'127.0.0.1', () => console.log('UI fixtures: http://127.0.0.1:8879/tv-receiver/index.html and /remote'));
