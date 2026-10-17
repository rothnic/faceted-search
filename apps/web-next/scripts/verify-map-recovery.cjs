// Real backend data only. Controls delay delivery or fail transport, never invent map results.
const { chromium, expect: baseExpect } = require('@playwright/test');
const expect = baseExpect.configure({ timeout: 6000 });
const fs = require('node:fs');
const path = require('node:path');
const origin = process.env.SEARCHLAB_UX_ORIGIN;
if (!origin) throw new Error('Set SEARCHLAB_UX_ORIGIN to the documented126-row production candidate.');
const out = process.env.SEARCHLAB_UX_ARTIFACTS || `/tmp/searchlab-map-recovery-${Date.now()}`;
fs.mkdirSync(out, { recursive: true });
const records = [], requests = [], controls = [], errors = [];
const save = () => fs.writeFileSync(path.join(out, 'matrix.json'), JSON.stringify({ origin, records, requests, controls, errors, method: 'Actual126-row backend; held real responses and browser transport failures only; Chromium emulation, not physical/Safari acceptance.' }, null, 2));
const must = (v, message) => { if (!v) throw new Error(message); };
const viewButton = (page, width, view) => page.locator(width < 901 ? '.mobile-views' : '.desktop-views').getByRole('button', { name: view, exact: true });
const submit = async (page, width, q) => {
  await page.locator('input[name=q]').fill(q);
  if (width < 901) await page.getByRole('button', { name: 'Search', exact: true }).click();
};
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.SEARCHLAB_CHROME || '/opt/google/chrome/chrome' });
  try {
    for (const width of [390, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 844 } });
      await context.addInitScript(() => {
        window.__mapFailureAlerts = [];
        new MutationObserver(changes => {
          for (const change of changes) for (const node of change.addedNodes) {
            if (!(node instanceof Element)) continue;
            const alerts = node.matches('.map-unavailable[role="alert"]') ? [node] : [...node.querySelectorAll('.map-unavailable[role="alert"]')];
            alerts.forEach(alert => window.__mapFailureAlerts.push(alert.textContent));
          }
        }).observe(document, { childList: true, subtree: true });
      });
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
      const page = await context.newPage();
      const plans = new Map(), held = [];
      page.on('pageerror', e => errors.push({ width, error: String(e) }));
      const plan = (q, action) => plans.set(q, [...(plans.get(q) || []), action]);
      await page.route('**/api/search', async route => {
        const req = route.request().postDataJSON();
        if (!req?.mapOnly) return route.continue();
        requests.push({ width, ...req });
        const action = plans.get(req.q)?.shift();
        if (!action) return route.continue();
        if (action === 'fail') { controls.push({ width, q: req.q, action: 'transport-failure' }); return route.abort('failed'); }
        const response = await route.fetch();
        const body = await response.json();
        must(response.status() === 200 && body.provenance?.dataset?.databaseFingerprint === '881e3b5660242affee21832c', 'Held response must be actual expected backend data');
        const entry = { width, q: req.q, action, totalHits: body.totalHits, mapPoints: body.mapHits.length };
        controls.push(entry);
        let release;
        const waiting = new Promise(resolve => { release = resolve; });
        held.push({ q: req.q, release });
        await waiting;
        try {
          if (action === 'hold-fail') await route.abort('failed');
          else await route.fulfill({ response });
          entry.delivery = action === 'hold-fail' ? 'transport-failure' : 'real-response-released';
        } catch (error) { entry.delivery = 'canceled-before-delivery'; entry.deliveryError = String(error); }
      });
      const check = async (name, fn) => {
        try { const proof = await fn(); records.push({ width, name, status: 'pass', proof }); save(); }
        catch (error) { records.push({ width, name, status: 'fail', error: String(error), state: await page.evaluate(() => ({ count: document.querySelector('[data-testid=results-count]')?.textContent, map: !!document.querySelector('.map-panel > .map-canvas'), mapText: document.querySelector('.map-column')?.textContent, url: location.href })) }); save(); await page.screenshot({ path: path.join(out, `${width}-failure.png`) }); throw error; }
      };
      const embedded = page.locator('.map-panel > .map-canvas');
      const markers = embedded.locator('.leaflet-interactive');
      try {
        await page.goto(origin + '/search?q=garage&minPrice=0');
        await page.locator('.request-timing:enabled').waitFor();
        await viewButton(page, width, 'Map').click();
        await expect(markers).toHaveCount(35);
        const initialFailureAlerts = await page.evaluate(() => window.__mapFailureAlerts);
        controls.push({ width, action: 'initial-success-map-alerts', alerts: initialFailureAlerts });
        must(initialFailureAlerts.length === 0, 'Initial successful map entry announced a failure: ' + JSON.stringify(initialFailureAlerts));
        await page.evaluate(() => { window.__retainedMap = document.querySelector('.map-panel > .map-canvas'); });
        plan('pool', 'hold-fail');
        await submit(page, width, 'pool');
        await expect.poll(() => held.length).toBe(1);
        await expect(page.getByTestId('results-count')).toHaveText('31 matches');
        await check('replacement retains successful map and explicitly labels previous results', async () => {
          const proof = await page.evaluate(() => ({ sameCanvas: window.__retainedMap === document.querySelector('.map-panel > .map-canvas'), oldConnected: window.__retainedMap.isConnected }));
          must(proof.sameCanvas && proof.oldConnected, 'Replacement removed the successful map: ' + JSON.stringify(proof));
          await expect(markers).toHaveCount(35);
          await expect(page.locator('.map-feedback')).toContainText('previous');
          await expect(page.locator('.map-feedback')).toContainText('current search');
          await page.screenshot({ path: path.join(out, `${width}-previous-loading.png`) });
          return { ...proof, initialFailureAlerts };
        });
        held[0].release();
        await check('failed replacement keeps previous results, selection and reachable retry', async () => {
          await expect(page.getByRole('button', { name: 'Retry map', exact: true })).toBeVisible();
          await expect(markers).toHaveCount(35);
          await expect(page.locator('.map-feedback')).toContainText('failed');
          let scope = page;
          if (width < 901) { await page.getByRole('button', { name: 'Expand map', exact: true }).click(); scope = page.getByRole('dialog', { name: 'Expanded map', exact: true }); }
          await expect(scope.locator('.map-feedback')).toContainText('previous');
          await expect(scope.getByRole('button', { name: 'Retry map', exact: true })).toBeVisible();
          const currentTitles = await page.locator('.result-card h3').allTextContents();
          const available = scope.locator('.leaflet-interactive');
          const labels = await available.evaluateAll(ns => ns.map(n => n.getAttribute('aria-label')));
          const label = labels.find(v => currentTitles.some(t => v.startsWith('Select home: ' + t + ',')));
          must(label, 'Expected a real garage/pool overlap for the preserved selection/details check');
          const point = scope.getByRole('button', { name: label, exact: true });
          await point.focus(); await point.press('Enter');
          await expect(point).toHaveAttribute('aria-pressed', 'true');
          await page.screenshot({ path: path.join(out, `${width}-previous-error.png`) });
          return { previousPoints: 35, currentMatches: 31, selectedRealPoint: label, expanded: width < 901 };
        });
        await check('retry requests current criteria and preserves details/list/filter state', async () => {
          const before = requests.length;
          await page.getByRole('button', { name: 'Retry map', exact: true }).click();
          const focusAfterRetry = await page.evaluate(() => ({ region: document.activeElement?.getAttribute('aria-label'), tag: document.activeElement?.tagName }));
          must(focusAfterRetry.region === (width < 901 ? 'Expanded map results' : 'Map results'), 'Retry lost keyboard context: ' + JSON.stringify(focusAfterRetry));
          await expect(markers).toHaveCount(31);
          await expect(page.locator('.map-feedback')).toHaveCount(0);
          must(requests.length === before + 1 && requests.at(-1).q === 'pool' && requests.at(-1).filters.minPrice === 0, 'Retry did not use current criteria');
          must(await page.evaluate(() => window.__retainedMap === document.querySelector('.map-panel > .map-canvas')), 'Retry remounted the successful map');
          if (width < 901) await page.getByRole('button', { name: 'Close expanded map', exact: true }).click();
          const title = await page.locator('.map-preview h2').textContent();
          await viewButton(page, width, 'List').click();
          await page.locator('.result-card').filter({ has: page.getByRole('heading', { name: title, exact: true }) }).locator('.result-select').click();
          await expect(page.getByRole('dialog', { name: 'Home details', exact: true })).toBeVisible();
          await page.getByRole('button', { name: 'Close home details', exact: true }).click();
          await expect(page.locator('.home-details[open]')).toHaveCount(0);
          await expect(page.getByTestId('results-count')).toHaveText('31 matches');
          must(new URL(page.url()).searchParams.get('minPrice') === '0' && new URL(page.url()).searchParams.get('q') === 'pool', 'Recovery/details changed criteria');
          await viewButton(page, width, 'Map').click();
          await expect(markers).toHaveCount(31);
          return { retriedQuery: 'pool', filter: 'minPrice=0', selectedTitle: title, currentMatches: 31, focusAfterRetry };
        });
        await check('superseded real response cannot replace newest map or search state', async () => {
          plan('garage', 'hold');
          await submit(page, width, 'garage');
          await expect.poll(() => held.length).toBe(2);
          await submit(page, width, 'Owens');
          await expect(page.getByTestId('results-count')).toHaveText('19 matches');
          await expect(markers).toHaveCount(19);
          held[1].release();
          await expect.poll(() => controls.filter(c => c.width === width && c.q === 'garage').at(-1)?.delivery).toBeTruthy();
          await page.waitForTimeout(300); // State settling, not a latency measurement.
          await expect(markers).toHaveCount(19);
          await expect(page.getByTestId('results-count')).toHaveText('19 matches');
          await expect(page.locator('.map-feedback')).toHaveCount(0);
          must(new URL(page.url()).searchParams.get('q') === 'Owens', 'Stale response changed URL');
          await page.screenshot({ path: path.join(out, `${width}-latest-real-map.png`) });
          return { latestQuery: 'Owens', points: 19, oldRealGaragePoints: 35, delayedDelivery: controls.filter(c => c.width === width && c.q === 'garage').at(-1).delivery };
        });
        await check('first map failure offers retry without losing the real list', async () => {
          plan('garage', 'hold-fail');
          await page.goto(origin + '/search?q=garage&view=map&minPrice=0');
          await expect.poll(() => held.length).toBe(3);
          await expect(page.locator('.map-loading')).toBeVisible();
          await expect(page.getByRole('button', { name: 'Retry map', exact: true })).toHaveCount(0);
          must((await page.evaluate(() => window.__mapFailureAlerts)).length === 0, 'Initial pending request announced a failure');
          held[2].release();
          await expect(page.getByRole('button', { name: 'Retry map', exact: true })).toBeVisible();
          await expect(page.getByTestId('results-count')).toHaveText('35 matches');
          await expect(embedded).toHaveCount(0);
          await page.getByRole('button', { name: 'Retry map', exact: true }).click();
          await expect(markers).toHaveCount(35);
          await expect(page.getByTestId('results-count')).toHaveText('35 matches');
          return { initialTransportFailure: true, retriedRealPoints: 35, matches: 35 };
        });
      } finally {
        held.forEach(h => h.release());
        await context.tracing.stop({ path: path.join(out, `${width}-trace.zip`) });
        await context.close(); save();
      }
    }
    must(errors.length === 0, JSON.stringify(errors));
  } finally { await browser.close(); save(); }
  console.log(JSON.stringify({ passed: records.filter(r => r.status === 'pass').length, total: records.length, out }));
})().catch(error => { console.error(error); process.exitCode = 1; });
