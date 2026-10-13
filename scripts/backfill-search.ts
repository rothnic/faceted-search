import { argValue, postApi } from './api-client.js';

const provider = argValue('provider');
if (provider !== 'meilisearch' && provider !== 'typesense') {
  throw new Error('Usage: npm run search:backfill -- --provider meilisearch|typesense');
}

const result = await postApi('/api/sync/backfill', { provider });
console.log(result.status === 'queued' ? `Invalidated ${result.invalidated} documents for automatic ${provider} backfill. Check /api/embedding-jobs for completion.` : `Backfilled ${result.indexed} ${provider} documents at ${result.lastSyncTime}.`);
