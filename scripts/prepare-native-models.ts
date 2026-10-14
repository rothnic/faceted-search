import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { EMBEDDING_MODEL } from '../apps/api/src/embeddings.js';
import { TYPESENSE_NATIVE_MODEL } from '../apps/api/src/appliance-vectors.js';

// Public Apache-2.0 model weights only. No account, remote inference, or API key.
const root = resolve(process.env.NATIVE_MODEL_DIR ?? 'data/native-models');
const upstream = 'sentence-transformers/all-MiniLM-L6-v2';
const revision = '1110a243fdf4706b3f48f1d95db1a4f5529b4d41';
async function sha(path: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
async function artifact(repo: string, rev: string, file: string, path: string, digest: string) {
  try { if (await sha(path) === digest) return; } catch { /* first download */ }
  if (process.env.EMBEDDING_OFFLINE === '1') throw new Error(`Missing or invalid native model artifact: ${path}. Prepare it once online.`);
  const url = `https://huggingface.co/${repo}/resolve/${rev}/${file}`;
  console.log(`Downloading ${repo}/${file} at ${rev}`);
  const response = await fetch(url, { signal: AbortSignal.timeout(300_000) });
  if (!response.ok || !response.body) throw new Error(`Model download failed: ${response.status} ${url}`);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    const { createWriteStream } = await import('node:fs');
    await pipeline(Readable.fromWeb(response.body as never), createWriteStream(temporary));
    if (await sha(temporary) !== digest) throw new Error(`Model SHA256 mismatch: ${url}`);
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}
const typesense = join(root, 'typesense', 'models', TYPESENSE_NATIVE_MODEL);
await artifact(EMBEDDING_MODEL.model, EMBEDDING_MODEL.revision, 'onnx/model_quantized.onnx', join(typesense, 'model.onnx'), 'afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1');
await artifact(EMBEDDING_MODEL.model, EMBEDDING_MODEL.revision, 'tokenizer.json', join(typesense, 'tokenizer.json'), 'da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0');
const tokenizer = JSON.parse(await readFile(join(typesense, 'tokenizer.json'), 'utf8'));
const entries = Object.entries(tokenizer.model.vocab as Record<string, number>).sort((a, b) => a[1] - b[1]);
if (entries.some(([token, id], index) => id !== index || token.includes('\n'))) throw new Error('Unexpected pinned BERT vocabulary layout.');
await writeFile(join(typesense, 'vocab.txt'), entries.map(([token]) => token).join('\n') + '\n');
await writeFile(join(typesense, 'config.json'), JSON.stringify({ model_type: 'bert', vocab_file_name: 'vocab.txt' }, null, 2));
const cache = join(root, 'huggingface', 'hub', 'models--sentence-transformers--all-MiniLM-L6-v2');
const snapshot = join(cache, 'snapshots', revision);
for (const [file, digest] of [
  ['config.json', '953f9c0d463486b10a6871cc2fd59f223b2c70184f49815e7efbcab5d8908b41'],
  ['tokenizer.json', 'be50c3628f2bf5bb5e3a7f17b1f74611b2561a3a27eeab05e5aa30f411572037'],
  ['model.safetensors', '53aa51172d142c89d9012cce15ae4d6cc0ca6895895114379cacb4fab128d9db']
]) await artifact(upstream, revision, file, join(snapshot, file), digest);
// Rust hf-hub 0.3 resolves even an immutable revision through this cache ref.
await mkdir(join(cache, 'refs'), { recursive: true });
await writeFile(join(cache, 'refs', revision), revision);
console.log(`Native MiniLM artifacts verified in ${root}. Typesense owns ONNX inference; Meilisearch owns float32 BERT inference.`);
