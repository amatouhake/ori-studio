// Actual Ori Studio ContextMenu + installed Radix, with a Vite-only candidate
// transform. No production file is changed to compare modal/non-modal behavior.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({
  root: path.join(root, 'apps/web'), logLevel: 'error',
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{
    name: 'modal-spike', enforce: 'pre',
    transform(code, id) {
      if (id.endsWith('/components/ui/ContextMenu.tsx')) {
        // Target-kind branching exists only in this experiment, to replay the
        // rejected CP-only candidate without adding a production mode API.
        return code.replace('modal={false}', 'modal={globalThis.__contextMenuModal ?? (globalThis.__mixedModal && items[0]?.id === "other") ?? false}');
      }
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/__modal-spike')) return next();
        res.setHeader('Content-Type', 'text/html');
        res.end(await server.transformIndexHtml(req.url,
          `<html><body><div id="root"></div><script type="module" src="/@fs/${root}/scripts/fixtures/context-menu-modal-spike.tsx"></script></body></html>`));
      });
    },
  }],
});
const results = [];
const interactions = [];
try {
  await server.listen();
  const url = server.resolvedUrls.local[0];
  for (const release of process.argv.includes('--app') || process.argv.includes('--mixed') ? [] : [false, true]) {
    const browser = await chromium.launch({ args: release ? ['--blink-settings=showContextMenuOnMouseUp=true'] : [] });
    try {
      for (const modal of [true, false]) {
        const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
        await page.addInitScript(modal => { globalThis.__contextMenuModal = modal; }, modal);
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${url}__modal-spike?modal=${modal}`);
        await page.locator('#canvas').waitFor();
        await page.evaluate(() => {
          window.trace = [];
          for (const type of ['pointerdown', 'pointerup', 'auxclick', 'contextmenu', 'focusin']) {
            document.addEventListener(type, event => window.trace.push({
              type, target: event.target.id || event.target.getAttribute('role') || event.target.tagName,
              prevented: event.defaultPrevented, trusted: event.isTrusted,
              bodyPointerEvents: getComputedStyle(document.body).pointerEvents,
            }));
          }
        });
        for (const [x, y] of [[300, 200], [797, 597], [3, 597], [797, 83]]) {
          await page.keyboard.press('Escape');
          await page.mouse.click(x, y, { button: 'right' });
          await page.getByRole('menu').waitFor();
          results.push({ release, modal, point: [x,y], trace: await page.evaluate(() => window.trace.splice(0)),
            menu: await page.getByRole('menu').boundingBox() });
        }
        if (modal) {
          await page.keyboard.press('Escape');
          await page.locator('#keyboard').focus();
          await page.keyboard.press('Enter');
          await page.waitForFunction(() => document.activeElement.textContent === 'Alpha');
          await page.keyboard.press('Escape');
          await page.getByRole('menu').waitFor({ state: 'hidden' });
          interactions.push({ release, modal, name: 'modal control Escape focus',
            focusedTag: await page.evaluate(() => document.activeElement.tagName) });
        }
        if (!modal) {
          const note = async name => interactions.push({ release, name,
            focused: await page.evaluate(() => document.activeElement?.textContent || document.activeElement?.id),
            menus: await page.getByRole('menu').count(),
          });
          await page.keyboard.press('Escape');
          await page.locator('#keyboard').focus();
          await page.keyboard.press('Enter');
          await page.getByRole('menuitem', { name: 'Alpha', exact: true }).waitFor();
          await page.waitForFunction(() => document.activeElement.textContent === 'Alpha');
          await page.keyboard.press('ArrowDown');
          await page.waitForFunction(() => document.activeElement.textContent === 'Styles');
          assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Styles');
          await page.keyboard.press('ArrowRight');
          await page.getByRole('menuitem', { name: 'Paper', exact: true }).waitFor();
          await page.keyboard.press('ArrowDown');
          await page.waitForFunction(() => document.activeElement.textContent === 'Wireframe');
          assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Wireframe');
          await page.evaluate(() => { window.trace = []; });
          await page.getByRole('menuitem', { name: 'Paper', exact: true }).click({ button: 'right' });
          const submenuEvents = await page.evaluate(() => window.trace.splice(0).filter(e => e.type === 'contextmenu'));
          assert.equal(submenuEvents.length, 1);
          assert(submenuEvents[0].prevented && submenuEvents[0].trusted);
          interactions.push({ release, name: 'native event on portaled submenu', events: submenuEvents });
          await page.keyboard.press('ArrowLeft');
          assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Styles');
          await page.keyboard.press('Home');
          await page.waitForFunction(() => document.activeElement.textContent === 'Alpha');
          await page.keyboard.press('End');
          await page.waitForFunction(() => document.activeElement.textContent === 'Styles');
          await page.keyboard.press('a');
          await page.waitForFunction(() => document.activeElement.textContent === 'Alpha');
          assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Alpha');
          await note('keyboard submenu, disabled skip, Home/End and typeahead');
          await page.keyboard.press('Enter');
          await page.getByRole('menu').waitFor({ state: 'hidden' });
          assert.equal(await page.locator('#actions').textContent(), '1');
          await note('Enter selects and closes');
          await page.locator('#keyboard').click();
          await page.getByRole('menu').waitFor();
          await page.keyboard.press('Escape');
          await page.getByRole('menu').waitFor({ state: 'hidden' });
          await note('Escape closes');
          await page.locator('#keyboard').click();
          await page.getByRole('menu').waitFor();
          await page.locator('#outside').click();
          await page.getByRole('menu').waitFor({ state: 'hidden' });
          assert.equal(await page.locator('#outside').textContent(), 'Outside 1');
          await note('outside left click dismisses and activates');
          await page.locator('#keyboard').click();
          await page.getByRole('menu').waitFor();
          await page.locator('#field').focus();
          await page.getByRole('menu').waitFor({ state: 'hidden' });
          assert.equal(await page.evaluate(() => document.activeElement.id), 'field');
          await note('outside focus dismisses and remains in field');
          await page.locator('#keyboard').click();
          await page.getByRole('menu').waitFor();
          const duplicates = await page.getByRole('menuitem', { name: 'Alpha', exact: true }).evaluate(target => {
            return [new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }),
              ...[1, 7, 8].map(pointerId => new PointerEvent('contextmenu', {
                bubbles: true, cancelable: true, button: 2, pointerId, pointerType: 'pen',
              }))].map(event => { target.dispatchEvent(event); return event.defaultPrevented; });
          });
          assert(duplicates.every(Boolean));
          interactions.push({ release, name: 'replayed untyped, quirk and same-type delayed events on menu', prevented: duplicates });
          await page.keyboard.press('Escape');
          await page.getByRole('menu').waitFor({ state: 'hidden' });
          await page.locator('#keyboard').click();
          await page.getByRole('menu').waitFor();
          await page.locator('#field').click({ button: 'right' });
          await page.getByRole('menu').waitFor({ state: 'hidden' });
          await page.keyboard.press('Shift+F10');
          await page.keyboard.press('ContextMenu');
          const fieldMenus = await page.evaluate(() => window.trace.splice(0).filter(e => e.type === 'contextmenu' && e.target === 'field'));
          assert.equal(fieldMenus.length, 3);
          assert(fieldMenus.every(e => !e.prevented && e.trusted));
          interactions.push({ release, name: 'native input: pointer and two keyboard contextmenus', events: fieldMenus });
          await page.locator('#field').hover();
          await page.mouse.down({ button: 'left' });
          await page.mouse.down({ button: 'right' });
          await page.mouse.up({ button: 'right' });
          await page.mouse.up({ button: 'left' });
          const chord = await page.evaluate(() => window.trace.splice(0).filter(e => e.type === 'contextmenu'));
          assert.equal(chord.length, 1);
          assert.equal(chord[0].target, 'field');
          assert.equal(chord[0].prevented, false);
          interactions.push({ release, name: 'native chorded input menu', events: chord });
          await page.mouse.move(100, 200);
          await page.mouse.down({ button: 'right' });
          await page.mouse.move(200, 300);
          await page.mouse.up({ button: 'right' });
          assert.equal(await page.getByRole('menu').count(), 0);
          await note('fixture right drag does not open menu (not engine erase evidence)');
        }
        assert.deepEqual(errors, []);
        await page.close();
      }
    } finally { await browser.close(); }
  }
  if (process.argv.includes('--mixed')) {
    const browser = await chromium.launch({ args: ['--blink-settings=showContextMenuOnMouseUp=true'] });
    try {
      for (const allNonModal of [false, true]) {
        const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
        if (allNonModal) await page.addInitScript(() => { globalThis.__contextMenuModal = false; });
        else await page.addInitScript(() => { globalThis.__mixedModal = true; });
        await page.goto(`${url}__modal-spike`);
        await page.locator('#canvas').waitFor();
        await page.evaluate(() => {
          window.trace = [];
          document.addEventListener('contextmenu', e => window.trace.push({
            target: e.target.id || e.target.getAttribute('role') || e.target.tagName,
            prevented: e.defaultPrevented, trusted: e.isTrusted, type: e.pointerType,
          }));
        });
        await page.mouse.move(300, 200);
        await page.mouse.down({ button: 'right' });
        const cdp = await page.context().newCDPSession(page);
        for (const [type, buttons] of [['mousePressed', 2], ['mouseReleased', 0]]) {
          await cdp.send('Input.dispatchMouseEvent', { type, buttons, x: 680, y: 20,
            button: 'right', pointerType: 'pen', clickCount: 1 });
        }
        await page.getByRole('menuitem', { name: 'Other action' }).waitFor();
        await page.mouse.up({ button: 'right' });
        const events = await page.evaluate(() => window.trace);
        assert.equal(events.length, 2);
        assert(events.every(event => event.trusted));
        assert.equal(events[1].target, allNonModal ? 'canvas' : 'HTML');
        assert.equal(events[1].prevented, allNonModal);
        results.push({ name: 'overlapping menus on different surfaces', allNonModal,
          events,
          bodyPointerEvents: await page.evaluate(() => getComputedStyle(document.body).pointerEvents),
        });
        await page.close();
      }
    } finally { await browser.close(); }
  }
  if (process.argv.includes('--app')) {
    for (const release of [false, true]) {
      const browser = await chromium.launch({ args: release ? ['--blink-settings=showContextMenuOnMouseUp=true'] : [] });
      try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
        page.setDefaultTimeout(15000);
        page.on('pageerror', error => console.error('app error:', error.message));
        console.error('app: loading', release);
        if (process.argv.includes('--baseline')) await page.addInitScript(() => { globalThis.__contextMenuModal = true; });
        await page.goto(`${url}edit`);
        console.error('app: loaded');
        await page.waitForFunction(() => Boolean(window.__treemakerWorkspaceStore?.getState().oristudioCpDocument));
        const canvas = page.locator('.cp-panel__body canvas').first();
        await canvas.waitFor();
        console.error('app: canvas ready');
        await page.evaluate(() => {
          window.trace = [];
          document.addEventListener('contextmenu', e => window.trace.push({
            target: e.target.tagName, role: e.target.getAttribute('role'),
            prevented: e.defaultPrevented, trusted: e.isTrusted,
            bodyPointerEvents: getComputedStyle(document.body).pointerEvents,
          }));
        });
        const box = await canvas.boundingBox();
        const x = box.x + 30, y = box.y + 30;
        await page.mouse.click(x, y, { button: 'right' });
        await page.getByRole('menu').waitFor();
        const events = await page.evaluate(() => window.trace.splice(0));
        assert.equal(events.length, 1);
        const escapes = release && process.argv.includes('--baseline');
        assert.equal(events[0].target, escapes ? 'HTML' : 'CANVAS');
        assert.equal(events[0].prevented, !escapes);
        results.push({ release, name: 'actual app blank CP', events });
        await page.keyboard.press('Escape');
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        results.push({ release, name: 'actual app Escape', menus: await page.getByRole('menu').count() });
        if (await page.getByRole('menu').count()) await page.mouse.click(5, 5);
        await page.getByRole('menu').waitFor({ state: 'hidden' });
        await page.keyboard.press('Shift+F10');
        await page.getByRole('menu').waitFor();
        await page.waitForFunction(() => document.activeElement.getAttribute('role') === 'menuitem');
        results.push({ release, name: 'actual app keyboard menu', labels: await page.getByRole('menuitem').allTextContents(),
          focus: await page.evaluate(() => document.activeElement.getAttribute('role')) });
        await page.keyboard.press('Escape');
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        if (await page.getByRole('menu').count()) await page.mouse.click(5, 5);
        await page.getByRole('menu').waitFor({ state: 'hidden' });
        const beforeErase = await page.evaluate(async () => {
          await window.__treemakerWorkspaceStore.getState().insertOristudioCpLineSegments([
            { a: { x: -30, y: 0 }, b: { x: 30, y: 0 }, color: 'Red1' },
          ]);
          return window.__treemakerWorkspaceStore.getState().oristudioCpDocument.document.crease_pattern.line_segments.length;
        });
        // A non-modal outside right press must both dismiss and start erase.
        if (!process.argv.includes('--baseline')) {
          await page.mouse.click(x, y, { button: 'right' });
          await page.getByRole('menu').waitFor();
        }
        await page.mouse.move(x, y);
        await page.mouse.down({ button: 'right' });
        // End on the canvas, not the floating scale toolbar at its lower edge.
        const end = { x: box.x + box.width * 0.8, y: box.y + box.height * 0.8 };
        assert.equal(await page.evaluate(({x,y}) => document.elementFromPoint(x,y).tagName, end), 'CANVAS');
        await page.mouse.move(end.x, end.y, { steps: 3 });
        await page.mouse.up({ button: 'right' });
        await page.waitForFunction(before => window.__treemakerWorkspaceStore.getState().oristudioCpDocument.document.crease_pattern.line_segments.length < before, beforeErase);
        assert.equal(await page.getByRole('menu').count(), 0);
        const dragEvents = await page.evaluate(() => window.trace.splice(0));
        assert(dragEvents.every(event => event.prevented));
        results.push({ release, name: 'actual app right drag', beforeErase,
          afterErase: await page.evaluate(() => window.__treemakerWorkspaceStore.getState().oristudioCpDocument.document.crease_pattern.line_segments.length),
          events: dragEvents });
        await page.screenshot({ path: `/tmp/ori-nonmodal-app-${release ? 'release' : 'press'}.png` });
      } finally { await browser.close(); }
    }
  }
  console.log(JSON.stringify({ results, interactions }, null, 2));
} finally { await server.close(); }
