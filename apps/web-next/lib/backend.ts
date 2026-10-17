export function validateBackendResponse(body: unknown, selected: string, datasetId: string, fingerprint?: string, mode = 'keyword', query = ''): boolean {
  if (!body || typeof body !== 'object') return false;
  const response = body as Record<string, any>;
  const p = response.provenance, d = p?.dataset, t = p?.timing;
  const effectiveMode = query.trim() ? mode : 'keyword';
  const expectedExecution = selected === 'postgres_native' || selected === 'pg_search'
    ? effectiveMode === 'keyword' ? selected === 'pg_search' ? 'postgres-bm25' : 'postgres-fts'
      : effectiveMode === 'semantic' ? 'postgres-vector' : 'postgres-hybrid'
    : 'external-' + effectiveMode;
  return response.provider === selected && p?.selectedProvider === selected && p?.respondingProvider === selected &&
    p?.storage === 'postgres' && p.execution === expectedExecution &&
    d?.id === datasetId && /^[a-f0-9]{24}$/.test(d?.databaseFingerprint ?? '') &&
    (!fingerprint || d.databaseFingerprint === fingerprint) && /^[a-f0-9]{32}$/.test(d?.revision ?? '') &&
    Number.isInteger(d?.count) && d.count >= 0 && d.countSource === 'postgres-active-houses' &&
    Number.isFinite(Date.parse(d?.observedAt)) && Number.isFinite(Date.parse(p?.observedAt)) &&
    t?.source === 'api-monotonic-clock' && Number.isFinite(t.apiMs) && t.apiMs >= 0 &&
    Number.isFinite(t.searchMs) && t.searchMs >= 0 && Array.isArray(response.hits) && Array.isArray(response.mapHits) &&
    Number.isInteger(response.totalHits) && response.totalHits >= 0;
}
