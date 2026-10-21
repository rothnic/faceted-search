# Read-only connected API

An already provisioned search stack can run the existing API entry point with
`SEARCH_READ_ONLY=1`. The default managed mode is unchanged; the flag accepts only
`0` or `1`.

Use the existing operator-managed configuration and command, setting this flag
before invoking `node --import tsx apps/api/src/main.ts`. Retain the explicit
DATABASE_URL, DATASET_ID, appliance origins, managed keys and SEARCH_SYNC_PROVIDERS.
Do not extract them from another process, print them, or read a credential-bearing
launcher to construct a new one. This option does not provide credentials or a
deployment/control interface.

Read-only mode:

- Checks for existing tables using catalog reads; never executes schema SQL.
- Skips embedding queue initialization and worker startup entirely. Setting only
  EMBEDDING_WORKER_ENABLED=0 is insufficient because ordinary startup still seeds.
- Forces each PostgreSQL connection into default_transaction_read_only, including
  when an existing URL options parameter requested a writable session.
- Validates native index settings using GET only. Missing indexes, disabled
  vectorStore or configuration drift fail closed; no repair or readiness callback,
  index mutation, document sync or automatic backfill is performed.
- Allows read endpoints and POST /api/search. Other mutation requests return
  HTTP403 with READ_ONLY_RUNTIME before running their handlers.
- Reports readOnly:true in GET /api/providers and the existing IPC ready message.

Operators must provision the schema/indexes and keep the separate existing managed
pipeline current. This API reports stale/unavailable projections rather than
repairing them. Local query embedding inference and native semantic search remain
read operations; this mode does not promise zero CPU use or immutable engine caches.

The existing owned disposable integration lifecycle checks real four-provider
search/detail reads, skipped worker initialization, PostgreSQL write rejection,
unprovisioned startup failure, mutation-route rejection, and unchanged source/work/
pipeline state. Deterministic appliance readiness tests check GET-only validation
and rejection of missing/drifted indexes without repair callbacks. No live preview
or production database is used for these checks.

Activation still requires a credential-safe supported managed launch command.
Do not add a second supervisor, change access/credentials, or bypass a denied
launcher read. Preserve the running preview and rollback until that interface is
available and the candidate is verified.
