export function requireRealRuntime(env: NodeJS.ProcessEnv) {
  if (env.DEMO_MEMORY) throw new Error('DEMO_MEMORY was removed. The application requires connected backends.');
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required. No in-memory runtime is available.');
  let url: URL;
  try { url = new URL(env.DATABASE_URL); } catch { throw new Error('DATABASE_URL must be a valid PostgreSQL URL.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('DATABASE_URL must identify PostgreSQL.');
  if (!env.DATASET_ID || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,79}$/.test(env.DATASET_ID)) {
    throw new Error('DATASET_ID must be an explicit public dataset label (1-80 safe characters).');
  }
  return { datasetId: env.DATASET_ID };
}
