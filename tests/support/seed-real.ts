import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { RealServices } from '../../apps/api/src/real-services.js';
import { cities, neighborhoods } from '../../packages/test-fixtures/src/cities.fixture.js';
import { houses } from '../../packages/test-fixtures/src/houses.fixture.js';
import { seedSavedSearches } from '../../packages/test-fixtures/src/saved-searches.fixture.js';
export async function seedRealTestDatabase(databaseUrl: string) {
  assert(databaseUrl && /^faceted_(?:native|postgres_search|embedding_queue|ui|runtime)_test(?:_[a-z0-9]+)?$/.test(new URL(databaseUrl).pathname.slice(1)), 'Fixture seeding requires an explicitly named disposable test database.');
  const services = new RealServices({ databaseUrl, meiliHost: '', meiliKey: '', typesenseHost: '', typesenseKey: '', syncProviders: [] });
  const now = new Date().toISOString();
  try {
    await services.seed(cities, neighborhoods, houses, seedSavedSearches.map((search, index) => ({ ...search, id: 'saved-' + (index + 1), createdAt: now, updatedAt: now })));
  } finally { await services.close(); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  assert(process.env.TEST_DISPOSABLE_STACK === '1' && process.env.TEST_DATABASE_URL, 'Set TEST_DISPOSABLE_STACK=1 and TEST_DATABASE_URL for a disposable test database only.');
  await seedRealTestDatabase(process.env.TEST_DATABASE_URL);
}
