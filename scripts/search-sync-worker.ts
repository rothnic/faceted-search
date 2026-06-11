import { postApi } from './api-client.js';

const result = await postApi('/api/sync/worker/run');
console.log(`Processed ${result.processed} pending sync events at ${result.lastSyncTime}.`);
