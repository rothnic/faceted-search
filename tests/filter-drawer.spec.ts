import {expect,test} from '@playwright/test';

for (const width of [320,390]) {
  test(`standard filter drawer preserves focus and criteria at ${width}px`, async ({page}) => {
    await page.setViewportSize({width,height:844});
    await page.goto('/search?mode=keyword&q=garage');
    await expect(page.locator('.result').first()).toBeVisible();
    await expect(page.locator('#filter-drawer')).toHaveClass(/drawer/);
    await expect(page.locator('#search-filters')).toBeHidden();
    await page.locator('#toggle-filters').click();
    const panel=page.getByRole('dialog',{name:'Filters',exact:true});
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute('aria-modal','true');
    await expect.poll(()=>page.locator('#filter-panel-title').evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})).toBe(true);
    await expect(page.locator('#close-filter-panel')).toBeFocused();
    const heading=(await page.locator('#filter-panel-title').boundingBox())!;
    const close=(await page.locator('#close-filter-panel').boundingBox())!;
    expect(close.x).toBeGreaterThan(heading.x+heading.width);
    expect(Math.abs(close.y+close.height/2-heading.y-heading.height/2)).toBeLessThanOrEqual(1);
    expect(await page.locator('#search-results').evaluate(e=>(e as HTMLElement).inert)).toBe(true);
    await expect(page.getByRole('group',{name:'Ranges',exact:true})).toBeVisible();
    const min=page.getByLabel('Min price',{exact:true});
    await min.fill('200000');
    await min.press('Tab');
    await expect(page).toHaveURL(/minPrice/);
    await expect(min).toHaveValue('200000');
    const city=page.locator('[data-facet=city] input').first();
    const cityId=await city.getAttribute('id');
    await city.check();
    await expect(page.locator(`[id="${cityId}"]`)).toBeFocused();
    await expect(page.locator('#filter-drawer-toggle')).toBeChecked();
    await page.locator('#clear-filters').focus();
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('[data-facet="saved-searches"] input[type=checkbox]').last()).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#clear-filters')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(page.locator('#toggle-filters')).toBeFocused();
    expect(await page.locator('#search-results').evaluate(e=>(e as HTMLElement).inert)).toBe(false);
    await page.locator('#toggle-filters').click();
    await expect(min).toHaveValue('200000');
    const overlay=page.locator('.drawer-overlay');
    // The root scrollbar gutter may settle after opening. Aim at the exposed
    // backdrop strip, not at the viewport's disappearing outermost pixels.
    await expect.poll(()=>overlay.evaluate(element=>{
      const overlay=element.getBoundingClientRect(),panel=document.querySelector('#filter-panel-content')!.getBoundingClientRect();
      if (Math.abs(panel.left-overlay.left)>.5 || document.querySelector('#filter-panel-content')!.getAnimations().some(animation=>animation.playState==='running')) return false;
      const x=(panel.right+Math.min(overlay.right,document.documentElement.clientWidth))/2;
      return document.elementFromPoint(x,180)===element;
    })).toBe(true);
    const point=await overlay.evaluate(element=>{
      const overlay=element.getBoundingClientRect(),panel=document.querySelector('#filter-panel-content')!.getBoundingClientRect();
      return {x:(panel.right+Math.min(overlay.right,document.documentElement.clientWidth))/2-overlay.left,y:180-overlay.top};
    });
    await overlay.click({position:point});
    await expect(page.locator('#search-filters')).toBeHidden();
    await expect(page.locator('#toggle-filters')).toBeFocused();
    await page.locator('#mobile-view-toggle').click();
    const buttons=await page.locator('#mobile-view-toggle,#save-search').evaluateAll(es=>es.map(e=>({height:e.getBoundingClientRect().height,font:getComputedStyle(e).fontSize,padding:getComputedStyle(e).paddingInlineStart})));
    expect(buttons[0]).toEqual(buttons[1]);
    expect(buttons[0].height).toBe(44);
    await page.locator('#toggle-filters').click();
    await page.setViewportSize({width:1366,height:900});
    await expect(page.locator('#filter-drawer')).toHaveClass(/drawer-open/);
    await expect(page.locator('#search-filters')).toBeVisible();
    await expect(page.locator('#filter-panel-content')).not.toHaveAttribute('aria-modal');
    await expect(page.locator('#clear-filters')).toBeFocused();
    expect(await page.locator('#search-results').evaluate(e=>(e as HTMLElement).inert)).toBe(false);
    await expect(page.locator('#save-search')).toHaveCSS('height','40px');
    await page.setViewportSize({width,height:844});
    await expect(page.locator('#search-filters')).toBeHidden();
    await expect(page.locator('#filter-drawer-toggle')).not.toBeChecked();
  });
}
