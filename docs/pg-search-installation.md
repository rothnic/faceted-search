# Real ParadeDB option on the existing PostgreSQL 15 image

Verified on 2026-10-13: PostgreSQL 15.19, pgvector 0.8.7 and ParadeDB pg_search
0.26.1 work together. No replacement database image, cloud service, API key or
embedding provider is needed. The optional package is the official PostgreSQL 15
Debian Bookworm release, matching the demo's base image.

## Pinned installation

`compose/stage-pg-search.sh DESTINATION` downloads, checksum-verifies and extracts
the official package into a staging directory. It does not install host packages.
It supports Docker `TARGETARCH=amd64` and `arm64`. `PG_SEARCH_DEB` optionally points
to an already downloaded package, which must pass the same release checksum.

The image build needs these steps in addition to its existing pgvector/PGMQ build:

1. Copy and run the staging script in the builder, with `/opt/pg-search` as its
   destination. The existing builder already supplies curl, certificates and dpkg.
2. Install runtime `libopenblas0` (the release package's declared dependency).
3. Copy `/opt/pg-search/usr/lib/postgresql/15/lib/pg_search.so`, the extension SQL
   and control files under `/usr/share/postgresql/15/extension/`, and the package's
   `/usr/share/doc/postgresql-15-pg-search/` license notices into the final image.
4. Start PostgreSQL with `-c shared_preload_libraries=pg_search`. If there are other
   preloads, preserve them in the comma-separated list.
5. Enable `CREATE EXTENSION IF NOT EXISTS pg_search CASCADE` in the demo database.
   `CASCADE` enables the already installed pgvector dependency.

Package SHA-256 values from the official GitHub release metadata:

- amd64: `922272988a92599bb9bbf619b8895f5280f8dc399f46cbdb68073582bc3bc132`
- arm64: `3126796dcc2891374f9f5724cac4dd65afb91dc4f65af6a4b8da6459cf92ba39`

The verified amd64 `.deb` is **53,729,368 bytes (51.2 MiB)**. Its installed
`pg_search.so` is **279,411,656 bytes (266.5 MiB)**; extension SQL/control files add
about 0.8 MB, plus OpenBLAS and license notices. The arm64 download is 50,947,676
bytes according to upstream metadata; its installed size was not measured.

The package's copyright notice identifies **AGPL-3.0-or-later**; it includes the
AGPL v3 license text. Retain those notices. This records the upstream license,
not a legal assessment of a particular deployment.

## Minimal application integration

The current transactional `house_search_documents(house_id, search_text, ...)`
projection can serve both native GIN FTS and ParadeDB. Only one ParadeDB index is
allowed per table; it can coexist with the separate native GIN index.

```sql
CREATE INDEX house_search_documents_bm25_idx ON house_search_documents
USING paradedb ((house_id::pdb.literal), search_text);

WITH lexical AS MATERIALIZED (
  SELECT house_id, pdb.score(house_id) AS raw_score
  FROM house_search_documents
  WHERE search_text ||| $1::text
)
SELECT h.id, l.raw_score
FROM houses h LEFT JOIN lexical l ON l.house_id = h.id;
```

`|||` matches any token; `&&&` requires all tokens. These tokenize a bound literal
query rather than interpreting it as Tantivy query syntax. `pdb.score()` is a real
BM25 score; keep it in the matching search scan before joining other relations.
`ORDER BY` is not required for score production. Descending score plus a `LIMIT`
enables the optimized Top-K plan. Literal indexing of the text ID allows the ID
tiebreaker to participate in Top-K sorting.

BM25 is unbounded. `raw_score / (1 + raw_score)` is a monotonic display/hybrid
normalization, not a calibrated probability or proof of comparability to cosine
similarity. For rank-based hybrid search, separate BM25 and pgvector candidate
branches can use reciprocal rank fusion. The SQL proof also checked a normal
pgvector cosine-distance branch and rank fusion with BM25.

`text[]`/`varchar[]` fields are supported. Each element is searchable; use
`(tags::pdb.literal)` to match a complete tag with `tags === 'family friendly'`.
The existing relational tags/amenities can instead remain part of the refreshed
search-text projection and ordinary SQL facet counts.

Joins against ordinary PostgreSQL relations work. Specialized ParadeDB join
pushdown additionally requires ParadeDB indexes on all joined relations, indexed
join/filter/sort fields (columnar text/JSON), a search predicate and a LIMIT.
Without those conditions it uses ordinary PostgreSQL joins; do not claim special
join acceleration for this demo's relational joins.

## Verification and limits

Run the rollback-only SQL proof against a disposable database started with the
preload setting:

```sh
psql "$DATABASE_URL" -f scripts/verify-pg-search.sql
```

The proof checks actual extension creation, native BM25 matching and positive
scores, literal text arrays, prepared queries with punctuation, a materialized
lexical scan joined to pgvector, transaction visibility and rollback. The captured
EXPLAIN contains `Custom Scan (ParadeDB Base Scan)`, `Scores: true` and
`TopKScanExecState`. It uses tiny artificial vector fixtures for SQL correctness,
not as a substitute for the demo's CPU-generated embeddings.

The amd64 release was executed locally using an isolated PostgreSQL 15.19 binary
and workspace-extracted OpenBLAS, with no host package installation. The arm64
checksum is verified against upstream release metadata but was not executed.
The Docker build still needs its own clean CI verification.

## Primary sources

- [Official extension installation](https://www.paradedb.com/docs/operate/deploy/self-hosted/extension)
- [Pinned v0.26.1 release](https://github.com/paradedb/paradedb/releases/tag/v0.26.1)
- [Release asset metadata](https://api.github.com/repos/paradedb/paradedb/releases/tags/v0.26.1)
- [Index creation and single-index constraint](https://www.paradedb.com/docs/reference/indexing/create-index)
- [BM25 scores](https://www.paradedb.com/docs/reference/full-text/score)
- [Text arrays](https://www.paradedb.com/docs/reference/indexing/indexing-arrays)
- [Join pushdown requirements](https://www.paradedb.com/docs/reference/joins/overview)
- [Reciprocal rank fusion](https://www.paradedb.com/docs/reference/hybrid/rrf)
- [Pinned license](https://github.com/paradedb/paradedb/blob/v0.26.1/LICENSE)
