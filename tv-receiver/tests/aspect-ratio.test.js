'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
test('AVPlay contain fit centers 16:9, 4:3, ultrawide and portrait at different viewports', () => {
  for (const [width, height] of [[1920,1080], [1440,1080], [2390,1000], [1080,1920]]) {
    for (const [sw, sh] of [[1920,1080], [1280,720], [3840,2160]]) {
      let rectangle, mode, prepared, listener;
      const surface = { style: {} };
      const avplay = {
        open() {}, close() {}, stop() {}, play() {}, getDuration: () => 100000,
        setListener(l) { listener = l; }, prepareAsync(ok) { prepared = ok; },
        setDisplayRect(...r) { rectangle = r; }, setDisplayMethod(m) { mode = m; },
        getCurrentStreamInfo: () => [{type:'VIDEO', extra_info: JSON.stringify({Width:width, Height:height})}]
      };
      const context = vm.createContext({
        webapis: {avplay}, window: {innerWidth:sw, innerHeight:sh, addEventListener(){}},
        document: {getElementById:()=>surface, addEventListener(){}},
        createLogger:()=>({info(){},warn(){},error(){}}), clearTimeout(){}, setTimeout(){}
      });
      vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/player.js'),'utf8'),context);
      const player = context.createPlayer({onStateChange(){},onPlayTime(){},onError(e){throw Error(e.message);}});
      player.play('fixture.mp4'); prepared();
      assert.equal(mode, 'PLAYER_DISPLAY_MODE_LETTER_BOX');
      const [x,y,w,h] = rectangle;
      assert.ok(Math.abs(w/h - width/height) < 0.004);
      assert.ok(Math.abs(x*2+w-1920) <= 1); assert.ok(Math.abs(y*2+h-1080) <= 1);
      assert.ok(w<=1920 && h<=1080);
      assert.equal(parseFloat(surface.style.width) / parseFloat(surface.style.height), width/height);
      assert.ok(listener);
    }
  }
});
