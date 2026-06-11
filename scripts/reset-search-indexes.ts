import { argValue, postApi } from './api-client.js';

const provider = argValue('provider');
if (provider !== 'meilisearch' && provider !== 'typesense') {
  throw new Error('Usage: npm run search:reset -- --provider meilisearch|typesense');
}

await postApi('/api/seed');
console.log(`Reset ${provider} demo index state. Run search:backfill to rebuild it.`);
