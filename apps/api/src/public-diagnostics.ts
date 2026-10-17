/** Public status retains counts/state, never raw persisted upstream error bodies. */
export function publicDiagnostics(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(publicDiagnostics);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    /error/i.test(key) && item !== null && item !== undefined && (typeof item === 'string' || typeof item === 'object')
      ? 'Backend operation failed. Check server logs.'
      : publicDiagnostics(item)
  ]));
}
