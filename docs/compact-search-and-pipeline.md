# Compact search and durable pipeline visibility

The search title now shares the desktop control band. Labeled search, mode,
provider and sort controls use one desktop row and two mobile rows. Filters and
Save search share the result header; mobile filters have a Show results control
at the top of the panel, with keyboard focus returned to the filter toggle.

## Layout regression measurements

Same `mode=keyword&q=garage` query, same Chromium viewports, before versus after:

| Viewport | Previous first card y | Compact first card y | Complete cards visible after |
| --- | ---: | ---: | ---: |
| 1366 × 900 | 639.6 | 365 | 2 |
| 390 × 844 | 664.7 | 496 | 1 |

These initial measurements preceded the combined backend’s additional explicit
fixture-mode warning. On the combined head the raw first-card positions are
407.5px desktop and 555px mobile, with one complete card visible in both. The
additional visible warning accounts for the entire 42.5px/59px difference.
The regression separately budgets layout height excluding measured warning
blocks, caps total raw height, and requires a complete card above the fold.
These are internal fixture measurements, not proof of real-service behavior. Mobile inputs/selects retain 44px height and neither viewport overflows.
Final service acceptance screenshots must use the actual PostgreSQL, ParadeDB,
Meilisearch and Typesense stack.

## What the pipeline panel means

`GET /api/embedding-jobs` supplies observed durable queue counts and document
freshness separately from the application CPU model cache. Unknown counts remain
unknown. Queue reservations are not a live worker-health guarantee; archived
counts are historical. The consumer-concurrency recovery caveat is displayed.
Pipeline completion counts are not an appliance's internal indexing progress.
Each appliance owns generation of its configured native embeddings.

Backfill's HTTP 202 `accepted` count is document records accepted for scheduling,
not jobs admitted or completed. Requests are single-flight, errors are explicit,
and keyboard focus/disclosure state survive refreshes.

## Screenshot acceptance

`SCREENSHOT_BASE_URL` must identify an already-running, seeded real stack.
Capture never starts a demo or reseeds the database. It rejects memory storage,
non-native execution labels, search warnings, and unloaded/faded map tiles.
Measured latency labels are retained. Native examples cover PostgreSQL vectors,
ParadeDB BM25, Meilisearch semantics, and Typesense hybrid search; their request
and execution details are saved in `native-execution-evidence.json`.

Real-stack browser tests and final screenshot inspection are required separately
from the 40-case internal mechanics/queue-contract regression suite. The latter
uses explicit `demo:memory` startup and excludes `@real-services`.
