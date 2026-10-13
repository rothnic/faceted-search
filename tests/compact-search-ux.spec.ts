import {expect,test} from '@playwright/test';

for (const viewport of [{width:1366,height:900},{width:390,height:844}]) {
  test(`compact controls keep results above the fold at ${viewport.width}px`, async ({page}) => {
    await page.setViewportSize(viewport);
    await page.goto('/search?mode=keyword&q=garage');
    await expect(page.locator('.result').first()).toBeVisible();
    await expect(page.locator('#system-info')).not.toHaveAttribute('open');
    await expect(page.locator('#result-info')).not.toHaveAttribute('open');
    await page.locator('#system-info-toggle').click();
    await expect(page.locator('#summary-schema-link')).toBeVisible();
    await page.locator('#summary-schema-link').focus();
    await page.keyboard.press('Escape');
    await expect(page.locator('#system-info')).not.toHaveAttribute('open');
    await page.locator('#result-info-toggle').click();
    await expect(page.locator('[data-virtual-summary]')).toBeVisible();
    await page.locator('#result-info-toggle').press('Escape');
    await expect(page.locator('#result-info')).not.toHaveAttribute('open');
    const geometry = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.result')].map((card) => card.getBoundingClientRect());
      const warningHeight = [...document.querySelectorAll('.execution-warning')].reduce((height,element) => height + element.getBoundingClientRect().height + parseFloat(getComputedStyle(element).marginBottom), 0);
      return {firstResultY:cards[0].y,warningHeight,controlsAndResultsY:cards[0].y-warningHeight,fullyVisible:cards.filter((r)=>r.y>=0&&r.bottom<=innerHeight).length,partiallyVisible:cards.filter((r)=>r.y<innerHeight&&r.bottom>0).length,overflow:document.documentElement.scrollWidth>innerWidth};
    });
    console.log('COMPACT_LAYOUT',viewport,geometry);
    // Execution warnings must remain visible; their content/line wrapping is data-dependent.
    expect(geometry.controlsAndResultsY).toBeLessThan(viewport.width<760?450:350);
    expect(geometry.firstResultY).toBeLessThan(viewport.width<760?600:440);
    expect(geometry.fullyVisible).toBeGreaterThanOrEqual(1);
    expect(geometry.overflow).toBe(false);
    for (const id of ['search-box','search-mode','provider','sort']) {
      const box = await page.locator(`#${id}`).boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(viewport.width<760?44:40);
    }
    if (viewport.width < 760) {
      await page.getByRole('button',{name:'Show or hide filters'}).click();
      const close = page.getByRole('button',{name:'Show results',exact:true});
      await expect(close).toBeVisible();
      const closeBox = await close.boundingBox();
      expect(closeBox!.y + closeBox!.height).toBeLessThan(viewport.height);
      await close.click();
      await expect(page.locator('#search-filters')).toBeHidden();
      await expect(page.locator('#toggle-filters')).toBeFocused();
    }
    await page.getByLabel('Mode',{exact:true}).selectOption('semantic');
    await expect(page).toHaveURL(/mode=semantic/);
    await expect(page.getByLabel('Mode',{exact:true})).toHaveValue('semantic');
    await page.getByLabel('Mode',{exact:true}).selectOption('keyword');
    await expect(page).toHaveURL(/mode=keyword/);
  });
}
