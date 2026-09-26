'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { chromium } = require('playwright-core');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const browserAvailable = process.env.TEST_BROWSER_RECEIVER === '1' && fs.existsSync(chromePath);

test('opening a browser receiver selects its named target and keeps it on reconnect',
  { skip: !browserAvailable, timeout: 45000 }, async () => {
    const relay = spawn(process.execPath, ['src/index.js'], {
      cwd: path.join(__dirname, '..', '..', 'relay'), env: { ...process.env, PORT: '0' }
    });
    let companion, browser, stage = 'starting relay';
    try {
      const [line] = await once(relay.stdout, 'data');
      const relayPort = /listening on :(\d+)/.exec(String(line))[1];
      stage = 'starting companion';
      const probe = http.createServer();
      await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
      const companionPort = probe.address().port;
      await new Promise(resolve => probe.close(resolve));
      companion = spawn(process.execPath, ['serve.js'], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, PORT: String(companionPort), RELAY_URL: `ws://127.0.0.1:${relayPort}` }
      });
      const origin = `http://127.0.0.1:${companionPort}`;
      for (let i = 0; i < 40; i++) {
        try { if ((await fetch(origin + '/receiver.html')).ok) break; } catch (_) {}
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      browser = await chromium.launch({ executablePath: chromePath, headless: true });
      const context = await browser.newContext();
      const companionPage = await context.newPage();
      companionPage.setDefaultTimeout(5000);
      stage = 'loading companion';
      await companionPage.goto(origin + '/tools.html');
      stage = 'waiting for companion target menu';
      await companionPage.locator('select[aria-label="Playback target"] option').first().waitFor({ state: 'attached' });
      stage = 'opening receiver';
      await companionPage.getByRole('button', { name: 'receiver', exact: true }).click();
      const [receiverPage] = await Promise.all([
        context.waitForEvent('page'),
        companionPage.getByRole('link', { name: 'Open receiver', exact: true }).click()
      ]);
      await receiverPage.waitForLoadState();
      receiverPage.setDefaultTimeout(5000);
      stage = 'enabling receiver';
      await receiverPage.locator('#receiver-name').fill('Office laptop');
      await receiverPage.getByRole('button', { name: 'Save' }).click();
      await receiverPage.locator('#receiver-enabled').check({ force: true });
      await receiverPage.getByText('On as Office laptop').waitFor();
      stage = 'waiting for automatic target selection';
      await companionPage.waitForFunction(() => document.querySelector('select[aria-label="Playback target"] option:checked')?.textContent === 'Office laptop');
      const selected = await companionPage.locator('select[aria-label="Playback target"]').inputValue();
      assert.match(selected, /^browser-/);
      stage = 'reloading receiver';
      await receiverPage.reload();
      // Still on after a reload, under the same target.
      await receiverPage.getByText('On as Office laptop').waitFor();
      assert.equal(await companionPage.locator('select[aria-label="Playback target"]').inputValue(), selected);
      stage = 'renaming receiver';
      await receiverPage.locator('#receiver-name').fill('Den laptop');
      await receiverPage.getByRole('button', { name: 'Save' }).click();
      await companionPage.waitForFunction(() => document.querySelector('select[aria-label="Playback target"] option:checked')?.textContent === 'Den laptop');
      // The same call stremio.html's "play on this device" button makes.
      const playHere = (title) => companionPage.evaluate((title) => {
        const noop = () => {};
        const client = createRelayClient(APP_CONFIG, { onConnected: noop, onDisconnected: noop, onJoined: noop, onStatus: noop, onError: noop });
        client.connect();
        return client.openLocalReceiver().then((id) => {
          client.sendCommand('play', { url: location.origin + '/missing.mp4', title });
          return id;
        });
      }, title);
      stage = 'play on this device (reuses the open receiver tab)';
      assert.equal(await playHere('Local test'), selected);
      await receiverPage.locator('#receiver-title', { hasText: 'Local test' }).waitFor();
      stage = 'switching receiver off';
      await receiverPage.locator('#receiver-enabled').uncheck({ force: true });
      await companionPage.waitForFunction(() => document.querySelector('select[aria-label="Playback target"] option:checked')?.textContent.endsWith('(offline)'));
      assert.equal(await receiverPage.locator('#receiver-title').textContent(), '');
      stage = 'play on this device (switches the receiver back on)';
      assert.equal(await playHere('Back on'), selected);
      await receiverPage.locator('#receiver-title', { hasText: 'Back on' }).waitFor();
      assert.equal(await receiverPage.locator('#receiver-enabled').isChecked(), true);
      stage = 'play on this device (opens a new receiver tab)';
      await receiverPage.close();
      const [freshPage, freshId] = await Promise.all([context.waitForEvent('page'), playHere('Fresh tab')]);
      assert.match(freshId, /^browser-/);
      await freshPage.locator('#receiver-title', { hasText: 'Fresh tab' }).waitFor();
      assert.equal(await freshPage.locator('#receiver-enabled').isChecked(), true);
    } catch (error) {
      error.message = stage + ': ' + error.message;
      throw error;
    } finally {
      if (browser) await browser.close();
      for (const child of [companion, relay]) {
        if (child && child.exitCode === null) {
          const ended = once(child, 'exit'); child.kill(); await ended;
        }
      }
    }
  });
