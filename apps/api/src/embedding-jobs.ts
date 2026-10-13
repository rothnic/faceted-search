import type pg from 'pg';
import type { HouseSearchDocument } from '../../../packages/search-transform/src/house-search-document.js';
import {
  EMBEDDING_MODEL, EMBEDDING_MODEL_KEY, EMBEDDING_SOURCE_FIELDS,
  EmbeddingUnavailableError, embeddingContentHash, embedTexts, normalizeEmbeddingText
} from './embeddings.js';

export const EMBEDDING_QUEUE_NAME = 'cpu_embeddings';
const POLL_MS = 1000;
const ATTEMPT_MS = 900_000;
const HEARTBEAT_MS = 30_000;
const CPU_LOCK = [2147483646, 1769237];
const ADMISSION_LOCK = [2147483646, 1769238];

export type EmbeddingJobCallbacks = {
  loadDocument(id: string): Promise<HouseSearchDocument | undefined>;
  syncDocument(document: HouseSearchDocument | undefined, id: string,
    vector: number[] | undefined, signal: AbortSignal): Promise<void>;
};
export type EmbeddingJobOptions = {
  workerEnabled?: boolean;
  projectionKey?: string;
  // Allows deterministic queue tests without downloading or loading an ONNX model.
  inferTexts?: typeof embedTexts;
};
type Claim = {
  house_id: string;
  message_id: string;
  read_ct: number;
  source_version: string;
  lease_expires_at: Date;
};
type StoredVector = { house_id: string; model_key: string; content_hash: string; embedding: string };

function vectorLiteral(vector: Float32Array | number[]): string {
  const norm = Math.hypot(...vector);
  if (vector.length !== EMBEDDING_MODEL.dimensions || !Array.from(vector).every(Number.isFinite)
    || Math.abs(norm - 1) > 0.01) {
    throw new EmbeddingUnavailableError('Expected a normalized finite 384-dimensional CPU embedding.');
  }
  return `[${Array.from(vector).join(',')}]`;
}
function parseVector(value: string): Float32Array {
  const vector = Float32Array.from(JSON.parse(value) as number[]);
  vectorLiteral(vector);
  return vector;
}
function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1600);
}
function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener('abort', finish, { once: true });
  });
}

/** Durable PGMQ document work, with local CPU inference outside SQL transactions. */
export class EmbeddingJobs {
  private started = false;
  private enabled = false;
  private stopping = false;
  private lifecycle = new AbortController();
  private dispatcher?: NodeJS.Timeout;
  private dispatching?: Promise<number>;
  private consumer?: Promise<void>;
  private lastDispatchAt?: string;
  private lastError?: string;
  private readonly inferTexts: typeof embedTexts;
  private readonly projectionKey: string;

  // databaseUrl is retained in this constructor contract for callers. PGMQ uses
  // the supplied pool, so there is no second queue service or connection secret.
  constructor(private readonly pool: pg.Pool, _databaseUrl: string,
    private readonly callbacks: EmbeddingJobCallbacks, private readonly options: EmbeddingJobOptions = {}) {
    this.inferTexts = options.inferTexts ?? embedTexts;
    this.projectionKey = options.projectionKey ?? 'postgres-only';
  }

  async start(workerEnabled = this.options.workerEnabled ?? true): Promise<void> {
    if (this.started) return;
    this.stopping = false;
    this.lifecycle = new AbortController();
    await this.seed(false, false, true);
    this.started = true;
    this.enabled = workerEnabled;
    if (!workerEnabled) return;
    await this.dispatch();
    this.dispatcher = setInterval(() => { void this.dispatch().catch((error) => { this.lastError = message(error); }); }, POLL_MS);
    this.dispatcher.unref();
    this.consumer = this.consume();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.enabled = false;
    if (this.dispatcher) clearInterval(this.dispatcher);
    this.dispatcher = undefined;
    this.lifecycle.abort(new Error('Embedding worker is shutting down'));
    // Keep the CPU session lock until any non-cancellable native inference has
    // returned. Aborting its signal prevents late stores and external writes.
    await Promise.allSettled([this.consumer, this.dispatching]);
    this.consumer = undefined;
    this.started = false;
  }

  async dispatch(): Promise<number> {
    if (this.dispatching) return this.dispatching;
    this.dispatching = (async () => {
      const { rows } = await this.pool.query<{ accepted: number }>('SELECT embedding_queue_dispatch(20) AS accepted');
      this.lastDispatchAt = new Date().toISOString();
      return rows[0].accepted;
    })();
    try { return await this.dispatching; } finally { this.dispatching = undefined; }
  }

  async backfill(force = false): Promise<{ accepted: number; invalidated: number }> {
    const result = await this.seed(force, true);
    if (this.started && this.enabled) await this.dispatch();
    return result;
  }

  private async seed(force: boolean, manual: boolean, configure = false): Promise<{ accepted: number; invalidated: number }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1, $2)', ADMISSION_LOCK);
      const config = await client.query<{ projection_key: string }>('SELECT projection_key FROM embedding_pipeline_config WHERE singleton FOR UPDATE');
      const changed = configure && config.rows[0]?.projection_key !== this.projectionKey;
      if (configure) await client.query(`INSERT INTO embedding_pipeline_config(singleton,projection_key) VALUES(true,$1)
        ON CONFLICT(singleton) DO UPDATE SET projection_key=EXCLUDED.projection_key`, [this.projectionKey]);
      else if (config.rows[0]?.projection_key !== this.projectionKey) throw new Error('Embedding projection configuration changed; restart this API with the active configuration.');
      if (changed) await client.query(`UPDATE house_embedding_work SET desired_version=nextval('house_embedding_version'),
        failed_version=NULL,last_error=NULL,updated_at=clock_timestamp()`);
      const inserted = await client.query(`INSERT INTO house_embedding_work(house_id)
        SELECT id FROM houses ON CONFLICT(house_id) DO NOTHING RETURNING house_id`);
      const updated = await client.query(`UPDATE house_embedding_work w
        SET desired_version = nextval('house_embedding_version'), failed_version = NULL,
          last_error = NULL, updated_at = clock_timestamp()
        FROM houses h LEFT JOIN house_embeddings e ON e.house_id = h.id
        WHERE w.house_id = h.id AND (
          $1::boolean
          OR ($2::boolean AND w.failed_version >= w.desired_version)
          OR (h.deleted_at IS NULL AND w.completed_version >= w.desired_version
            AND (e.house_id IS NULL OR e.model_key <> $3 OR e.source_version < w.completed_version))
        ) RETURNING w.house_id`, [force, manual, EMBEDDING_MODEL_KEY]);
      const deleted = manual ? await client.query(`UPDATE house_embedding_work w
        SET desired_version = nextval('house_embedding_version'), failed_version = NULL,
          last_error = NULL, updated_at = clock_timestamp()
        WHERE failed_version >= desired_version AND NOT EXISTS(SELECT 1 FROM houses h WHERE h.id = w.house_id)
        RETURNING house_id`) : { rowCount: 0 };
      await client.query('COMMIT');
      const invalidated = (updated.rowCount ?? 0) + (deleted.rowCount ?? 0);
      return { accepted: (inserted.rowCount ?? 0) + invalidated, invalidated };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  private async consume(): Promise<void> {
    while (!this.stopping) {
      let client: pg.PoolClient | undefined;
      let hasLock = false;
      const connection = new AbortController();
      const disconnect = (error?: Error) => connection.abort(error ?? new Error('Embedding consumer disconnected'));
      try {
        client = await this.pool.connect();
        client.on('error', disconnect);
        client.on('end', disconnect);
        const { rows } = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1, $2) AS locked', CPU_LOCK);
        hasLock = rows[0].locked;
        if (hasLock) {
          const signal = AbortSignal.any([this.lifecycle.signal, connection.signal]);
          while (!signal.aborted && !this.stopping) {
            const config = await client.query<{ matches: boolean }>('SELECT projection_key=$1 AS matches FROM embedding_pipeline_config WHERE singleton', [this.projectionKey]);
            if (!config.rows[0]?.matches) throw new Error('Embedding projection configuration changed; this consumer is paused until restarted with the active configuration.');
            const claimed = await client.query<Claim>('SELECT * FROM embedding_queue_claim_for_projection($1)', [this.projectionKey]);
            if (claimed.rows[0]) await this.processClaim(claimed.rows[0], signal, client);
            else {
              // claim() may have just archived a stale generation. Drain other
              // already-visible messages without adding a one-second delay each.
              const remaining = await client.query<{ ready: boolean }>("SELECT EXISTS(SELECT 1 FROM pgmq.q_cpu_embeddings WHERE vt <= clock_timestamp()) AS ready");
              if (!remaining.rows[0].ready) await wait(POLL_MS, signal);
            }
          }
        }
      } catch (error) {
        this.lastError = message(error);
      } finally {
        if (client) {
          if (hasLock && !connection.signal.aborted) {
            try { await client.query('SELECT pg_advisory_unlock($1, $2)', CPU_LOCK); }
            catch { connection.abort(); }
          }
          client.removeListener('error', disconnect);
          client.removeListener('end', disconnect);
          // Never return a connection with an uncertain session lock to the pool.
          client.release(connection.signal.aborted);
        }
      }
      if (!this.stopping) await wait(POLL_MS, this.lifecycle.signal);
    }
  }

  private async processClaim(claim: Claim, connectionSignal: AbortSignal, consumer: pg.PoolClient): Promise<void> {
    const abort = new AbortController();
    const signal = AbortSignal.any([connectionSignal, abort.signal]);
    const args = [claim.house_id, claim.message_id, claim.read_ct, claim.source_version];
    const deadline = setTimeout(() => abort.abort(new Error('Embedding attempt exceeded 900 seconds')), ATTEMPT_MS);
    let heartbeating: Promise<void> | undefined;
    const heartbeat = setInterval(() => {
      if (heartbeating || signal.aborted) return;
      heartbeating = this.pool.query<{ owned: boolean }>('SELECT embedding_queue_keepalive_for_projection($1,$2,$3,$4,$5) AS owned', [...args, this.projectionKey])
        .then(({ rows }) => { if (!rows[0].owned) abort.abort(new Error('Embedding source changed or queue lease expired')); })
        .catch((error) => { abort.abort(error); this.lastError = message(error); })
        .finally(() => { heartbeating = undefined; });
    }, HEARTBEAT_MS);
    try {
      signal.throwIfAborted();
      const document = await this.callbacks.loadDocument(claim.house_id);
      signal.throwIfAborted();
      const { rows } = await this.pool.query<{ owned: boolean }>(
        'SELECT embedding_queue_owned_for_projection($1,$2,$3,$4,$5) AS owned', [...args, this.projectionKey]);
      if (!rows[0].owned) {
        await this.finish(claim, false, 'Source changed before inference');
        return;
      }
      let vector: Float32Array | undefined;
      if (document) {
        const hash = embeddingContentHash(document.semanticText);
        const cached = await this.pool.query<StoredVector>(`SELECT house_id, model_key, content_hash,
          embedding::text AS embedding FROM house_embeddings WHERE house_id = $1`, [claim.house_id]);
        const previous = cached.rows[0];
        vector = previous?.model_key === EMBEDDING_MODEL_KEY && previous.content_hash === hash
          ? parseVector(previous.embedding)
          : (await this.inferTexts([normalizeEmbeddingText(document.semanticText)]))[0];
        signal.throwIfAborted();
        // Verify the reserved session is still alive before using another pooled
        // connection to store; its advisory lock is our global CPU owner.
        await consumer.query('SELECT 1');
        signal.throwIfAborted();
        const stored = await this.pool.query<{ stored: boolean }>(
          'SELECT embedding_queue_store_for_projection($1,$2,$3,$4,$5,$6,$7::vector,$8::jsonb,$9) AS stored',
          [...args, EMBEDDING_MODEL_KEY, hash, vectorLiteral(vector), JSON.stringify(EMBEDDING_MODEL), this.projectionKey]);
        if (!stored.rows[0].stored) {
          await this.finish(claim, false, 'Source changed while computing embedding');
          return;
        }
      }
      signal.throwIfAborted();
      await consumer.query('SELECT 1');
      const current = await this.pool.query<{ owned: boolean }>(
        'SELECT embedding_queue_owned_for_projection($1,$2,$3,$4,$5) AS owned', [...args, this.projectionKey]);
      signal.throwIfAborted();
      if (!current.rows[0].owned) {
        await this.finish(claim, false, 'Source changed before search-engine synchronization');
        return;
      }
      // Engines generate their own native embeddings. The callback owns source
      // synchronization policy; PG persistence already succeeded independently.
      await this.callbacks.syncDocument(document, claim.house_id, vector ? Array.from(vector) : undefined, signal);
      signal.throwIfAborted();
      await consumer.query('SELECT 1');
      signal.throwIfAborted();
      if (!await this.finish(claim, true)) throw new Error('Embedding acknowledgement lost its lease');
    } catch (error) {
      this.lastError = message(error);
      // SQL refuses a stale/expired attempt and preserves newer pending work.
      await this.finish(claim, false, message(error)).catch((failure) => { this.lastError = message(failure); });
    } finally {
      clearTimeout(deadline);
      clearInterval(heartbeat);
      await heartbeating;
    }
  }

  private async finish(claim: Claim, success: boolean, error?: string): Promise<boolean> {
    const { rows } = await this.pool.query<{ finished: boolean }>(
      'SELECT embedding_queue_finish_for_projection($1,$2,$3,$4,$5,$6,$7) AS finished',
      [claim.house_id, claim.message_id, claim.read_ct, claim.source_version, success, error ?? null, this.projectionKey]);
    return rows[0].finished;
  }

  async vectorsFor(documents: { id: string; semanticText: string }[]): Promise<Float32Array[]> {
    if (!documents.length) return [];
    const { rows } = await this.pool.query<StoredVector>(`SELECT house_id, model_key, content_hash,
      embedding::text AS embedding FROM house_embeddings WHERE house_id = ANY($1::text[])`, [documents.map((doc) => doc.id)]);
    const byId = new Map(rows.map((row) => [row.house_id, row]));
    return documents.map((document) => {
      const row = byId.get(document.id);
      if (!row || row.model_key !== EMBEDDING_MODEL_KEY || row.content_hash !== embeddingContentHash(document.semanticText)) {
        throw new EmbeddingUnavailableError('Document embeddings are pending or outdated. Wait for the CPU queue or use keyword mode.');
      }
      return parseVector(row.embedding);
    });
  }

  async similaritiesFor(documents: { id: string; semanticText: string }[], queryVector: Float32Array): Promise<Map<string, number>> {
    if (!documents.length) return new Map();
    const { rows } = await this.pool.query<{ id: string; current: boolean | null; similarity: number | null }>(`
      SELECT wanted.id, (e.model_key = $3 AND e.content_hash = wanted.hash) AS current,
        CASE WHEN e.model_key = $3 AND e.content_hash = wanted.hash
          THEN 1 - (e.embedding <=> $4::vector) ELSE NULL END AS similarity
      FROM unnest($1::text[], $2::text[]) AS wanted(id, hash)
      LEFT JOIN house_embeddings e ON e.house_id = wanted.id`,
    [documents.map((doc) => doc.id), documents.map((doc) => embeddingContentHash(doc.semanticText)),
      EMBEDDING_MODEL_KEY, vectorLiteral(queryVector)]);
    if (rows.length !== documents.length || rows.some((row) => !row.current || row.similarity === null || !Number.isFinite(row.similarity))) {
      throw new EmbeddingUnavailableError('Document embeddings are pending or outdated. Wait for the CPU queue or use keyword mode.');
    }
    return new Map(rows.map((row) => [row.id, Math.max(-1, Math.min(1, row.similarity!))]));
  }

  async beginProjectionRepair(provider: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1,$2)', ADMISSION_LOCK);
      const owned = await client.query<{ owned: boolean }>('SELECT embedding_projection_owned($1) AS owned', [this.projectionKey]);
      if (!owned.rows[0].owned) throw new Error('Embedding projection configuration changed; repair is fenced.');
      const repair = await client.query(`INSERT INTO embedding_projection_repairs(projection_key,provider,pending)
        VALUES($1,$2,true) ON CONFLICT(projection_key,provider) DO UPDATE SET pending=true,updated_at=now()
        WHERE NOT embedding_projection_repairs.pending RETURNING provider`, [this.projectionKey, provider]);
      // Record invalidation before any external repair request. A lost response or
      // process restart cannot lose the intent, and repeated failures cannot
      // reset every document's retry budget on each repair attempt.
      if (repair.rowCount) await client.query(`UPDATE house_embedding_work SET desired_version=nextval('house_embedding_version'),
        failed_version=NULL,last_error=NULL,updated_at=clock_timestamp()`);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async confirmProjectionReady(provider: string): Promise<void> {
    await this.pool.query(`UPDATE embedding_projection_repairs SET pending=false,updated_at=now()
      WHERE projection_key=$1 AND provider=$2 AND pending AND embedding_projection_owned($1)`, [this.projectionKey, provider]);
  }

  async assertProjectionCurrent() {
    const { rows } = await this.pool.query<{ matches: boolean }>('SELECT projection_key=$1 AS matches FROM embedding_pipeline_config WHERE singleton', [this.projectionKey]);
    if (!rows[0]?.matches) throw new EmbeddingUnavailableError('Embedding projection configuration changed; restart this API with the active configuration.');
  }

  async status() {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const configuration = await client.query<{ matches: boolean }>('SELECT projection_key=$1 AS matches FROM embedding_pipeline_config WHERE singleton', [this.projectionKey]);
      const queue = await client.query<{ observed_at: Date; created: number; active: number; retry: number; failed: number; completed: number }>(`
        WITH observed AS (
          SELECT q.read_ct, (w.attempt_state = 'active' AND w.attempt_read_ct = q.read_ct
            AND q.vt > now() AND w.lease_expires_at > now()
            AND w.last_attempt_at > now() - interval '900 seconds') AS leased
          FROM pgmq.q_cpu_embeddings q LEFT JOIN house_embedding_work w ON w.job_id = q.msg_id
        ) SELECT now() AS observed_at,
          (SELECT count(*)::integer FROM observed WHERE read_ct = 0) AS created,
          (SELECT count(*)::integer FROM observed WHERE leased) AS active,
          (SELECT count(*)::integer FROM observed WHERE read_ct > 0 AND NOT COALESCE(leased, false)) AS retry,
          (SELECT count(*)::integer FROM pgmq.a_cpu_embeddings WHERE headers->>'embeddingResult' = 'failed') AS failed,
          (SELECT count(*)::integer FROM pgmq.a_cpu_embeddings WHERE headers->>'embeddingResult' = 'completed') AS completed`);
      const documents = await client.query<{ total: number; current: number; pending: number; failed: number; deleted_pending: number; projection_pending: number }>(`
        SELECT count(*)::integer AS total,
          count(*) FILTER(WHERE e.model_key = $1 AND e.source_version >= w.desired_version)::integer AS current,
          count(*) FILTER(WHERE w.house_id IS NULL OR e.house_id IS NULL
            OR e.model_key <> $1 OR e.source_version < w.desired_version)::integer AS pending,
          count(*) FILTER(WHERE w.failed_version >= w.desired_version
            AND (e.house_id IS NULL OR e.model_key <> $1 OR e.source_version < w.desired_version))::integer AS failed,
          count(*) FILTER(WHERE w.completed_version < w.desired_version)::integer AS projection_pending,
          (SELECT count(*)::integer FROM house_embedding_work dw WHERE dw.desired_version > dw.completed_version
            AND NOT EXISTS(SELECT 1 FROM houses dh WHERE dh.id = dw.house_id AND dh.deleted_at IS NULL)) AS deleted_pending
        FROM houses h LEFT JOIN house_embedding_work w ON w.house_id = h.id
        LEFT JOIN house_embeddings e ON e.house_id = h.id WHERE h.deleted_at IS NULL`, [EMBEDDING_MODEL_KEY]);
      const failures = await client.query<{ house_id: string; error: string; attempts: number; retry_at: Date | null }>(`
        SELECT w.house_id, w.last_error AS error, COALESCE(w.attempt_read_ct, 0) AS attempts,
          CASE WHEN w.attempt_state = 'retry' THEN q.vt END AS retry_at
        FROM house_embedding_work w LEFT JOIN pgmq.q_cpu_embeddings q ON q.msg_id = w.job_id
        WHERE w.last_error IS NOT NULL ORDER BY w.updated_at DESC, w.house_id LIMIT 10`);
      await client.query('COMMIT');
      const q = queue.rows[0];
      const d = documents.rows[0];
      return {
        storageMode: 'postgres' as const, durable: true, enabled: this.enabled && configuration.rows[0]?.matches === true, projectionKey: this.projectionKey,
        observedAt: q.observed_at.toISOString(), model: { ...EMBEDDING_MODEL, key: EMBEDDING_MODEL_KEY },
        queue: { name: EMBEDDING_QUEUE_NAME, backend: 'pgmq' as const, maxActive: 1, maxQueued: 100,
          concurrencyNote: 'One live lock-owning consumer. A lost PostgreSQL session can briefly leave abandoned native inference running alongside its replacement; stale results are fenced.',
          created: q.created, active: q.active, retry: q.retry, failed: q.failed, completed: q.completed },
        documents: { total: d.total, current: d.current, pending: d.pending, failed: d.failed,
          deletedPending: d.deleted_pending, projectionPending: d.projection_pending },
        lastDispatchAt: this.lastDispatchAt, lastError: configuration.rows[0]?.matches ? this.lastError : 'Projection configuration changed; restart this API with the active configuration.',
        recentFailures: failures.rows.map((row) => ({ houseId: row.house_id, error: row.error,
          attempts: row.attempts, ...(row.retry_at ? { retryAt: row.retry_at.toISOString() } : {}) })),
        sourceFields: EMBEDDING_SOURCE_FIELDS
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }
}
