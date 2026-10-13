# Inspectable search UX

## What is observable

- `/system` displays the storage mode explicitly, observed local CPU model state and active embedding batches, and **recorded** external-sync state. Runtime readiness is not corpus coverage; cached-text counts are not a completion percentage.
- Download progress is shown only when the runtime supplies measured bytes, and is labeled per-file. There is no invented overall model/backfill ETA or percentage.
- Memory-mode backfills and workers are labeled simulations. PostgreSQL-mode counters still do not prove live engine health or index freshness. No always-running worker is claimed.
- Search warnings are visible beside results rather than buried only in debug JSON. Ranking scores are ordering signals, not calibrated probabilities.
- `/schema` derives its tables, columns, foreign-key relationships, explicit indexes and exact SQL from `DATABASE_SCHEMA_SQL`, the same constant used by `RealServices.ensureSchema`. It is application-declared DDL, **not live database introspection**. It exposes no rows or connection credentials.

## Interaction changes

Search renders before saved-search count evaluation completes. Loading and failed inference are visible, criteria survive errors, and keyword search remains an explicit recovery path. Failed saved counts display `?`, never a fabricated zero. Newer searches win races; failed pagination stops automatic retries. Sync buttons show the actual in-flight browser request and prevent duplicate submissions. Small screens put the long filter rail behind a keyboard-accessible toggle and keep navigation scrollable.

## Component/tooling decision

Reviewed current primary documentation:

- [shadcn Vite installation](https://ui.shadcn.com/docs/installation/vite)
- [shadcn Data Table](https://ui.shadcn.com/docs/components/radix/data-table)
- [shadcn Sidebar](https://ui.shadcn.com/docs/components/radix/sidebar)
- [shadcn Progress](https://ui.shadcn.com/docs/components/radix/progress)
- [shadcn Empty](https://ui.shadcn.com/docs/components/radix/empty)
- [Official shadcn MCP](https://ui.shadcn.com/docs/mcp)
- [Native disclosure semantics](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/details)
- [Native progress semantics](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/progress)

Cards, badges, clear empty states, progressive disclosure and a searchable schema table are useful patterns here. The repository is vanilla JavaScript/DOM with Vite despite the `web-angular` directory name. Introducing React, Tailwind and a component runtime merely for this slice would be disproportionate. This implementation uses native semantic HTML and existing CSS tokens, inspired by those patterns; it does **not** claim to install or use shadcn components.

The official MCP is useful for browsing/searching/installing registry components in a compatible project. It cannot add runtime service telemetry or validate schema truth, and its installation benefit is small here. No MCP, credentials, persistent access, new UI dependency or framework migration was added. Existing Playwright plus browser screenshots provide the relevant implementation feedback.


## Verification

Run `npm run typecheck`, `npm run web:build`, then `npx playwright test --grep-invert @real-services` for the local/demo browser suite. The existing direct-adapter happy-path test is explicitly tagged `@real-services`: it requires reachable, seeded Meilisearch and Typesense and is not covered by a memory-mode pass. The deterministic adapter-failure test is included in the local suite.

`npm run screenshots:update` now also captures System, Schema and a 390px mobile search layout. It honors `SCREENSHOT_BASE_URL` and optional `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` for an already-installed browser. The heavy InstantSearch adapter bundle is lazy-loaded only on its routes.
