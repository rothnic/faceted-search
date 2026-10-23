// Actual-app journey checks; requires the existing 126-row private preview backend.
// Run from apps/web-next: SEARCHLAB_UX_ORIGIN=http://127.0.0.1:15176 node scripts/verify-ux.cjs
const { chromium, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const origin = process.env.SEARCHLAB_UX_ORIGIN;
if (!origin) throw new Error('Set SEARCHLAB_UX_ORIGIN to the reviewed production candidate.');
const out = process.env.SEARCHLAB_UX_ARTIFACTS || '/tmp/searchlab-ux-journeys';
fs.mkdirSync(out, { recursive: true });
const results = [];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.SEARCHLAB_CHROME || '/opt/google/chrome/chrome', headless: true });
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, ...(width < 900 ? { isMobile: true, hasTouch: true } : {}) });
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    const page = await context.newPage();
    const requests = [], errors = [];
    page.on('pageerror', error => errors.push(error.stack ?? String(error)));
    page.on('request', request => { if (request.url().endsWith('/api/search')) requests.push(request.postDataJSON()); });
    const cards = page.locator('.result-card');
    const views = page.locator(width < 900 ? '.mobile-views' : '.desktop-views');
    const check = async (name, action) => { const outcome = await action(); results.push({ width, name, status: outcome?.notApplicable ? 'not-applicable' : 'pass', ...(outcome?.notApplicable ? { reason: outcome.notApplicable } : {}) }); fs.writeFileSync(path.join(out, 'matrix.json'), JSON.stringify({ origin, results, errors }, null, 2)); };
    const scroll = () => page.evaluate(() => ({ window: scrollY, list: document.querySelector('.result-list').scrollTop }));
    const sameScroll = (a, b) => assert(Math.abs(a.window - b.window) <= 2 && Math.abs(a.list - b.list) <= 2, `scroll changed ${JSON.stringify({a,b})}`);
    try {
      await check('01 real backend, long feed and no implicit map load', async () => {
        await page.goto(origin + '/search?q=garage');
        await page.waitForFunction(()=>performance.getEntriesByName('searchlab-hydrated').length>0);
        await expect(cards).toHaveCount(18);
        await page.getByRole('button', { name: /^Show backend details/ }).click();
        await expect(page.getByRole('dialog', { name: 'Request details' })).toContainText('881e3b5660242affee21832c');
        await page.getByRole('button', { name: 'Close request details' }).click();
        await expect(page.getByRole('dialog', { name: 'Request details' })).toHaveCount(0);
        await expect(page.getByTestId('results-count')).toHaveText('35 matches');
        assert(!requests.some(r => r.mapOnly), 'Map requested on initial List');
        await page.screenshot({ path: path.join(out, `${width}-01-feed.png`) });
      });
      let before, firstIds;
      await check('02 card opens details while preserving mounted feed and scroll', async () => {
        const trigger = page.locator('.result-select').nth(6);
        await trigger.scrollIntoViewIfNeeded(); await trigger.focus();
        before = await scroll();
        await trigger.click();
        await expect(page.getByRole('dialog', { name: 'Home details' })).toBeVisible();
        await expect(cards).toHaveCount(18);
        await expect(page.locator('.results-workspace')).toHaveAttribute('data-view', 'list');
        assert(!requests.some(r => r.mapOnly), 'Details loaded a map');
        await expect(page).toHaveURL(/home=/);
        await page.screenshot({ path: path.join(out, `${width}-02-detail.png`) });
      });
      await check('03 close restores invoking card focus and feed position', async () => {
        await page.getByRole('button', { name: 'Close home details' }).click();
        await expect(page.locator('.home-details')).toHaveCount(0);
        sameScroll(before, await scroll());
        await expect(page.locator('.result-select').nth(6)).toBeFocused();
        assert(!new URL(page.url()).searchParams.has('home'), 'Selected home remains in URL');
      });
      await check('04 keyboard activation, focus containment and Escape', async () => {
        await page.keyboard.press('Enter');
        await expect(page.locator('.home-details[data-state="open"]')).toBeVisible();
        for (let i = 0; i < 8; i++) { await page.keyboard.press('Tab'); assert(await page.evaluate(() => document.querySelector('.home-details').contains(document.activeElement)), 'Focus escaped dialog'); }
        await page.keyboard.press('Escape');
        await expect(page.locator('.home-details')).toHaveCount(0);
        sameScroll(before, await scroll());
      });
      await check('05 browser Back/Forward closes/reopens selection without another search', async () => {
        const n = requests.filter(r => !r.mapOnly).length;
        await page.locator('.result-select').nth(6).click();
        await expect(page.locator('.home-details[data-state="open"]')).toBeVisible();
        await page.goBack(); await expect(page.locator('.home-details')).toHaveCount(0);
        sameScroll(before, await scroll());
        await page.goForward(); await expect(page.locator('.home-details[data-state="open"]')).toBeVisible();
        await page.keyboard.press('Escape'); await expect(page.locator('.home-details')).toHaveCount(0);
        assert(requests.filter(r => !r.mapOnly).length === n, 'UI history refetched or lost pages');
      });
      await check('06 pagination appends actual records exactly once', async () => {
        firstIds = await cards.evaluateAll(nodes => nodes.map(node => node.dataset.houseId));
        await page.getByRole('button', { name: 'Show more homes' }).click();
        await expect(cards).toHaveCount(35);
        const ids = await cards.evaluateAll(nodes => nodes.map(node => node.dataset.houseId));
        assert(new Set(ids).size === 35, 'Duplicate page records');
        assert(JSON.stringify(ids.slice(0,18)) === JSON.stringify(firstIds), 'First page replaced');
      });
      await check('07 page-two detail and history preserve all loaded pages', async () => {
        const trigger = page.locator('.result-select').nth(29);
        await trigger.scrollIntoViewIfNeeded(); await trigger.focus(); before = await scroll();
        await trigger.click(); await expect(page.locator('.home-details[data-state="open"]')).toBeVisible();
        await page.goBack(); await expect(page.locator('.home-details')).toHaveCount(0);
        await expect(cards).toHaveCount(35); sameScroll(before, await scroll());
        await page.goForward(); await expect(page.locator('.home-details[data-state="open"]')).toBeVisible();
        await page.getByRole('button', { name: 'Close home details' }).click(); await expect(page.locator('.home-details')).toHaveCount(0);
        await expect(cards).toHaveCount(35); sameScroll(before, await scroll());
      });
      await check('08 direct selected-home URL reload uses existing detail read', async () => {
        await page.locator('.result-select').nth(29).click();
        await expect(page.locator('.home-details[data-state="open"]')).toBeVisible();
        const selectedTitle = await page.locator('.home-details [role="heading"][aria-level="3"]').textContent();
        await page.reload(); await expect(page.locator('.home-details [role="heading"][aria-level="3"]')).toHaveText(selectedTitle);
        await page.getByRole('button', { name: 'Close home details' }).click(); await expect(page.locator('.home-details')).toHaveCount(0);
      });
      await check('09 explicit Map retains feed and List restores it', async () => {
        await expect(cards).toHaveCount(18);
        await page.locator('.result-select').nth(6).scrollIntoViewIfNeeded();
        await views.getByRole('button', { name: 'Map', exact: true }).scrollIntoViewIfNeeded(); before = await scroll();
        await views.getByRole('button', { name: 'Map', exact: true }).click();
        await expect(page.locator('.map-canvas')).toBeVisible();
        await expect(cards).toHaveCount(18);
        await views.getByRole('button', { name: 'List', exact: true }).click();
        await expect(page.locator('.result-list')).toBeVisible(); sameScroll(before, await scroll());
      });
      await check('10 explicit Show on map and back restore feed', async () => {
        await page.locator('.result-card').nth(5).getByRole('button', { name: 'Show on map' }).click();
        await expect(page.locator('.results-workspace')).toHaveAttribute('data-view', 'map');
        await expect(page.locator('.map-column')).toBeFocused();
        await page.goBack(); await expect(page.locator('.results-workspace')).toHaveAttribute('data-view', 'list');
      });
      await check('11 mobile filter drawer close is keyboard reachable; background is inert', async () => {
        if (width > 900) { await expect(page.getByRole('complementary', { name: 'Refine results' })).toBeVisible(); await expect(page.getByRole('button', { name: 'Close filters' })).toBeHidden(); return { notApplicable: 'Desktop uses a persistent complementary filter panel; mobile drawer keyboard controls are not applicable.' }; }
        await page.getByRole('button', { name: 'Filters (0)' }).click();
        await expect(page.getByRole('dialog', { name: 'Refine results' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Close filters' })).toBeFocused();
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Tab');
        await expect(page.getByRole('button', { name: 'Close filters' })).toBeFocused();
        assert(await page.locator('.results-column').evaluate(node => Boolean(node.closest('[aria-hidden="true"]'))), 'Background not inert');
        await page.keyboard.press('Enter');
        await expect(page.getByRole('button', { name: 'Filters (0)' })).toBeFocused();
        assert(await page.evaluate(() => document.body.style.overflow !== 'hidden'), 'Filter scroll lock leaked');
      });
      await check('12 applying facet and closing details retains query, chips and filters', async () => {
        if (width < 900) await page.getByRole('button', { name: 'Filters (0)' }).click();
        const cityGroup = (width < 900 ? page.getByRole('dialog', { name: 'Refine results' }) : page.locator('.desktop-filter-panel')).locator('[data-facet="city"]');
        await cityGroup.getByRole('button', { name: 'City', exact: true }).click();
        await expect(cityGroup.getByRole('checkbox').first()).toBeVisible();
        await cityGroup.getByRole('button', { name: 'City', exact: true }).click();
        await expect(cityGroup.getByRole('checkbox')).toHaveCount(0);
        await page.getByRole('checkbox', { name: /Pool/ }).check();
        if (width < 900) await page.keyboard.press('Escape');
        await expect(page.getByRole('button', { name: 'Remove Amenities: Pool' })).toBeVisible();
        await expect(page.locator('.results-workspace')).toHaveAttribute('aria-busy', 'false');
        const url = page.url();
        await page.locator('.result-select').first().click(); await expect(page.locator('.home-details[data-state="open"]')).toBeVisible();
        await page.keyboard.press('Escape'); await expect(page.locator('.home-details')).toHaveCount(0);
        assert(page.url() === url, 'Detail changed criteria URL');
        await expect(page.getByTestId('search-input')).toHaveValue('garage');
      });
      await check('13 query clear retains facet; numeric range uses real results', async () => {
        await page.getByRole('button', { name: 'Clear search query' }).click();
        await expect(page.getByTestId('results-count')).toHaveText('31 matches');
        if (width < 900) await page.getByRole('button', { name: 'Filters (1)' }).click();
        await page.getByRole('spinbutton', { name: 'Maximum price' }).fill('450000');
        if (width < 900) await page.keyboard.press('Escape');
        await expect(page.getByTestId('results-count')).toHaveText('18 matches');
        await expect(cards).toHaveCount(18);
      });
      await check('14 criterion Back/Forward restores query and facets', async () => {
        await page.getByRole('button', { name: 'Remove Amenities: Pool' }).click();
        await expect(page.getByRole('button', { name: 'Remove Amenities: Pool' })).toHaveCount(0);
        await page.goBack(); await expect(page.getByRole('button', { name: 'Remove Amenities: Pool' })).toBeVisible();
        await page.goForward(); await expect(page.getByRole('button', { name: 'Remove Amenities: Pool' })).toHaveCount(0);
      });
      await check('15 rapid typing cancels stale query and retains final real result', async () => {
        await page.goto(origin + '/search'); await expect(cards).toHaveCount(18);
        await page.waitForFunction(()=>performance.getEntriesByName('searchlab-hydrated').length>0);
        await page.getByTestId('search-input').fill('garage'); await page.waitForTimeout(200);
        await page.getByTestId('search-input').fill('pool');
        if (width < 901) await page.getByRole('button', { name: 'Search', exact: true }).click();
        await expect(page.getByTestId('results-count')).toHaveText('31 matches');
        await expect(page.getByTestId('search-input')).toHaveValue('pool');
        await expect(page.locator('.results-workspace')).toHaveAttribute('aria-busy', 'false');
        assert(new URL(page.url()).searchParams.get('q') === 'pool', 'Stale query URL');
      });
      await check('16 real empty state and recovery', async () => {
        await page.getByTestId('search-input').fill('zzzznosuchpropertyzzzz');
        if (width < 901) await page.getByRole('button', { name: 'Search', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'No homes match this search' })).toBeVisible();
        await page.getByRole('button', { name: 'Clear search query' }).click(); await expect(cards).toHaveCount(18);
      });
      await check('17 detail stays usable across viewport changes', async () => {
        await page.getByRole('button',{name:'Show more homes'}).click(); await expect(cards).toHaveCount(36);
        await page.locator('.result-select').nth(25).click(); await expect(page.locator('.home-details[data-state="open"]')).toBeVisible();
        for (const w of [320,768,1440,390]) { await page.setViewportSize({width:w,height:640}); await expect(page.getByRole('button',{name:'Close home details'})).toBeInViewport(); assert(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth + 1), 'Horizontal overflow'); }
        await page.keyboard.press('Escape'); await expect(page.locator('.home-details')).toHaveCount(0);
        assert(await page.evaluate(()=>document.body.style.overflow !== 'hidden'), 'Detail scroll lock leaked');
        await expect(page.locator('.result-select').nth(25)).toBeFocused();
        await expect(page.locator('.result-select').nth(25)).toBeInViewport();
        for (const [start, end] of [[1440,390],[390,1440]]) {
          await page.setViewportSize({width:start,height:844});
          const trigger=page.locator('.result-select').nth(25);
          await trigger.scrollIntoViewIfNeeded(); await trigger.focus();
          const n=requests.filter(r=>!r.mapOnly).length;
          await trigger.click(); await expect(page.locator('.home-details[data-state="open"]')).toBeVisible();
          await page.setViewportSize({width:end,height:844});
          await page.locator('.home-details').getByRole('button',{name:'Show on map',exact:true}).click();
          await expect(page.locator('.map-column')).toBeFocused();
          await page.goBack(); await expect(page.locator('.results-workspace')).toHaveAttribute('data-view','list');
          await expect(trigger).toBeFocused(); await expect(trigger).toBeInViewport();
          await expect(cards).toHaveCount(36);
          await page.goForward(); await expect(page.locator('.map-column')).toBeFocused();
          await page.goBack(); await expect(trigger).toBeFocused(); await expect(trigger).toBeInViewport();
          assert(requests.filter(r=>!r.mapOnly).length===n,'Resized map history refetched loaded feed');
        }
      });
      await check('18 mobile drawer to desktop releases modal state and scroll lock', async () => {
        await page.setViewportSize({width:390,height:844});
        await page.getByRole('button',{name:'Filters (0)'}).click();
        await page.setViewportSize({width:1440,height:844});
        await expect(page.getByRole('dialog',{name:'Refine results'})).toHaveCount(0);
        assert(await page.evaluate(()=>document.body.style.overflow !== 'hidden' && !document.querySelector('.results-column').inert), 'Resize left modal lock');
      });
      await check('19 desktop Split to mobile normalizes visible view controls', async () => {
        await page.locator('.desktop-views').getByRole('button',{name:'Split',exact:true}).click();
        await expect(page.locator('.map-canvas')).toBeVisible();
        const marker = page.locator('.leaflet-interactive').first();
        await expect(marker).toHaveAttribute('role','button'); await marker.focus(); await page.keyboard.press('Enter');
        await expect(marker).toHaveAttribute('aria-pressed','true'); await expect(page.locator('.map-preview')).toBeVisible();
        const y = await page.evaluate(()=>scrollY); await page.keyboard.press('Space'); assert(await page.evaluate(()=>scrollY)===y,'Marker Space scrolled page');
        await page.getByRole('button',{name:'Zoom in',exact:true}).focus(); await page.keyboard.press('Enter');
        await page.setViewportSize({width:390,height:844});
        await expect(page.locator('.mobile-views').getByRole('button',{name:'List',exact:true})).toHaveAttribute('aria-pressed','true');
        await expect(page.locator('.result-list')).toBeVisible();
      });
      await check('20 closed overlay leaves mobile feed scrollable by mouse wheel emulation', async () => {
        await page.evaluate(()=>scrollTo(0,300)); const y = await page.evaluate(()=>scrollY);
        await page.mouse.move(200,500); await page.mouse.wheel(0,500); await page.waitForTimeout(100);
        assert(await page.evaluate(()=>scrollY) > y, 'Feed cannot scroll');
        await page.screenshot({path:path.join(out,`${width}-20-feed-recovered.png`)});
      });
      await check('21 missing detail has honest recovery', async () => {
        await page.goto(origin + '/search?home=not-a-real-home');
        await expect(page.locator('.home-details [role=alert]')).toContainText('no longer available');
        await page.getByRole('button',{name:'Close home details'}).click(); await expect(page.locator('.home-details')).toHaveCount(0);
        await expect(cards).toHaveCount(18);
        await expect(page.getByTestId('results-heading')).toBeFocused();
      });
      await check('22 no application runtime errors', async () => assert(!errors.length, errors.join('\n')));
      await check('23 price-first then facet history preserves loaded page two', async () => {
        await page.setViewportSize({width,height:844});
        if(width<900) await page.getByRole('button',{name:'Filters (0)'}).click();
        await page.getByRole('spinbutton',{name:'Minimum price'}).fill('0');
        await page.getByRole('checkbox',{name:/Garage/}).check();
        if(width<900) await page.keyboard.press('Escape');
        await expect(page.getByTestId('results-count')).toHaveText('35 matches');
        await page.getByRole('button',{name:'Show more homes'}).click(); await expect(cards).toHaveCount(35);
        const count=requests.filter(r=>!r.mapOnly).length;
        await page.locator('.result-select').nth(29).click(); await expect(page.locator('.home-details[data-state="open"]')).toBeVisible();
        await page.goBack(); await expect(page.locator('.home-details')).toHaveCount(0); await expect(cards).toHaveCount(35);
        assert(requests.filter(r=>!r.mapOnly).length===count,'Equivalent criteria reordered and refetched');
      });
      await check('24 restored Split and direct mobile detail preserve navigation ownership', async () => {
        await page.setViewportSize({width:1440,height:844});
        await page.locator('.desktop-views').getByRole('button',{name:'Split',exact:true}).click();
        const id=await cards.first().getAttribute('data-house-id');
        await page.locator('.result-select').first().click(); await expect(page.locator('.home-details[data-state="open"]')).toBeVisible();
        await page.setViewportSize({width:390,height:844}); await page.keyboard.press('Escape'); await expect(page.locator('.home-details')).toHaveCount(0);
        await expect(page.locator('.mobile-views').getByRole('button',{name:'List',exact:true})).toHaveAttribute('aria-pressed','true');
        await page.locator('.result-select').first().click(); await expect(page.locator('.home-details[data-state="open"]')).toBeVisible();
        await page.locator('.home-details').getByRole('button',{name:'Show on map',exact:true}).click();
        await expect(page.locator('.map-column')).toBeFocused();
        await page.goBack(); await expect(page.locator('.results-workspace')).toHaveAttribute('data-view','list');
        await page.goto(origin+'/search?view=split&home='+id); await expect(page.locator('.home-details [role="heading"][aria-level="3"]')).toBeVisible();
        await page.getByRole('button',{name:'Close home details'}).click(); await expect(page.locator('.home-details')).toHaveCount(0);
        assert(!new URL(page.url()).searchParams.has('minPrice'),'Direct detail close navigated to previous criteria');
        await expect(page.locator('.mobile-views').getByRole('button',{name:'List',exact:true})).toHaveAttribute('aria-pressed','true');
        await expect(cards).toHaveCount(18);
      });
      assert(!errors.length, errors.join('\n'));
    } catch (error) {
      results.push({width,status:'fail',error:String(error)});
      await page.screenshot({path:path.join(out,`${width}-failure.png`)});
      throw error;
    } finally {
      fs.writeFileSync(path.join(out,'matrix.json'),JSON.stringify({origin,results,errors},null,2));
      await context.tracing.stop({path:path.join(out,`${width}-trace.zip`)});
      await context.close();
    }
  }
  await browser.close(); console.log(JSON.stringify({passed:results.filter(row=>row.status==='pass').length,notApplicable:results.filter(row=>row.status==='not-applicable').length,total:results.length,out}));
})().catch(error=>{console.error(error);process.exit(1)});
