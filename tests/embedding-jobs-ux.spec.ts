import { expect, test } from '@playwright/test';

const pipeline = {
  storageMode: 'postgres', durable: true, enabled: true, observedAt: '2026-10-13T19:00:00Z',
  model: { model: 'Xenova/all-MiniLM-L6-v2', key: 'pinned-model' },
  queue: { backend: 'pgmq', name: 'cpu_embeddings', maxActive: 1, maxQueued: 100, created: 7, active: 2, retry: 3, failed: 4, completed: 50,
    concurrencyNote: 'A lost PostgreSQL session can briefly leave abandoned native inference running alongside its replacement; stale results are fenced.' },
  documents: { total: 80, current: 70, pending: 10, failed: 2, projectionPending: 5, deletedPending: 1 },
  sourceFields: ['title', 'description', 'amenities'], lastDispatchAt: '2026-10-13T18:59:00Z',
  recentFailures: [{ houseId: 'listing-1', error: '<img src=x onerror=alert(1)> engine unavailable', attempts: 3, retryAt: '2026-10-13T19:01:00Z' }]
};

async function mockPipeline(page: import('@playwright/test').Page, value = pipeline) {
  await page.route('**/api/embedding-jobs', (route) => route.fulfill({json:value}));
  await page.route('**/api/sync/status', (route) => route.fulfill({json:{storageMode:'postgres',outboxPendingCount:0,providers:{},outbox:[]}}));
}

test('in-memory pipeline reports on-demand mode without fabricated job counts', async ({page}) => {
  await page.goto('/system');
  const panel = page.locator('#embedding-pipeline');
  await expect(panel.getByText('On-demand demo · no durable embedding queue')).toBeVisible();
  await expect(panel.getByRole('button')).toHaveCount(0);
  await expect(panel.getByText('Observed queue')).toHaveCount(0);
});

test('durable counters, native-engine ownership and recovery caveats stay truthful', async ({page}) => {
  await mockPipeline(page);
  await page.goto('/system');
  const panel = page.locator('#embedding-pipeline');
  await expect(panel.getByText('Durable PostgreSQL queue', {exact:true})).toBeVisible();
  await expect(panel.getByText(/Meilisearch and Typesense generate their own embeddings/)).toBeVisible();
  await expect(panel.locator('dt').filter({hasText:/^Active reservations$/}).locator('+ dd')).toHaveText('2');
  await expect(panel.locator('dt').filter({hasText:/^Consumer limit$/}).locator('+ dd')).toHaveText('1');
  await expect(panel.locator('dt').filter({hasText:/^Pipeline completions pending$/}).locator('+ dd')).toHaveText('5');
  await expect(panel.getByText(pipeline.queue.concurrencyNote, {exact:true})).toBeVisible();
  await expect(panel.getByText(pipeline.recentFailures[0].error, {exact:true})).toBeVisible();
  await expect(panel.locator('img')).toHaveCount(0);
  await expect(page.getByText(/No continuous worker or durable running-job telemetry/)).toHaveCount(0);
});

test('backfill admission is single-flight and never described as completed work', async ({page}) => {
  await mockPipeline(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {release=resolve;});
  let posts = 0;
  await page.route('**/api/embedding-jobs/backfill', async (route) => { posts++; await gate; await route.fulfill({status:202,json:{accepted:43,invalidated:40}}); });
  await page.goto('/system');
  const button = page.getByRole('button', {name:'Queue missing or stale embeddings'});
  await button.click();
  await expect(button).toBeDisabled();
  expect(posts).toBe(1);
  release();
  await expect(page.locator('#operation-feedback')).toContainText('43 document records accepted for scheduling; 40 document records invalidated');
  await expect(page.locator('#operation-feedback')).toContainText('Scheduling is not completed indexing');
  await expect(button).toBeEnabled();
  await expect(button).toBeFocused();
  await expect(page.locator('#embedding-pipeline dt').filter({hasText:/^Waiting for first attempt$/}).locator('+ dd')).toHaveText('7');
});

test('unknown pipeline status stays unknown and can recover to disabled configuration', async ({page}) => {
  await page.route('**/api/embedding-jobs', (route) => route.fulfill({status:503,json:{error:'Queue database unavailable'}}));
  await page.goto('/system');
  await expect(page.locator('#embedding-pipeline')).toContainText('Queue counts and worker activity are unknown');
  await expect(page.locator('#queue-embedding-backfill')).toHaveCount(0);
  await page.unroute('**/api/embedding-jobs');
  await mockPipeline(page, {...pipeline,enabled:false});
  await page.getByRole('button',{name:'Refresh status'}).click();
  await expect(page.getByText('Pipeline disabled',{exact:true})).toBeVisible();
  await expect(page.locator('#queue-embedding-backfill')).toBeDisabled();
});

test('pipeline disclosure and keyboard focus survive status polling independently of sync disclosure', async ({page}) => {
  await mockPipeline(page);
  await page.clock.install();
  await page.goto('/system');
  const summary = page.locator('#embedding-jobs-raw-summary');
  await summary.click();
  await expect(page.locator('#embedding-jobs-raw')).toHaveAttribute('open','');
  await expect(page.locator('#system-sync-raw')).not.toHaveAttribute('open','');
  await summary.focus();
  await page.clock.fastForward(10_001);
  await expect(summary).toBeFocused();
  await expect(page.locator('#embedding-jobs-raw')).toHaveAttribute('open','');
  await expect(page.locator('#system-sync-raw')).not.toHaveAttribute('open','');
});

test('pipeline failures wrap within a mobile viewport and failed admission can retry', async ({page}) => {
  await mockPipeline(page);
  await page.setViewportSize({width:390,height:844});
  await page.route('**/api/embedding-jobs/backfill', (route) => route.fulfill({status:503,json:{error:'Admission unavailable'}}));
  await page.goto('/system');
  const button = page.locator('#queue-embedding-backfill');
  await button.click();
  await expect(page.locator('#operation-feedback')).toContainText('Admission unavailable');
  await expect(button).toBeEnabled();
  await expect(button).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
