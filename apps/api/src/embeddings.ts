import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import type { FeatureExtractionPipeline } from '@huggingface/transformers';

// Apache-2.0 ONNX export of sentence-transformers/all-MiniLM-L6-v2.
export const EMBEDDING_MODEL = {
  model: 'Xenova/all-MiniLM-L6-v2',
  revision: '751bff37182d3f1213fa05d7196b954e230abad9',
  dimensions: 384,
  dtype: 'q8',
  device: 'cpu',
  maxTokens: 256
} as const;
export const MIN_SEMANTIC_SIMILARITY = 0.35;
export const EMBEDDING_SOURCE_FIELDS = ['title', 'description', 'city', 'neighborhood', 'schoolDistrict', 'propertyType', 'amenities', 'tags'];
// Include preprocessing/pooling as well as weights: never mix incompatible vectors.
export const EMBEDDING_MODEL_KEY = createHash('sha256').update(JSON.stringify({ ...EMBEDDING_MODEL, pooling: 'mean', normalize: true, textFormat: 2 })).digest('hex');
export const normalizeEmbeddingText = (text: string) => text.trim().toLowerCase().replaceAll('_', ' ').slice(0, 8192);
export const embeddingContentHash = (text: string) => createHash('sha256').update(normalizeEmbeddingText(text)).digest('hex');

const cacheDir = resolve(process.env.EMBEDDING_CACHE_DIR ?? fileURLToPath(new URL('../../../data/models', import.meta.url)));
const offline = process.env.EMBEDDING_OFFLINE === '1';
const MAX_CACHED_TEXTS = 1024;
const BATCH_SIZE = 16;
type CacheEntry = { promise: Promise<Float32Array>; ready: boolean };
const vectors = new Map<string, CacheEntry>();
let modelPromise: Promise<FeatureExtractionPipeline> | undefined;
let inferenceTail: Promise<unknown> = Promise.resolve();
let queuedBatches = 0;
const status = {
  state: 'idle' as 'idle' | 'loading' | 'ready' | 'error',
  error: undefined as string | undefined,
  progress: undefined as { file: string; loaded?: number; total?: number } | undefined,
  loadTimeMs: undefined as number | undefined,
  activeBatches: 0,
  computedTexts: 0,
  cacheHits: 0
};

export class EmbeddingUnavailableError extends Error {}

export function embeddingStatus() {
  return {
    ...EMBEDDING_MODEL,
    ...status,
    queuedBatches,
    offline,
    cachedTexts: [...vectors.values()].filter((entry) => entry.ready).length,
    maxCachedTexts: MAX_CACHED_TEXTS,
    minimumSimilarity: MIN_SEMANTIC_SIMILARITY
  };
}

async function loadModel(): Promise<FeatureExtractionPipeline> {
  if (!modelPromise) {
    status.state = 'loading';
    status.error = undefined;
    const started = performance.now();
    modelPromise = (async () => {
      // Keep keyword/blank searches usable even without the native runtime or model.
      const { pipeline, env } = await import('@huggingface/transformers');
      env.allowLocalModels = offline;
      env.allowRemoteModels = !offline;
      const modelPath = offline ? join(cacheDir, EMBEDDING_MODEL.model, EMBEDDING_MODEL.revision) : EMBEDDING_MODEL.model;
      const model = await pipeline('feature-extraction', modelPath, {
        revision: EMBEDDING_MODEL.revision,
        dtype: EMBEDDING_MODEL.dtype,
        device: EMBEDDING_MODEL.device,
        cache_dir: cacheDir,
        local_files_only: offline,
        session_options: { intraOpNumThreads: 1, interOpNumThreads: 1 },
        progress_callback: (event) => {
          if ('file' in event) {
            status.progress = {
              file: event.file,
              ...('loaded' in event ? { loaded: event.loaded, total: event.total } : {})
            };
          }
        }
      });
      model.tokenizer.model_max_length = EMBEDDING_MODEL.maxTokens;
      status.state = 'ready';
      status.progress = undefined;
      status.loadTimeMs = Math.round(performance.now() - started);
      return model;
    })().catch((error) => {
      modelPromise = undefined; // A later request can retry a failed download.
      throw unavailable(error);
    });
  }
  return modelPromise;
}

function unavailable(error: unknown) {
  status.state = 'error';
  status.progress = undefined;
  status.error = `Local CPU embeddings unavailable. Check the model download/cache, then retry or use keyword mode. ${error instanceof Error ? error.message : String(error)}`;
  return new EmbeddingUnavailableError(status.error);
}

async function runBatch(texts: string[]): Promise<Float32Array[]> {
  status.activeBatches += 1;
  try {
    const model = await loadModel();
    const output = await model(texts, {
      pooling: 'mean', normalize: true
    });
    const result = (output.tolist() as number[][]).map((values) => {
      const norm = Math.hypot(...values);
      if (values.length !== EMBEDDING_MODEL.dimensions || !values.every(Number.isFinite) || Math.abs(norm - 1) > 0.01) {
        throw new Error('Embedding model returned an invalid normalized 384-dimensional vector.');
      }
      return Float32Array.from(values);
    });
    if (result.length !== texts.length) throw new Error('Embedding batch length mismatch.');
    status.computedTexts += result.length;
    status.state = 'ready';
    status.error = undefined;
    return result;
  } catch (error) {
    throw error instanceof EmbeddingUnavailableError ? error : unavailable(error);
  } finally {
    status.activeBatches -= 1;
  }
}

function inferBatch(texts: string[]): Promise<Float32Array[]> {
  // Share one CPU lane between foreground queries and background document work.
  if (queuedBatches >= 64) return Promise.reject(new EmbeddingUnavailableError('Local embedding CPU queue is busy. Retry shortly.'));
  queuedBatches += 1;
  const result = inferenceTail.then(() => runBatch(texts)).finally(() => { queuedBatches -= 1; });
  inferenceTail = result.catch(() => undefined);
  return result;
}

export async function embedTexts(texts: string[]): Promise<Float32Array[]> {
  const normalized = texts.map(normalizeEmbeddingText);
  const keyFor = (text: string) => `${EMBEDDING_MODEL_KEY}:${text}`;
  const missing = [...new Set(normalized)].filter((text) => !vectors.has(keyFor(text)));
  status.cacheHits += normalized.length - missing.length;
  let previous: Promise<unknown> = Promise.resolve();
  for (let offset = 0; offset < missing.length; offset += BATCH_SIZE) {
    const batch = missing.slice(offset, offset + BATCH_SIZE);
    const inference = previous.then(() => inferBatch(batch));
    previous = inference;
    batch.forEach((text, index) => {
      const key = keyFor(text);
      const entry: CacheEntry = { ready: false, promise: inference.then((result) => result[index]) };
      entry.promise = entry.promise.then((vector) => {
        entry.ready = true;
        return vector;
      }).catch((error) => {
        if (vectors.get(key) === entry) vectors.delete(key);
        throw error;
      });
      vectors.set(key, entry);
    });
  }
  const pending = normalized.map((text) => {
    const key = keyFor(text);
    const entry = vectors.get(key)!;
    vectors.delete(key);
    vectors.set(key, entry);
    return entry.promise;
  });
  // Bound the model-vector cache; connected search and ranking run in the selected database/engine.
  while (vectors.size > MAX_CACHED_TEXTS) vectors.delete(vectors.keys().next().value!);
  return Promise.all(pending);
}

export function cosineSimilarity(left: Float32Array, right: Float32Array): number {
  if (left.length !== EMBEDDING_MODEL.dimensions || right.length !== left.length) throw new Error('Embedding dimension mismatch.');
  return Math.max(-1, Math.min(1, left.reduce((sum, value, index) => sum + value * right[index], 0)));
}
