import { setTimeout as delay } from 'node:timers/promises';
import { EMBEDDING_MODEL } from './embeddings.js';
import type { HouseSearchDocument } from '../../../packages/search-transform/src/house-search-document.js';
import { toMeiliDocument } from '../../../packages/search-transform/src/to-meili-document.js';
import { toTypesenseDocument } from '../../../packages/search-transform/src/to-typesense-document.js';

export type ApplianceProvider = 'meilisearch' | 'typesense';
export type ApplianceConfig = {
  readOnly?: boolean;
  meiliHost: string;
  meiliKey: string;
  typesenseHost: string;
  typesenseKey: string;
  providers: ApplianceProvider[];
  // Persist repair intent before a mutation: an accepted request may outlive a lost response or restart.
  onRepair?: (provider: ApplianceProvider) => Promise<void>;
  onReady?: (provider: ApplianceProvider) => Promise<void>;
};

export const MEILI_NATIVE_EMBEDDER = 'miniLMNativeV1';
export const TYPESENSE_NATIVE_MODEL = `minilm_l6_${EMBEDDING_MODEL.dtype}_${EMBEDDING_MODEL.revision.slice(0, 8)}`;
const MEILI_NATIVE_CONFIG = {
  source: 'huggingFace',
  model: 'sentence-transformers/all-MiniLM-L6-v2',
  revision: '1110a243fdf4706b3f48f1d95db1a4f5529b4d41',
  documentTemplate: '{{doc.semanticText}}',
  documentTemplateMaxBytes: 8192
} as const;
const REQUEST_TIMEOUT_MS = 15_000;
type Settings = { searchableAttributes?: string[]; filterableAttributes?: string[]; sortableAttributes?: string[]; embedders?: Record<string, Record<string, unknown>>; pagination?: Record<string, unknown> & { maxTotalHits?: number } };
type Field = { name: string; type: string; optional?: boolean; facet?: boolean; sort?: boolean; index?: boolean; num_dim?: number; vec_dist?: string; embed?: { from?: string[]; model_config?: Record<string, unknown> & { model_name?: string } } };
type Collection = { fields: Field[] };
type MeiliTask = { taskUid?: number; status?: string; error?: { message?: string } };

const SEARCHABLE = ['title', 'description', 'semanticText', 'city', 'neighborhood', 'schoolDistrict', 'amenities', 'tags'];
const FILTERABLE = ['id', 'cityFacet', 'neighborhoodFacet', 'schoolDistrictFacet', 'propertyTypeFacet', 'listingStatusFacet', 'amenities', 'bedrooms', 'bathrooms', 'squareFeet', 'lotSizeAcres', 'yearBuilt', 'price', '_geo'];
const SORTABLE = ['price', 'updatedEpoch', '_geo'];
const TYPESENSE_FIELDS: Field[] = [
  { name: 'id', type: 'string' },
  { name: 'title', type: 'string' },
  { name: 'description', type: 'string' },
  { name: 'semanticText', type: 'string' },
  { name: 'city', type: 'string' },
  { name: 'neighborhood', type: 'string', optional: true },
  { name: 'schoolDistrict', type: 'string', optional: true },
  { name: 'amenities', type: 'string[]', facet: true },
  { name: 'tags', type: 'string[]', optional: true },
  { name: 'cityFacet', type: 'string', facet: true },
  { name: 'neighborhoodFacet', type: 'string', facet: true, optional: true },
  { name: 'schoolDistrictFacet', type: 'string', facet: true, optional: true },
  { name: 'propertyTypeFacet', type: 'string', facet: true },
  { name: 'listingStatusFacet', type: 'string', facet: true },
  { name: 'bedrooms', type: 'int32', facet: true },
  { name: 'bathrooms', type: 'float', facet: true },
  { name: 'squareFeet', type: 'int32', facet: true },
  { name: 'lotSizeAcres', type: 'float', facet: true, optional: true },
  { name: 'yearBuilt', type: 'int32', facet: true, optional: true },
  { name: 'price', type: 'int32', sort: true },
  { name: 'updatedEpoch', type: 'int64', sort: true },
  { name: 'location', type: 'geopoint' },
  { name: 'embedding', type: 'float[]', optional: true, num_dim: EMBEDDING_MODEL.dimensions, embed: { from: ['semanticText'], model_config: { model_name: TYPESENSE_NATIVE_MODEL } } },
  { name: '.*', type: 'auto', optional: true }
];

export class NativeAppliances {
  private readonly providers: ApplianceProvider[];
  private readonly inFlight = new Map<ApplianceProvider, Promise<boolean>>();

  constructor(private readonly config: ApplianceConfig) {
    this.providers = [...new Set(config.providers)];
  }

  nativeMetadata() {
    return {
      dimensions: EMBEDDING_MODEL.dimensions,
      engineOwned: true,
      sourceFields: ['semanticText'],
      meilisearch: { name: MEILI_NATIVE_EMBEDDER, ...MEILI_NATIVE_CONFIG },
      typesense: { model: TYPESENSE_NATIVE_MODEL, revision: EMBEDDING_MODEL.revision, dtype: EMBEDDING_MODEL.dtype, minimumVersion: '28.0' }
    };
  }

  async ensure(provider: ApplianceProvider, signal: AbortSignal): Promise<boolean> {
    signal.throwIfAborted();
    if (!this.providers.includes(provider)) return false;
    let ready = this.inFlight.get(provider);
    if (!ready) {
      // Coalesce only concurrent checks. Indexes and remote embedders can change after any successful check.
      ready = (provider === 'meilisearch' ? this.ensureMeili(signal) : this.ensureTypesense(signal)).then(async (repaired) => {
        if (!this.config.readOnly) await this.config.onReady?.(provider);
        return repaired;
      }).finally(() => {
        if (this.inFlight.get(provider) === ready) this.inFlight.delete(provider);
      });
      this.inFlight.set(provider, ready);
    }
    const repaired = await new Promise<boolean>((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      ready!.then((result) => {
        signal.removeEventListener('abort', abort);
        resolve(result);
      }, (error) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      });
    });
    signal.throwIfAborted();
    return repaired;
  }

  async sync(doc: HouseSearchDocument | undefined, id: string, signal: AbortSignal): Promise<boolean> {
    this.requireWritable();
    if (!this.providers.length) return false;
    signal.throwIfAborted();
    if (!id || (doc && doc.id !== id)) throw new Error('Appliance document ID must match its queued house ID.');
    const errors: unknown[] = [];
    let repaired = false;
    for (const provider of this.providers) {
      try {
        if (!doc) {
          // Deletion is safe even when model configuration needs repair; do not warm a model for it.
          const path = provider === 'meilisearch' ? '/indexes/houses/documents/' : '/collections/houses/documents/';
          const result = await this.request<MeiliTask>(provider, `${path}${encodeURIComponent(id)}`, signal, { method: 'DELETE' }, true);
          if (provider === 'meilisearch' && result) await this.waitForMeiliTask(result, signal);
        } else {
          if (typeof doc.semanticText !== 'string' || !doc.semanticText.trim()) throw new Error('Native appliance embeddings require nonempty semanticText.');
          repaired = await this.ensure(provider, signal) || repaired;
          // Runtime extras must never turn a source-only write into an externally generated vector write.
          const source = { ...doc } as HouseSearchDocument & { _vectors?: unknown; embedding?: unknown; embeddingModel?: unknown };
          delete source._vectors;
          delete source.embedding;
          delete source.embeddingModel;
          if (provider === 'meilisearch') {
            const task = await this.request<MeiliTask>(provider, '/indexes/houses/documents?primaryKey=id', signal, { method: 'POST', body: JSON.stringify([toMeiliDocument(source)]) });
            await this.waitForMeiliTask(task, signal);
          } else {
            await this.request(provider, '/collections/houses/documents?action=upsert', signal, { method: 'POST', body: JSON.stringify(toTypesenseDocument(source)) });
          }
        }
      } catch (error) {
        if (signal.aborted) {
          const failure = error instanceof Error ? error : new Error(String(error));
          if (repaired) Object.assign(failure, { repaired: true });
          throw failure;
        }
        errors.push(error);
      }
    }
    if (errors.length) {
      const failure = errors.length === 1 && errors[0] instanceof Error ? errors[0] : new AggregateError(errors, errors.map((error) => error instanceof Error ? error.message : String(error)).join('; '));
      if (repaired) Object.assign(failure, { repaired: true });
      throw failure;
    }
    return repaired;
  }

  private async ensureMeili(signal: AbortSignal) {
    if (this.config.readOnly) {
      const features = await this.request<{ vectorStore?: boolean }>('meilisearch', '/experimental-features', signal);
      if (features?.vectorStore !== true) throw new Error('Read-only search requires Meilisearch vectorStore already enabled.');
    } else await this.request('meilisearch', '/experimental-features', signal, { method: 'PATCH', body: JSON.stringify({ vectorStore: true }) });
    const index = await this.request<{ primaryKey?: string | null }>('meilisearch', '/indexes/houses', signal, {}, true);
    if (!index) {
      this.requireWritable();
      await this.config.onRepair?.('meilisearch');
      const task = await this.request<MeiliTask>('meilisearch', '/indexes', signal, { method: 'POST', body: JSON.stringify({ uid: 'houses', primaryKey: 'id' }) });
      await this.waitForMeiliTask(task, signal);
    } else if (index.primaryKey && index.primaryKey !== 'id') {
      throw new Error('Meilisearch houses has an incompatible primary key; an explicit migration is required.');
    }
    const settings = await this.request<Settings>('meilisearch', '/indexes/houses/settings', signal);
    if (!settings) throw new Error('Meilisearch did not return index settings.');
    for (const [name, embedder] of Object.entries(settings.embedders ?? {})) {
      if (embedder.source !== 'huggingFace' && embedder.source !== 'userProvided') throw new Error(`Meilisearch embedder ${name} may call a remote embedding API; source-only writes are blocked.`);
    }
    const existing = settings.embedders?.[MEILI_NATIVE_EMBEDDER];
    if (existing && (Object.entries(MEILI_NATIVE_CONFIG).some(([key, value]) => existing[key] !== value) || (existing.dimensions != null && existing.dimensions !== EMBEDDING_MODEL.dimensions) || existing.binaryQuantized === true)) {
      throw new Error(`Meilisearch embedder ${MEILI_NATIVE_EMBEDDER} is incompatible; an explicit migration is required.`);
    }
    const changes: Record<string, unknown> = {};
    const maxTotalHits = settings.pagination?.maxTotalHits;
    if (maxTotalHits !== undefined && (!Number.isSafeInteger(maxTotalHits) || maxTotalHits < 1000)) {
      throw new Error('Meilisearch pagination maxTotalHits must be at least 1000 for complete native results; an explicit configuration change is required.');
    }
    if (maxTotalHits === undefined) changes.pagination = { ...settings.pagination, maxTotalHits: 1000 };
    for (const [key, required] of [['searchableAttributes', SEARCHABLE], ['filterableAttributes', FILTERABLE], ['sortableAttributes', SORTABLE]] as const) {
      const current = settings[key] ?? [];
      // Meili canonicalizes searchable wildcard lists to ['*']; it already covers every source field.
      if (key === 'searchableAttributes' && current.includes('*')) continue;
      const merged = [...new Set([...current, ...required])];
      if (merged.length !== current.length) changes[key] = merged;
    }
    // Meili1.11 merges embedder maps: omitted names remain unchanged, including masked credentials.
    if (!existing) changes.embedders = { [MEILI_NATIVE_EMBEDDER]: MEILI_NATIVE_CONFIG };
    if (Object.keys(changes).length) {
      this.requireWritable();
      await this.config.onRepair?.('meilisearch');
      const task = await this.request<MeiliTask>('meilisearch', '/indexes/houses/settings', signal, { method: 'PATCH', body: JSON.stringify(changes) });
      await this.waitForMeiliTask(task, signal);
    }
    return !index || Object.keys(changes).length > 0;
  }

  private async ensureTypesense(signal: AbortSignal) {
    const debug = await this.request<{ version?: string }>('typesense', '/debug', signal);
    const version = debug?.version?.match(/^(\d+)\.(\d+)(?:\.(\d+))?(?:\+[\w.-]+)?$/);
    if (!version || Number(version[1]) < 28) throw new Error(`Typesense stable 28.0 or newer is required for correct native embedding updates (found ${debug?.version ?? 'unknown'}).`);
    const collection = await this.request<Collection>('typesense', '/collections/houses', signal, {}, true);
    if (!collection) {
      this.requireWritable();
      await this.config.onRepair?.('typesense');
      await this.request('typesense', '/collections', signal, { method: 'POST', body: JSON.stringify({ name: 'houses', fields: TYPESENSE_FIELDS, default_sorting_field: 'price' }) });
      return true;
    }
    for (const field of collection.fields) {
      if (/^(openai|google|gcp)\//.test(field.embed?.model_config?.model_name ?? '')) throw new Error(`Typesense field ${field.name} may call a remote embedding API; source-only writes are blocked.`);
    }
    for (const required of TYPESENSE_FIELDS) {
      if (required.name === '.*' || required.name === 'embedding') continue;
      const existing = collection.fields.find((field) => field.name === required.name);
      if (existing && (existing.type !== required.type || existing.index === false || (required.optional === true && existing.optional !== true) || (required.facet && existing.facet !== true) || (required.sort && existing.sort === false))) {
        throw new Error(`Typesense field ${required.name} has incompatible type, optionality, indexing, facet, or sort capabilities; an explicit migration is required.`);
      }
    }
    const embedding = collection.fields.find((field) => field.name === 'embedding');
    if (embedding && (
      embedding.type !== 'float[]' || embedding.num_dim !== EMBEDDING_MODEL.dimensions || embedding.index === false ||
      (embedding.vec_dist && embedding.vec_dist !== 'cosine') ||
      embedding.embed?.from?.length !== 1 || embedding.embed.from[0] !== 'semanticText' ||
      embedding.embed.model_config?.model_name !== TYPESENSE_NATIVE_MODEL ||
      Object.keys(embedding.embed.model_config ?? {}).some((key) => key !== 'model_name')
    )) {
      throw new Error('Typesense embedding field is incompatible with the pinned native model; an explicit migration is required.');
    }
    // Existing documents need not already contain newly added base fields. Never drop or re-add fields.
    const missing = TYPESENSE_FIELDS.filter((field) => field.name !== 'id' && !collection.fields.some((existing) => existing.name === field.name)).map((field) => ({ ...field, optional: true }));
    if (missing.length) {
      this.requireWritable();
      await this.config.onRepair?.('typesense');
      await this.request('typesense', '/collections/houses', signal, { method: 'PATCH', body: JSON.stringify({ fields: missing }) });
    }
    return missing.length > 0;
  }

  private requireWritable() {
    if (this.config.readOnly) throw new Error('Read-only search requires already provisioned native indexes; repair and document writes are disabled.');
  }

  private async request<T = unknown>(provider: ApplianceProvider, path: string, signal: AbortSignal, init: RequestInit = {}, allowMissing = false): Promise<T | undefined> {
    if ((init.method ?? 'GET').toUpperCase() !== 'GET') this.requireWritable();
    const host = provider === 'meilisearch' ? this.config.meiliHost : this.config.typesenseHost;
    const headers = new Headers(init.headers);
    headers.set('Content-Type', 'application/json');
    if (provider === 'typesense') headers.set('X-TYPESENSE-API-KEY', this.config.typesenseKey);
    else if (this.config.meiliKey) headers.set('Authorization', `Bearer ${this.config.meiliKey}`);
    const response = await fetch(`${host.replace(/\/$/, '')}${path}`, { ...init, headers, signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) });
    if (allowMissing && response.status === 404) return undefined;
    if (!response.ok) throw new Error(`${provider} ${response.status}: ${await response.text()}`);
    return await response.json() as T;
  }

  private async waitForMeiliTask(accepted: MeiliTask | undefined, signal: AbortSignal) {
    const uid = accepted?.taskUid;
    if (typeof uid !== 'number' || !Number.isSafeInteger(uid) || uid < 0) throw new Error('Meilisearch did not return a valid taskUid; indexing is unconfirmed.');
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
    try {
      while (true) {
        const task = await this.request<MeiliTask>('meilisearch', `/tasks/${uid}`, bounded);
        if (task?.status === 'succeeded') return;
        if (task?.status === 'failed' || task?.status === 'canceled') throw new Error(`Meilisearch task ${uid} ${task.status}: ${task.error?.message ?? 'unknown error'}`);
        if (task?.status !== 'enqueued' && task?.status !== 'processing') throw new Error(`Meilisearch task ${uid} returned an unknown status; indexing is unconfirmed.`);
        await delay(250, undefined, { signal: bounded });
      }
    } catch (error) {
      if (bounded.aborted && !signal.aborted) throw new Error(`Timed out waiting for Meilisearch task ${uid}; indexing is unconfirmed.`, { cause: error });
      throw error;
    }
  }
}

export { NativeAppliances as ApplianceVectors };
