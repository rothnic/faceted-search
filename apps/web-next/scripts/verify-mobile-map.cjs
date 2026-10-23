// Real-backend production check. CDP gestures are touch emulation, not phone evidence.
const { chromium, expect } = require('@playwright/test');
const fs = require('node:fs');
const origin = process.env.SEARCHLAB_UX_ORIGIN;
if (!origin) throw new Error('SEARCHLAB_UX_ORIGIN is required');
const out = process.env.SEARCHLAB_UX_ARTIFACTS || '/tmp/searchlab-focused-map';
fs.mkdirSync(out, { recursive: true });
const records = [];
const assert = (ok, message) => { if (!ok) throw new Error(message); };
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.SEARCHLAB_CHROME || '/opt/google/chrome/chrome' });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const page = await context.newPage(), errors = [], searches = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('request', r => { if (r.url().endsWith('/api/search')) searches.push(r.postDataJSON()); });
  const cdp = await context.newCDPSession(page);
  const gesture = async (points) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(0) });
    for (let i = 1; i <= 12; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(i / 12) });
      await page.waitForTimeout(20);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(400);
  };
  const geometry = scope => scope.locator('.leaflet-overlay-pane svg').evaluate(n => ({ transform: n.style.transform, html: n.innerHTML }));
  const check = async (name, fn) => { await fn(); records.push({ name, status: 'pass', method: 'Chromium CDP touch emulation / keyboard' }); fs.writeFileSync(out + '/matrix.json', JSON.stringify({ origin, records, errors }, null, 2)); };
  try {
    await page.goto(origin + '/search?q=garage');
    await expect(page.locator('.result-card')).toHaveCount(18);
    await page.locator('.mobile-views').getByRole('button', { name: 'Map', exact: true }).click();
    const embedded = page.locator('.map-panel > .map-canvas');
    await expect(embedded.locator('.leaflet-interactive').first()).toBeVisible();
    await check('embedded map disables pointer capture, drag controls and keyboard markers', async () => {
      await expect(embedded).toHaveAttribute('tabindex', '-1');
      assert(await embedded.evaluate(n => getComputedStyle(n).pointerEvents === 'none'), 'Embedded canvas captures pointer events');
      await expect(embedded.locator('.leaflet-control-zoom')).toBeHidden();
      assert((await embedded.locator('.leaflet-interactive').evaluateAll(ns => ns.every(n => n.tabIndex === -1))), 'Embedded marker keyboard stop');
    });
    await check('touch swipe over embedded map scrolls page without changing map geometry', async () => {
      await embedded.scrollIntoViewIfNeeded();
      const before = await geometry(embedded), y = await page.evaluate(() => scrollY), b = await embedded.boundingBox();
      const start = Math.min(750, b.y + b.height - 30), end = Math.max(160, start - 230);
      await gesture(t => [{ x: 195, y: start + (end - start) * t, id: 1 }]);
      assert(Math.abs((await page.evaluate(() => scrollY)) - y) > 30, 'Page did not scroll over embedded map');
      assert(JSON.stringify(await geometry(embedded)) === JSON.stringify(before), 'Embedded map moved');
      await page.screenshot({ path: out + '/embedded-after-swipe.png' });
    });
    let scroll, requestCount;
    await check('expand icon opens real interactive map with compact close target', async () => {
      const expand = page.getByRole('button', { name: 'Expand map', exact: true });
      await expand.scrollIntoViewIfNeeded(); scroll = await page.evaluate(() => scrollY); requestCount = searches.length;
      const bounds = await expand.boundingBox(); assert(bounds.width >= 44 && bounds.height >= 44, 'Expand target too small');
      await expand.click();
      await expect(page.getByRole('dialog', { name: 'Expanded map' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Close expanded map' })).toBeFocused();
      const bounds2 = await page.getByRole('button', { name: 'Close expanded map' }).boundingBox();
      assert(bounds2.width >= 44 && bounds2.height >= 44, 'Close target too small');
    });
    const dialog = page.getByRole('dialog', { name: 'Expanded map' });
    await check('expanded map touch drag changes map while background page stays fixed', async () => {
      await expect(dialog.locator('.leaflet-interactive').first()).toBeVisible();
      const before = await geometry(dialog), y = await page.evaluate(() => scrollY);
      await gesture(t => [{ x: 120 + 100 * t, y: 370 + 100 * t, id: 1 }]);
      assert(JSON.stringify(await geometry(dialog)) !== JSON.stringify(before), 'Expanded drag did not move map');
      assert(Math.abs((await page.evaluate(() => scrollY)) - y) <= 2, 'Expanded map moved background');
    });
    await check('expanded map pinch and zoom control alter map without new search', async () => {
      const before = await geometry(dialog);
      await gesture(t => [{ x: 170 - 55 * t, y: 420, id: 1 }, { x: 220 + 55 * t, y: 420, id: 2 }]);
      assert(JSON.stringify(await geometry(dialog)) !== JSON.stringify(before), 'Expanded pinch did not zoom map');
      const second = await geometry(dialog);
      await dialog.locator('.leaflet-control-zoom-in').click();
      assert(JSON.stringify(await geometry(dialog)) !== JSON.stringify(second), 'Zoom control did not change map');
      assert(searches.length === requestCount, 'Map interaction made another search request');
    });
    await check('expanded map marker supports keyboard selection and Escape restores page/opener', async () => {
      const marker = dialog.locator('.leaflet-interactive').first();
      await marker.focus(); await page.keyboard.press('Enter');
      await expect(marker).toHaveAttribute('aria-pressed', 'true');
      await expect(dialog.locator('.expanded-map-selection')).toBeVisible();
      await page.screenshot({ path: out + '/expanded-selection.png' });
      await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Expand map', exact: true })).toBeFocused();
      assert(Math.abs((await page.evaluate(() => scrollY)) - scroll) <= 2, 'Collapse changed page position');
      assert(await page.evaluate(() => document.body.style.overflow !== 'hidden'), 'Collapse leaked body lock');
    });
    await check('repeat expansion, breakpoint, browser Back and view reentry release modal state', async () => {
      await page.getByRole('button', { name: 'Expand map', exact: true }).click();
      await expect(dialog).toBeVisible(); await page.setViewportSize({ width: 1440, height: 844 });
      await expect(dialog).toHaveCount(0);
      assert(await page.evaluate(() => document.body.style.overflow !== 'hidden'), 'Resize leaked lock');
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole('button', { name: 'Expand map', exact: true }).click(); await expect(dialog).toBeVisible();
      await page.goBack(); await expect(dialog).toHaveCount(0);
      await expect(page.locator('.results-workspace')).toHaveAttribute('data-view', 'list');
      await expect(page.locator('.result-card')).toHaveCount(18);
      assert(await page.evaluate(() => document.body.style.overflow !== 'hidden'), 'Back leaked lock');
      await page.locator('.mobile-views').getByRole('button', { name: 'Map', exact: true }).click();
      await expect(embedded).toHaveAttribute('tabindex', '-1');
      await expect(page.getByRole('button', { name: 'Expand map', exact: true })).toHaveAttribute('aria-expanded', 'false');
    });
    assert(errors.length === 0, errors.join('\n'));
  } catch (error) {
    records.push({ status: 'fail', error: String(error), stack: error.stack });
    await page.screenshot({ path: out + '/failure.png' });
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(out + '/matrix.json', JSON.stringify({ origin, records, errors, searchRequests: searches.length, limitation: 'CDP touch and Chromium emulation; physical Android keyboard/gesture review remains separate.' }, null, 2));
    await context.tracing.stop({ path: out + '/trace.zip' });
    await browser.close();
    console.log(JSON.stringify(records, null, 2));
  }
})();
