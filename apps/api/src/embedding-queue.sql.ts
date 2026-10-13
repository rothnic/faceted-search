// PGMQ owns message delivery/visibility; these functions provide the bounded,
// source-version-aware policy for this one embedding queue, not a general scheduler.
export const EMBEDDING_QUEUE_SQL = `
CREATE EXTENSION IF NOT EXISTS pgmq;
CREATE EXTENSION IF NOT EXISTS vector;
SELECT pgmq.create('cpu_embeddings');
CREATE TABLE IF NOT EXISTS embedding_pipeline_config(
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  projection_key text NOT NULL
);

CREATE TABLE IF NOT EXISTS embedding_projection_repairs(
  projection_key text NOT NULL,
  provider text NOT NULL,
  pending boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(projection_key, provider)
);

ALTER TABLE house_embedding_work ADD COLUMN IF NOT EXISTS attempt_read_ct integer;
ALTER TABLE house_embedding_work ADD COLUMN IF NOT EXISTS attempt_state text;
ALTER TABLE house_embedding_work ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;
ALTER TABLE house_embedding_work ADD COLUMN IF NOT EXISTS last_heartbeat_at timestamptz;

-- Always lock the message before the work row: read() uses that same order.
-- The house lock prevents a concurrent hard delete between checking and storing.
CREATE OR REPLACE FUNCTION embedding_queue_owned(
  p_house_id text, p_message_id bigint, p_read_ct integer, p_version bigint DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE q record; w record;
BEGIN
  SELECT * INTO q FROM pgmq.q_cpu_embeddings WHERE msg_id = p_message_id FOR UPDATE;
  IF NOT FOUND OR q.read_ct <> p_read_ct OR q.vt <= clock_timestamp() THEN RETURN false; END IF;
  PERFORM id FROM houses WHERE id = p_house_id FOR KEY SHARE;
  SELECT * INTO w FROM house_embedding_work WHERE house_id = p_house_id FOR UPDATE;
  RETURN COALESCE(FOUND AND w.job_id = p_message_id AND w.attempt_read_ct = p_read_ct
    AND w.attempt_state = 'active'
    AND w.last_attempt_at > clock_timestamp() - interval '900 seconds'
    AND (p_version IS NULL OR w.desired_version = p_version), false);
END $$;

CREATE OR REPLACE FUNCTION embedding_queue_dispatch(p_limit integer DEFAULT 20)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE work_item record; v_id bigint; admitted integer := 0; capacity integer;
BEGIN
  -- Serialize admission across API processes, including bootstrap/backfill.
  PERFORM pg_advisory_xact_lock(2147483646, 1769238);
  UPDATE house_embedding_work w SET
    failed_version = COALESCE(w.dispatched_version, w.attempted_version, w.desired_version),
    last_error = COALESCE(w.last_error, 'Embedding queue message disappeared before acknowledgement'),
    job_id = NULL, dispatched_version = NULL, attempt_state = 'failed',
    lease_expires_at = NULL, updated_at = clock_timestamp()
  WHERE w.job_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pgmq.q_cpu_embeddings q WHERE q.msg_id = w.job_id
  );
  SELECT greatest(0, 100 - count(*))::integer INTO capacity FROM pgmq.q_cpu_embeddings;
  FOR work_item IN SELECT * FROM house_embedding_work
    WHERE job_id IS NULL AND desired_version > completed_version
      AND (failed_version IS NULL OR desired_version > failed_version)
    ORDER BY updated_at, house_id LIMIT least(greatest(p_limit, 0), 20, capacity)
    FOR UPDATE
  LOOP
    SELECT pgmq.send('cpu_embeddings', jsonb_build_object(
      'houseId', work_item.house_id, 'version', work_item.desired_version::text
    )) INTO v_id;
    UPDATE house_embedding_work SET job_id = v_id, dispatched_version = work_item.desired_version,
      attempt_read_ct = NULL, attempt_state = 'queued', lease_expires_at = NULL,
      failed_version = NULL, last_error = NULL, updated_at = clock_timestamp()
    WHERE house_id = work_item.house_id;
    admitted := admitted + 1;
  END LOOP;
  -- Keep seven days of observed results; cleanup is bounded too.
  DELETE FROM pgmq.a_cpu_embeddings WHERE msg_id IN (
    SELECT msg_id FROM pgmq.a_cpu_embeddings
    WHERE archived_at < clock_timestamp() - interval '7 days' ORDER BY archived_at LIMIT 100
  );
  RETURN admitted;
END $$;

-- Call only on the dedicated connection holding session advisory lock
-- (2147483646,1769237). No transaction is held during model inference.
CREATE OR REPLACE FUNCTION embedding_queue_claim()
RETURNS TABLE(house_id text, message_id bigint, read_ct integer,
  source_version bigint, lease_expires_at timestamptz)
LANGUAGE plpgsql AS $$
DECLARE q record; w record; result_kind text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory'
    AND pid = pg_backend_pid() AND classid = 2147483646 AND objid = 1769237 AND granted)
  THEN RAISE EXCEPTION 'Embedding consumer must hold its session advisory lock'; END IF;
  SELECT * INTO q FROM pgmq.read('cpu_embeddings', 90, 1);
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO w FROM house_embedding_work
    WHERE house_embedding_work.house_id = q.message->>'houseId' FOR UPDATE;
  IF NOT FOUND OR w.job_id IS DISTINCT FROM q.msg_id THEN
    PERFORM pgmq.archive('cpu_embeddings', q.msg_id);
    RETURN;
  END IF;
  IF w.desired_version IS DISTINCT FROM w.dispatched_version OR q.read_ct > 4 THEN
    result_kind := CASE WHEN w.desired_version IS DISTINCT FROM w.dispatched_version THEN 'stale' ELSE 'failed' END;
    UPDATE pgmq.q_cpu_embeddings SET headers = COALESCE(headers, '{}'::jsonb)
      || jsonb_build_object('embeddingResult', result_kind) WHERE msg_id = q.msg_id;
    PERFORM pgmq.archive('cpu_embeddings', q.msg_id);
    UPDATE house_embedding_work SET job_id = NULL, dispatched_version = NULL,
      lease_expires_at = NULL, attempt_state = result_kind,
      failed_version = CASE WHEN result_kind = 'failed' THEN w.desired_version ELSE failed_version END,
      last_error = CASE WHEN result_kind = 'failed' THEN
        COALESCE(last_error, 'Maximum embedding attempts exceeded after lease expiry') ELSE last_error END,
      updated_at = clock_timestamp()
    WHERE house_embedding_work.house_id = w.house_id;
    RETURN;
  END IF;
  UPDATE house_embedding_work SET attempted_version = w.desired_version,
    attempt_read_ct = q.read_ct, attempt_state = 'active', lease_expires_at = q.vt,
    last_attempt_at = clock_timestamp(), last_heartbeat_at = clock_timestamp(),
    updated_at = clock_timestamp()
  WHERE house_embedding_work.house_id = w.house_id;
  RETURN QUERY SELECT w.house_id, q.msg_id, q.read_ct, w.desired_version, q.vt;
END $$;

CREATE OR REPLACE FUNCTION embedding_queue_keepalive(
  p_house_id text, p_message_id bigint, p_read_ct integer, p_version bigint
) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE q record;
BEGIN
  IF NOT embedding_queue_owned(p_house_id, p_message_id, p_read_ct, p_version) THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM house_embedding_work WHERE house_id = p_house_id
    AND last_attempt_at <= clock_timestamp() - interval '900 seconds') THEN RETURN false; END IF;
  SELECT * INTO q FROM pgmq.set_vt('cpu_embeddings', p_message_id, 90);
  UPDATE house_embedding_work SET lease_expires_at = q.vt, last_heartbeat_at = clock_timestamp()
    WHERE house_id = p_house_id;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION embedding_queue_store(
  p_house_id text, p_message_id bigint, p_read_ct integer, p_version bigint,
  p_model_key text, p_hash text, p_embedding vector, p_model jsonb
) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  IF NOT embedding_queue_owned(p_house_id, p_message_id, p_read_ct, p_version) THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM houses WHERE id = p_house_id AND deleted_at IS NULL) THEN RETURN false; END IF;
  IF vector_dims(p_embedding) <> 384 THEN RAISE EXCEPTION 'Embedding dimension mismatch'; END IF;
  INSERT INTO house_embeddings(house_id, model_key, content_hash, embedding, model, source_version)
    VALUES(p_house_id, p_model_key, p_hash, p_embedding, p_model, p_version)
  ON CONFLICT(house_id) DO UPDATE SET model_key = EXCLUDED.model_key,
    content_hash = EXCLUDED.content_hash, embedding = EXCLUDED.embedding,
    model = EXCLUDED.model, source_version = EXCLUDED.source_version, updated_at = clock_timestamp();
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION embedding_queue_finish(
  p_house_id text, p_message_id bigint, p_read_ct integer, p_version bigint,
  p_success boolean, p_error text DEFAULT NULL
) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE w record; q record; result_kind text; delay_seconds integer;
BEGIN
  -- An outdated source version may acknowledge only its own old message, never
  -- the newer desired version. An expired/reclaimed attempt may do neither.
  IF NOT embedding_queue_owned(p_house_id, p_message_id, p_read_ct) THEN RETURN false; END IF;
  SELECT * INTO w FROM house_embedding_work WHERE house_id = p_house_id;
  result_kind := CASE WHEN w.desired_version <> p_version THEN 'stale'
    WHEN p_success THEN 'completed' WHEN p_read_ct >= 4 THEN 'failed' ELSE 'retry' END;
  IF result_kind = 'retry' THEN
    delay_seconds := least(60, 5 * power(2, greatest(0, p_read_ct - 1)))::integer;
    SELECT * INTO q FROM pgmq.set_vt('cpu_embeddings', p_message_id, delay_seconds);
    UPDATE house_embedding_work SET attempt_state = 'retry', lease_expires_at = q.vt,
      last_error = left(COALESCE(p_error, 'Embedding attempt failed'), 1600), updated_at = clock_timestamp()
    WHERE house_id = p_house_id;
  ELSE
    UPDATE pgmq.q_cpu_embeddings SET headers = COALESCE(headers, '{}'::jsonb)
      || jsonb_build_object('embeddingResult', result_kind) WHERE msg_id = p_message_id;
    PERFORM pgmq.archive('cpu_embeddings', p_message_id);
    UPDATE house_embedding_work SET job_id = NULL, dispatched_version = NULL,
      lease_expires_at = NULL, attempt_state = result_kind,
      completed_version = CASE WHEN result_kind = 'completed' THEN p_version ELSE completed_version END,
      failed_version = CASE WHEN result_kind = 'failed' THEN p_version
        WHEN result_kind = 'completed' THEN NULL ELSE failed_version END,
      last_error = CASE WHEN result_kind = 'completed' THEN NULL
        WHEN result_kind = 'failed' THEN left(COALESCE(p_error, 'Embedding attempt failed'), 1600)
        ELSE last_error END,
      last_success_at = CASE WHEN result_kind = 'completed' THEN clock_timestamp() ELSE last_success_at END,
      updated_at = clock_timestamp()
    WHERE house_id = p_house_id;
  END IF;
  RETURN true;
END $$;

-- Projection identity is held with a row lock for each short SQL mutation.
-- Reconfiguring providers/hosts/model invalidates all source generations while
-- older API processes are fenced out of claims, stores, heartbeats and acks.
CREATE OR REPLACE FUNCTION embedding_projection_owned(p_key text)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE active_key text;
BEGIN
  SELECT projection_key INTO active_key FROM embedding_pipeline_config WHERE singleton FOR SHARE;
  RETURN COALESCE(active_key = p_key, false);
END $$;
CREATE OR REPLACE FUNCTION embedding_queue_claim_for_projection(p_key text)
RETURNS TABLE(house_id text, message_id bigint, read_ct integer, source_version bigint, lease_expires_at timestamptz)
LANGUAGE plpgsql AS $$ BEGIN
  IF NOT embedding_projection_owned(p_key) THEN RETURN; END IF;
  RETURN QUERY SELECT * FROM embedding_queue_claim();
END $$;
CREATE OR REPLACE FUNCTION embedding_queue_owned_for_projection(p_id text,p_msg bigint,p_read integer,p_version bigint,p_key text)
RETURNS boolean LANGUAGE plpgsql AS $$ BEGIN
  IF NOT embedding_projection_owned(p_key) THEN RETURN false; END IF;
  RETURN embedding_queue_owned(p_id,p_msg,p_read,p_version);
END $$;
CREATE OR REPLACE FUNCTION embedding_queue_keepalive_for_projection(p_id text,p_msg bigint,p_read integer,p_version bigint,p_key text)
RETURNS boolean LANGUAGE plpgsql AS $$ BEGIN
  IF NOT embedding_projection_owned(p_key) THEN RETURN false; END IF;
  RETURN embedding_queue_keepalive(p_id,p_msg,p_read,p_version);
END $$;
CREATE OR REPLACE FUNCTION embedding_queue_store_for_projection(p_id text,p_msg bigint,p_read integer,p_version bigint,
  p_model text,p_hash text,p_vector vector,p_metadata jsonb,p_key text)
RETURNS boolean LANGUAGE plpgsql AS $$ BEGIN
  IF NOT embedding_projection_owned(p_key) THEN RETURN false; END IF;
  RETURN embedding_queue_store(p_id,p_msg,p_read,p_version,p_model,p_hash,p_vector,p_metadata);
END $$;
CREATE OR REPLACE FUNCTION embedding_queue_finish_for_projection(p_id text,p_msg bigint,p_read integer,p_version bigint,
  p_success boolean,p_error text,p_key text)
RETURNS boolean LANGUAGE plpgsql AS $$ BEGIN
  IF NOT embedding_projection_owned(p_key) THEN RETURN false; END IF;
  RETURN embedding_queue_finish(p_id,p_msg,p_read,p_version,p_success,p_error);
END $$;
`;
