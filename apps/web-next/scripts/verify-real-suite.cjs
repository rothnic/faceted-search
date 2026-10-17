// Explicitly configured, read-only production acceptance. Does not start or seed services.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
if (!process.env.SEARCHLAB_UX_ORIGIN) throw new Error('Set SEARCHLAB_UX_ORIGIN to the reviewed production candidate connected to the documented126-row dataset.');
const out = process.env.SEARCHLAB_UX_ARTIFACTS || `/tmp/searchlab-real-suite-${Date.now()}`;
fs.mkdirSync(out, { mode: 0o700 });
const results = [];
for (const name of ['verify-ux', 'verify-focused-search', 'verify-mobile-map', 'verify-progressive-search']) {
  const artifacts = path.join(out, name);
  const result = spawnSync(process.execPath, [path.join(__dirname, name + '.cjs')], { stdio: 'inherit', env: { ...process.env, SEARCHLAB_UX_ARTIFACTS: artifacts, SEARCHLAB_FOCUSED_ARTIFACTS: artifacts, SEARCHLAB_PROGRESSIVE_ARTIFACTS: artifacts } });
  results.push({ name, exitCode: result.status, signal: result.signal, error: result.error ? String(result.error) : null });
  fs.writeFileSync(path.join(out, 'suite.json'), JSON.stringify({ origin: process.env.SEARCHLAB_UX_ORIGIN, results, artifacts: out }, null, 2));
  if (result.status !== 0) { process.exitCode = result.status || 1; break; }
}
console.log(JSON.stringify({ out, results }));
