import { argValue, postApi } from './api-client.js';

const provider = argValue('provider');
if (provider !== 'meilisearch' && provider !== 'typesense') {
  throw new Error('Usage: npm run search:reset -- --provider meilisearch|typesense');
}

await postApi('/api/sync/backfill', { provider });
console.log('Queued source backfill for ' + provider + '. Check the recorded sync and embedding job status.');
