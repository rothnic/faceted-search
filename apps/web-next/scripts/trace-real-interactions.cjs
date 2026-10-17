// Real production journeys with Chrome paint filmstrip + explicit event/state marks.
// State-observed marks include automation scheduling; they are not exact paint/INP.
const { chromium, expect } = require('@playwright/test');
const fs = require('node:fs');
const origin = process.env.SEARCHLAB_UX_ORIGIN;
if (!origin) throw new Error('SEARCHLAB_UX_ORIGIN required');
const out = process.env.SEARCHLAB_UX_ARTIFACTS || '/tmp/searchlab-real-interaction-traces';
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.SEARCHLAB_CHROME || '/opt/google/chrome/chrome', headless: true });
  const records = [];
  try {
    for (const width of [390, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1, isMobile: width === 390, hasTouch: width === 390 });
      const page = await context.newPage(), cdp = await context.newCDPSession(page), errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: width === 390 ? 150 : 40, downloadThroughput: (width === 390 ? 1638.4 : 10240) * 1024 / 8, uploadThroughput: (width === 390 ? 1638.4 : 10240) * 1024 / 8 });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: width === 390 ? 4 : 1 });
      await page.addInitScript(() => {
        window.__journey = { armed: null, event: null };
        for (const type of ['click', 'input', 'keydown']) document.addEventListener(type, event => {
          if (window.__journey.armed && !window.__journey.event) {
            window.__journey.event = { at: performance.now(), type, value: event.target?.value ?? null };
            performance.mark(window.__journey.armed + ':first-native-event');
          }
        }, true);
      });
      await cdp.send('Tracing.start', { categories: 'devtools.timeline,blink.user_timing,loading,disabled-by-default-devtools.screenshot', transferMode: 'ReturnAsStream' });
      const step = async (name, action, ready) => {
        await page.evaluate(name => { window.__journey = { armed: name, event: null }; performance.mark(name + ':armed'); }, name);
        await action(); await ready();
        const state = await page.evaluate(name => {
          performance.mark(name + ':state-observed');
          return { at: performance.now(), firstEvent: window.__journey.event, count: document.querySelector('[data-testid=results-count]')?.textContent, ids: [...document.querySelectorAll('.result-card')].map(n => n.dataset.houseId), input: document.querySelector('[data-testid=search-input]')?.value, active: document.activeElement?.getAttribute('aria-label'), url: location.href };
        }, name);
        await page.screenshot({ path: `${out}/${width}-${name}.png` });
        records.push({ width, name, state, screenshot: `${width}-${name}.png`, note: 'Screenshot establishes painted state at capture time; trace filmstrip retains the transition. State-observed latency includes harness overhead.' });
        fs.writeFileSync(out + '/journeys.json', JSON.stringify({ origin, records }, null, 2));
      };
      await page.goto(origin + '/search?q=garage');
      await page.waitForFunction(() => performance.getEntriesByName('searchlab-hydrated').length > 0);
      await expect(page.getByTestId('results-count')).toHaveText('35 matches');
      const input = page.getByTestId('search-input');
      if (width === 390) {
        await step('focused-input-and-real-place-feedback', async () => { await input.click(); await input.fill('Owens'); }, async () => {
          await expect(page.getByRole('option', { name: /Owens Cross Roads/ })).toBeVisible();
          await expect(page.getByTestId('results-count')).toHaveText('35 matches');
          await expect(page.locator('.query-feedback')).toContainText('19 matching homes');
        });
        await step('explicit-query-search', () => page.getByRole('button', { name: 'Search', exact: true }).click(), () => expect(page.getByTestId('results-count')).toHaveText('19 matches'));
      } else {
        await step('desktop-live-query', () => input.fill('Owens'), () => expect(page.getByTestId('results-count')).toHaveText('19 matches'));
      }
      await page.goto(origin + '/search?q=garage');
      await page.waitForFunction(() => performance.getEntriesByName('searchlab-hydrated').length > 0);
      await step('actual-facet', async () => {
        if (width === 390) await page.getByRole('button', { name: 'Filters (0)' }).click();
        await page.getByRole('checkbox', { name: /Pool/ }).check();
        if (width === 390) await page.keyboard.press('Escape');
      }, async () => {
        await expect(page.getByRole('button', { name: 'Remove Amenities: Pool' })).toBeVisible();
        await expect(page.getByTestId('results-count')).toHaveText('1 matches');
      });
      await page.goto(origin + '/search');
      await page.waitForFunction(() => performance.getEntriesByName('searchlab-hydrated').length > 0);
      await expect(page.locator('.result-card')).toHaveCount(18);
      await step('actual-pagination', () => page.getByRole('button', { name: 'Show more homes' }).click(), () => expect(page.locator('.result-card')).toHaveCount(36));
      const card = page.locator('.result-select').nth(25);
      await card.scrollIntoViewIfNeeded();
      await step('page-two-details', () => card.click(), () => expect(page.getByRole('dialog', { name: 'Home details' })).toBeVisible());
      await step('details-back-restores-feed', () => page.goBack(), async () => {
        await expect(page.getByRole('dialog', { name: 'Home details' })).toHaveCount(0);
        await expect(card).toBeFocused(); await expect(card).toBeInViewport();
        await expect(page.locator('.result-card')).toHaveCount(36);
      });
      const views = page.locator(width === 390 ? '.mobile-views' : '.desktop-views');
      await step('explicit-map-load', () => views.getByRole('button', { name: 'Map', exact: true }).click(), () => expect(page.locator('.map-canvas .leaflet-interactive').first()).toBeVisible());
      if (width === 390) {
        await step('expanded-map', () => page.getByRole('button', { name: 'Expand map', exact: true }).click(), () => expect(page.getByRole('dialog', { name: 'Expanded map' }).locator('.leaflet-interactive').first()).toBeVisible());
        await step('collapse-map', () => page.getByRole('button', { name: 'Close expanded map' }).click(), () => expect(page.getByRole('button', { name: 'Expand map', exact: true })).toBeFocused());
      }
      await step('map-back-restores-loaded-feed', () => page.goBack(), async () => {
        await expect(page.locator('.results-workspace')).toHaveAttribute('data-view', 'list');
        await expect(page.locator('.result-card')).toHaveCount(36);
      });
      await step('full-transparent-diagnostics', () => page.locator('.request-timing').click(), async () => {
        await expect(page.locator('.backend-provenance')).toContainText('881e3b5660242affee21832c');
        await expect(page.locator('.backend-provenance')).toContainText('126');
      });
      if (errors.length) throw new Error(errors.join('\n'));
      const complete = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve));
      await cdp.send('Tracing.end'); const { stream } = await complete;
      const trace = fs.openSync(`${out}/${width}-chrome-paint-trace.json`, 'w');
      while (true) { const chunk = await cdp.send('IO.read', { handle: stream }); fs.writeSync(trace, chunk.base64Encoded ? Buffer.from(chunk.data, 'base64') : chunk.data); if (chunk.eof) break; }
      fs.closeSync(trace); await cdp.send('IO.close', { handle: stream });
      await context.close();
    }
    console.log(JSON.stringify({ completed: true, records: records.length, out }));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
