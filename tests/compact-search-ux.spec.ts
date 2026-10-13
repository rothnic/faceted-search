import {expect,test} from '@playwright/test';

for (const viewport of [{width:1366,height:900},{width:761,height:900},{width:390,height:844},{width:320,height:844}]) {
  test(`compact controls keep results above the fold at ${viewport.width}px`, async ({page}) => {
    await page.setViewportSize(viewport);
    await page.goto('/search?mode=keyword&q=garage');
    await expect(page.locator('.result').first()).toBeVisible();
    await expect(page.locator('.results-panel > .results-head .result-tools #save-search')).toBeVisible();
    await expect(page.locator('.results-panel > .results-workspace')).toBeVisible();
    await expect(page.getByRole('textbox',{name:'Search',exact:true})).toHaveAttribute('placeholder','Search homes, neighborhoods, or features…');
    expect(await page.locator('label[for="search-box"]').evaluate(e=>e.getBoundingClientRect().height)).toBe(1);
    const headline=(await page.locator('.results-head h2').boundingBox())!;
    const actions=(await page.locator('.result-tools').boundingBox())!;
    expect(Math.abs(headline.y+headline.height/2-actions.y-actions.height/2)).toBeLessThanOrEqual(1);
    await expect(page.getByRole('button',{name:'Save search',exact:true})).toBeVisible();
    const radii=await page.locator('#search-box,#save-search,.toolbar,.result').evaluateAll(es=>es.map(e=>parseFloat(getComputedStyle(e).borderTopLeftRadius)));
    expect(Math.max(...radii)).toBeLessThanOrEqual(8);
    await expect(page.locator('#system-info')).not.toHaveAttribute('open');
    await page.locator('#system-info-toggle').click();
    await expect(page.locator('#summary-schema-link')).toBeVisible();
    await page.locator('#summary-schema-link').focus();
    await page.keyboard.press('Escape');
    await expect(page.locator('#system-info')).not.toHaveAttribute('open');
    await page.locator('#system-info-toggle').click();
    await expect(page.locator('[data-virtual-summary]')).toBeVisible();
    await page.locator('#system-info-toggle').press('Escape');
    await expect(page.locator('.map-key')).not.toHaveAttribute('open');
    const visibleCountCopies = await page.evaluate(() => {
      const text = [...document.querySelectorAll<HTMLElement>('.results-head,.map-head')].map(e=>e.innerText).join(' ');
      return (text.match(/\b35\b/g)||[]).length;
    });
    expect(visibleCountCopies).toBe(1);
    const geometry = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.result')].map((card) => card.getBoundingClientRect());
      const warningHeight = [...document.querySelectorAll('.execution-warning')].reduce((height,element) => height + element.getBoundingClientRect().height + parseFloat(getComputedStyle(element).marginBottom), 0);
      return {firstResultY:cards[0].y,firstResultHeight:cards[0].height,firstResultBottom:cards[0].bottom,warningHeight,controlsAndResultsY:cards[0].y-warningHeight,fullyVisible:cards.filter((r)=>r.y>=0&&r.bottom<=innerHeight).length,partiallyVisible:cards.filter((r)=>r.y<innerHeight&&r.bottom>0).length,overflow:document.documentElement.scrollWidth>innerWidth};
    });
    console.log('COMPACT_LAYOUT',viewport,geometry);
    // Execution warnings must remain visible; their content/line wrapping is data-dependent.
    expect(geometry.controlsAndResultsY).toBeLessThan(viewport.width<760?450:350);
    expect(geometry.firstResultY).toBeLessThan(viewport.width<760?600:440);
    expect(geometry.fullyVisible).toBeGreaterThanOrEqual(1);
    expect(geometry.overflow).toBe(false);
    if (viewport.width < 760) {
      await expect(page.locator('#search-mode')).toBeHidden();
      await expect(page.locator('#provider')).toBeHidden();
      const inputBox = (await page.locator('#search-box').boundingBox())!;
      const sortBox = (await page.locator('#sort').boundingBox())!;
      const filterBox = (await page.locator('#toggle-filters').boundingBox())!;
      expect(inputBox.height).toBeGreaterThanOrEqual(44);
      expect(sortBox.height).toBeGreaterThanOrEqual(44);
      expect(filterBox.height).toBeGreaterThanOrEqual(44);
      expect(filterBox.y).toBeGreaterThanOrEqual(inputBox.y+inputBox.height);
      expect(Math.abs(filterBox.y-sortBox.y)).toBeLessThan(1);
      expect(filterBox.x).toBeGreaterThan(sortBox.x);
      expect(filterBox.width).toBeLessThan(130);
      const resultButtons=await page.locator('#mobile-view-toggle,#save-search').evaluateAll(es=>es.map(e=>({height:e.getBoundingClientRect().height,y:e.getBoundingClientRect().y,font:getComputedStyle(e).fontSize,padding:getComputedStyle(e).paddingInlineStart})));
      expect(resultButtons[0]).toEqual(resultButtons[1]);
      expect(resultButtons[0].height).toBe(44);
      const chipPaint=await page.locator('.refinement-pill > .badge,.hit-chip > .badge').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().height));
      expect(Math.max(...chipPaint)).toBeLessThanOrEqual(24);
      await expect(page.locator('#result-info-toggle')).toHaveCount(0);
      const utilityStyles=await page.locator('#sort,#system-info-toggle').evaluateAll(es=>es.map(e=>({border:getComputedStyle(e).borderTopWidth,height:e.getBoundingClientRect().height})));
      for(const utility of utilityStyles) { expect(utility.border).toBe('0px'); expect(utility.height).toBeGreaterThanOrEqual(44); }
      const cardBox = (await page.locator('.result').first().boundingBox())!;
      const amenityRow = (await page.locator('.result-actions').first().boundingBox())!;
      expect(amenityRow.height).toBeLessThanOrEqual(100);
      expect(Math.abs(cardBox.x-(viewport.width-cardBox.x-cardBox.width))).toBeLessThanOrEqual(2);
      await page.locator('#search-box').fill('gar');
      await expect(page.locator('#search-suggestions')).toBeVisible();
      const menu = (await page.locator('#search-suggestions').boundingBox())!;
      expect(Math.abs(menu.x-inputBox.x)).toBeLessThan(1);
      expect(Math.abs(menu.width-inputBox.width)).toBeLessThan(1);
      expect(menu.y).toBeGreaterThanOrEqual(inputBox.y+inputBox.height);
      await page.locator('#search-box').fill('garage');
      await page.locator('#search-box').press('Escape');
      await expect(page.locator('#search-suggestions')).toBeHidden();
      await page.locator('#toggle-filters').click();
      await expect(page.locator('#mobile-provider')).toBeVisible();
      await expect(page.locator('#mobile-mode')).toBeVisible();
      await page.locator('#mobile-mode').focus();
      await page.locator('#mobile-mode').selectOption('semantic');
      await expect(page).toHaveURL(/mode=semantic/);
      await expect(page.locator('#mobile-mode')).toBeFocused();
      await page.locator('#mobile-mode').selectOption('keyword');
      await page.locator('#mobile-provider').focus();
      await page.locator('#mobile-provider').selectOption('meilisearch');
      await expect(page).toHaveURL(/provider=meilisearch/);
      await expect(page.locator('#mobile-provider')).toBeFocused();
      const optionStyle = await page.locator('#sort option').first().evaluate(e=>({font:getComputedStyle(e).fontSize,color:getComputedStyle(e).color}));
      expect(parseFloat(optionStyle.font)).toBeGreaterThanOrEqual(14);
      expect(optionStyle.color).not.toBe('rgba(0, 0, 0, 0)');
      await expect(page).toHaveURL(/mode=keyword/);
      await page.locator('[data-facet="city"] input').first().check();
      await expect(page.locator('#active-filter-count')).toHaveText('1');
      const close = page.getByRole('button',{name:'Show results',exact:true});
      await close.click();
      await expect(page.locator('#search-filters')).toBeHidden();
      await expect(page.locator('#toggle-filters')).toBeFocused();
    } else {
      const controls = await page.evaluate(() => ['search-box','search-mode','provider','sort'].map(id => {
        const input = document.getElementById(id)!; const label = document.querySelector(`label[for="${id}"]`)!;
        return {labelY:label.getBoundingClientRect().y,inputY:input.getBoundingClientRect().y,height:input.getBoundingClientRect().height,background:getComputedStyle(input).backgroundColor,arrow:getComputedStyle(input).backgroundImage};
      }));
      expect(Math.max(...controls.slice(1).map(c=>c.labelY))-Math.min(...controls.slice(1).map(c=>c.labelY))).toBeLessThan(1);
      expect(Math.max(...controls.map(c=>c.inputY))-Math.min(...controls.map(c=>c.inputY))).toBeLessThan(1);
      expect(controls[0].background).not.toBe(controls[1].background);
      for (const control of controls.slice(1)) { expect(control.arrow).toContain('data:image/svg+xml'); expect(control.height).toBeGreaterThanOrEqual(40); }
      const selectFit = await page.locator('#search-mode,#provider,#sort').evaluateAll(elements => elements.map(element => {
        const select=element as HTMLSelectElement, style=getComputedStyle(select);
        const canvas=document.createElement('canvas'), context=canvas.getContext('2d')!;
        context.font=style.font;
        return {id:select.id, available:select.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight),
          widest:Math.max(...[...select.options].map(option=>context.measureText(option.text).width))};
      }));
      for (const fit of selectFit) expect(fit.widest, `${fit.id} labels fit without ellipsis`).toBeLessThanOrEqual(fit.available);
      await page.getByLabel('Mode',{exact:true}).selectOption('semantic');
      await expect(page).toHaveURL(/mode=semantic/);
      await page.getByLabel('Mode',{exact:true}).selectOption('keyword');
      await expect(page).toHaveURL(/mode=keyword/);
    }
    await expect(page.locator('body')).not.toContainText('Scroll for more');
  });
}
