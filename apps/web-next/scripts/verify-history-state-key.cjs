// Actual production regression: UI-only history must not remount the live feed.
const { chromium, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const origin = process.env.SEARCHLAB_UX_ORIGIN;
if (!origin) throw new Error('Set SEARCHLAB_UX_ORIGIN to the real126-row production candidate.');
const out = process.env.SEARCHLAB_UX_ARTIFACTS || `/tmp/searchlab-history-key-${Date.now()}`;
fs.mkdirSync(out, { recursive: true });
const results = [];
const save = () => fs.writeFileSync(path.join(out, 'matrix.json'), JSON.stringify({ origin, results }, null, 2));
const must = (value, message) => { if (!value) throw new Error(message); };
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.SEARCHLAB_CHROME || '/opt/google/chrome/chrome' });
  try {
    for (const width of [390, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 844 } });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(String(error)));
      try {
        await page.goto(origin + '/search?q=garage');
        await page.locator('.request-timing:enabled').waitFor();
        await page.locator('.result-select').nth(6).click();
        await expect(page.locator('.home-details[open]')).toBeVisible();
        await page.reload();
        await expect(page.locator('.home-details[open]')).toBeVisible();
        await page.locator('.request-timing:enabled').waitFor();
        await page.evaluate(() => {
          window.__historyKeyProof = {
            card: document.querySelectorAll('.result-select')[6],
            input: document.querySelector('input[name=q]'),
            effects: performance.getEntriesByName('searchlab-hydrated').length
          };
        });
        await page.getByRole('button', { name: 'Close home details', exact: true }).click();
        await expect(page.locator('dialog')).toHaveCount(0);
        // This is an identity regression check, not a latency measurement.
        await page.waitForTimeout(400);
        const proof = await page.evaluate(() => ({
          sameCard: window.__historyKeyProof.card === document.querySelectorAll('.result-select')[6],
          sameInput: window.__historyKeyProof.input === document.querySelector('input[name=q]'),
          effectsBefore: window.__historyKeyProof.effects,
          effectsAfter: performance.getEntriesByName('searchlab-hydrated').length,
          count: document.querySelector('[data-testid=results-count]').textContent
        }));
        const preserved = proof.sameCard && proof.sameInput && proof.effectsBefore === proof.effectsAfter && proof.count === '35 matches';
        results.push({ width, name: 'reloaded detail closes without feed/input remount', status: preserved ? 'pass' : 'fail', proof }); save();
        must(preserved, 'UI-only history remounted the feed: ' + JSON.stringify(proof));
        await page.screenshot({ path: path.join(out, `${width}-preserved-feed.png`) });
        await page.evaluate(() => { window.__sameDocument = true; });
        await page.getByRole('link', { name: 'Searchlab home', exact: true }).click();
        await expect(page.getByTestId('results-count')).toHaveText('126 matches');
        const reset = await page.evaluate(() => ({ sameDocument: window.__sameDocument === true, freshInput: window.__historyKeyProof.input !== document.querySelector('input[name=q]'), q: document.querySelector('input[name=q]').value }));
        must(reset.sameDocument && reset.freshInput && reset.q === '', 'Changed criteria did not get fresh server state: ' + JSON.stringify(reset));
        await page.goBack();
        await expect(page.getByTestId('results-count')).toHaveText('35 matches');
        must(errors.length === 0, errors.join('\n'));
        results.push({ width, name: 'changed criteria reseed and Back restores query', status: 'pass', reset, errors }); save();
      } finally { await context.close(); }
    }
  } finally { await browser.close(); save(); }
  console.log(JSON.stringify({ passed: results.filter(r => r.status === 'pass').length, total: results.length, out }));
})().catch(error => { console.error(error); process.exitCode = 1; });
