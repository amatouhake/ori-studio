/**
 * Falsification probe, not production code or a Windows certification test.
 * Run: node scripts/context-menu-handshake-spike.mjs
 * Uses the repository's Playwright Chromium. No app server or wasm needed.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.setContent(`
    <style>
      #canvas { position: absolute; left: 200px; top: 20px; width: 400px; height: 300px; }
      #field { position: absolute; left: 20px; top: 20px; width: 150px; }
    </style>
    <input id="field" value="native Cut Copy Paste">
    <canvas id="canvas" tabindex="0"></canvas>
  `);
  await page.evaluate(() => {
    window.trace = [];
    const canvas = document.querySelector('#canvas');
    canvas.addEventListener('pointerdown', (event) => {
      if (event.button === 2) event.preventDefault();
      if (event.isTrusted) canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointerup', (event) => {
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    });
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel',
      'contextmenu', 'auxclick', 'gotpointercapture', 'lostpointercapture']) {
      document.addEventListener(type, (event) => {
        window.trace.push({
          type, target: event.target.id || event.target.tagName,
          pointerId: event.pointerId, pointerType: event.pointerType,
          button: event.button, buttons: event.buttons,
          trusted: event.isTrusted, prevented: event.defaultPrevented,
        });
      });
    }
  });
  const observations = {};
  const takeTrace = async (name) => {
    observations[name] = await page.evaluate(() => window.trace.splice(0));
    return observations[name];
  };
  await page.mouse.click(300, 100, { button: 'right' });
  const mouse = await takeTrace('nativeLinuxMouse');
  assert(mouse.findIndex((e) => e.type === 'contextmenu') < mouse.findIndex((e) => e.type === 'pointerup'));
  assert(mouse.find((e) => e.type === 'contextmenu').prevented);

  const cdp = await page.context().newCDPSession(page);
  const pen = async (type, buttons) => cdp.send('Input.dispatchMouseEvent', {
    type, x: 300, y: 100, button: 'right', buttons, pointerType: 'pen', clickCount: 1,
  });
  await pen('mousePressed', 2);
  await pen('mouseReleased', 0);
  const penTrace = await takeTrace('nativeLinuxPenViaCDP');
  const penDown = penTrace.find((e) => e.type === 'pointerdown');
  const penMenu = penTrace.find((e) => e.type === 'contextmenu');
  assert(penDown.trusted && penMenu.trusted);
  assert.equal(penDown.pointerType, 'pen');
  assert.equal(penMenu.pointerType, 'pen');
  assert.notEqual(penDown.pointerId, penMenu.pointerId);
  assert.equal(penTrace.find((e) => e.type === 'auxclick').pointerId, penDown.pointerId);

  await page.mouse.move(300, 100);
  await page.mouse.down({ button: 'left' });
  await page.mouse.down({ button: 'right' });
  await page.mouse.up({ button: 'right' });
  await page.mouse.up({ button: 'left' });
  const chord = await takeTrace('nativeLinuxChord');
  assert(chord.some((e) => e.type === 'pointermove' && e.button === 2 && e.buttons === 3));
  assert(chord.some((e) => e.type === 'pointermove' && e.button === 2 && e.buttons === 1));

  await page.locator('#field').focus();
  await page.keyboard.press('Shift+F10');
  await page.keyboard.press('ContextMenu');
  await page.mouse.click(60, 30, { button: 'right' });
  await page.mouse.move(60, 30);
  await page.mouse.down({ button: 'left' });
  await page.mouse.down({ button: 'right' });
  await page.mouse.up({ button: 'right' });
  await page.mouse.up({ button: 'left' });
  const field = await takeTrace('nativeLinuxTextField');
  const fieldMenus = field.filter((e) => e.type === 'contextmenu');
  assert.equal(fieldMenus.length, 4);
  assert(fieldMenus.every((e) => e.target === 'field' && e.trusted && !e.prevented));

  await page.mouse.move(60, 30);
  await page.mouse.down({ button: 'right' });
  await pen('mousePressed', 2);
  await page.mouse.move(300, 100);
  await page.mouse.up({ button: 'right' });
  await pen('mouseReleased', 0);
  const overlap = await takeTrace('nativeLinuxForeignMouseReleaseBesidePen');
  const foreignUp = overlap.find((e) => e.type === 'pointerup' && e.pointerType === 'mouse');
  const heldPen = overlap.find((e) => e.type === 'pointerdown' && e.pointerType === 'pen');
  assert.equal(foreignUp.target, 'canvas');
  assert.notEqual(foreignUp.pointerId, heldPen.pointerId);
  assert(overlap.indexOf(foreignUp) < overlap.findIndex((e) => e.type === 'pointerup' && e.pointerType === 'pen'));

  // This is a deliberately minimal hypothesis, with the pen fallback required
  // by the native measurement above. Neither the browser nor this probe claims
  // that Linux natively generates delayed duplicates or release-time menus.
  const replay = await page.evaluate(() => {
    function run({ contextFirst, foreignDuplicate = false, strictId = false }) {
      let pending = null;
      let opened = 0;
      const localTrace = [];
      const canvas = document.querySelector('#canvas');
      document.body.style.pointerEvents = '';
      const openIfReady = () => {
        if (!pending?.released || !pending.seen) return;
        opened++;
        pending = null;
        // Model the relevant effect of Ori Studio's modal Radix menu. This is
        // deliberately not represented as an end-to-end test of Radix itself.
        document.body.style.pointerEvents = 'none';
      };
      const down = (event) => {
        pending = { id: event.pointerId, type: event.pointerType, released: false, seen: false };
      };
      const up = (event) => {
        if (pending?.id !== event.pointerId) return;
        pending.released = true;
        openIfReady();
      };
      const menu = (event) => {
        event.preventDefault();
        if (!pending || event.pointerType !== pending.type) return;
        if (strictId && event.pointerId !== pending.id) return;
        pending.seen = true;
        openIfReady();
      };
      for (const [type, handler] of [['pointerdown', down], ['pointerup', up], ['contextmenu', menu]]) {
        canvas.addEventListener(type, handler);
      }
      const dispatch = (type, pointerId, owner) => {
        const event = new PointerEvent(type, {
          bubbles: true, cancelable: true, pointerType: 'pen', pointerId,
          button: 2,
          buttons: type === 'pointerdown' || (type === 'contextmenu' && pending && !pending.released) ? 2 : 0,
          clientX: 300, clientY: 100,
        });
        // Fresh hit testing models the release-time targeting measured on
        // Windows in the read-only reference. dispatchEvent alone cannot do it.
        const target = document.elementFromPoint(300, 100);
        target.dispatchEvent(event);
        localTrace.push({ type, pointerId, owner, target: target.id || target.tagName,
          prevented: event.defaultPrevented, opened });
      };
      dispatch('pointerdown', 7, 'A');
      if (contextFirst) dispatch('contextmenu', 1, foreignDuplicate ? 'B delayed duplicate' : 'A');
      dispatch('pointerup', 7, 'A');
      if (!contextFirst || foreignDuplicate) dispatch('contextmenu', 1, 'A');
      for (const [type, handler] of [['pointerdown', down], ['pointerup', up], ['contextmenu', menu]]) {
        canvas.removeEventListener(type, handler);
      }
      document.body.style.pointerEvents = '';
      return { opened, trace: localTrace };
    }
    return {
      pressFirst: run({ contextFirst: true }),
      releaseFirst: run({ contextFirst: false }),
      strictPenId: run({ contextFirst: true, strictId: true }),
      delayedOtherPen: run({ contextFirst: true, foreignDuplicate: true }),
    };
  });
  assert.equal(replay.pressFirst.opened, 1);
  assert.equal(replay.releaseFirst.opened, 1);
  assert.equal(replay.strictPenId.opened, 0);
  assert.equal(replay.delayedOtherPen.trace.at(-1).target, 'HTML');
  assert.equal(replay.delayedOtherPen.trace.at(-1).prevented, false);
  // Before A's real native event, the canvas-visible inputs are identical.
  const visible = (trace) => trace.slice(0, 3).map(({ owner: _owner, ...event }) => event);
  assert.deepEqual(visible(replay.pressFirst.trace), visible(replay.delayedOtherPen.trace));
  assert.deepEqual(pageErrors, []);
  // Exercise Chromium's release-time implementation with trusted input on
  // Linux. This setting is not evidence of Windows OS/WebView2 integration.
  const releaseBrowser = await chromium.launch({
    args: ['--blink-settings=showContextMenuOnMouseUp=true'],
  });
  const configuredRelease = {};
  try {
    for (const mode of ['pointerup', 'auxclick', 'handshake']) {
      const releasePage = await releaseBrowser.newPage();
      await releasePage.setContent('<canvas id="canvas" width="500" height="400"></canvas>');
      await releasePage.evaluate((mode) => {
        const canvas = document.querySelector('canvas');
        let released = false;
        let seen = false;
        window.trace = [];
        const open = () => { document.body.style.pointerEvents = 'none'; };
        canvas.addEventListener('pointerdown', (event) => {
          event.preventDefault();
          canvas.setPointerCapture(event.pointerId);
        });
        canvas.addEventListener('pointerup', (event) => {
          canvas.releasePointerCapture(event.pointerId);
          released = true;
          if (mode === 'pointerup' || (mode === 'handshake' && seen)) open();
        });
        canvas.addEventListener('auxclick', () => { if (mode === 'auxclick') open(); });
        canvas.addEventListener('contextmenu', (event) => {
          event.preventDefault();
          seen = true;
          if (mode === 'handshake' && released) open();
        });
        for (const type of ['pointerdown', 'pointerup', 'auxclick', 'contextmenu']) {
          document.addEventListener(type, (event) => window.trace.push({
            type, target: event.target.id || event.target.tagName,
            pointerId: event.pointerId, pointerType: event.pointerType,
            trusted: event.isTrusted, prevented: event.defaultPrevented,
          }));
        }
      }, mode);
      await releasePage.mouse.click(100, 100, { button: 'right' });
      const trace = await releasePage.evaluate(() => window.trace);
      configuredRelease[mode] = trace;
      assert.deepEqual(trace.map((e) => e.type), ['pointerdown', 'pointerup', 'auxclick', 'contextmenu']);
      assert(trace.every((e) => e.trusted));
      assert.equal(trace.at(-1).prevented, mode === 'handshake');
      assert.equal(trace.at(-1).target, mode === 'handshake' ? 'canvas' : 'HTML');
      await releasePage.close();
    }
  } finally {
    await releaseBrowser.close();
  }
  console.log(JSON.stringify({ chromium: browser.version(), observations, configuredRelease, replay }, null, 2));
} finally {
  await browser.close();
}
