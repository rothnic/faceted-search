import { postApi } from './api-client.js';

const result = await postApi('/api/sync/worker/run');
console.log(result.automatic ? `Admitted ${result.admitted} durable jobs. The automatic worker continues in the API process.` : `Processed ${result.processed} pending sync events at ${result.lastSyncTime}.`);
