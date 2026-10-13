# Search UI visual refresh

The prior screenshot set passed functional tests but did not meet visual acceptance: the suggestions crop omitted its input, and the map captured markers before its basemap tiles loaded.

## Design changes

- One coherent light theme, teal accent, restrained borders and consistent controls.
- Search is the primary action, with search mode, provider and sorting grouped beneath it.
- A narrow filter rail supports a two-column listing/map workspace on wide screens. Prices and essential property facts lead each card.
- Developer diagnostics are collapsed below results. Material execution warnings remain visible, and the in-memory/demo label remains persistent.
- Small screens retain the accessible filter disclosure and stack the listing/map sections.

## Why daisyUI

[daisyUI's official Vite guide](https://daisyui.com/docs/install/vite/) supports vanilla Vite directly. We use pinned daisyUI 5.7.50 and Tailwind 4.3.3 with the official Vite plugin. This adds build-time CSS tooling, not a client component runtime or a React migration. Only buttons, inputs, selects, checkboxes, badges and cards are included; one custom theme defines the shared tokens. Existing DOM events and native accessibility semantics stay in place.

The [plugin configuration](https://daisyui.com/docs/config/) supports this selective component build. The previous shadcn assessment remains applicable: its official MCP can help discover/install registry components, but does not turn React components into vanilla DOM or substitute for browser testing. No MCP installation or persistent access was needed.

## Screenshot evidence and readiness

Original acceptance evidence is preserved in `screenshots/before/`. The current `screenshots/` files are replaced only by successful captures of the updated application; failure artifacts live under `test-results/` and are not treated as accepted screenshots.

Map readiness requires real image completion and a positive natural width for every map tile, plus Leaflet's completed load state. Tile errors and a 15-second loading deadline produce an explicit user-visible failure. Captures use a 20-second deadline, then fail with a diagnostic JSON and screenshot instead of committing gray maps. Standard [OpenStreetMap tile usage](https://operations.osmfoundation.org/policies/tiles/) and attribution are preserved; no offline tile bundle, request spoofing or fabricated basemap is used.

The suggestions capture verifies both input and dropdown bounding boxes are within the screenshot viewport. Browser regressions cover the visible input, desktop diagnostics disclosure and an aborted-tile error while listing markers/results remain available.

## Verification

The 32 local browser regressions passed after the redesign, including explicit tile-failure and suggestions/input visibility checks. Independent desktop, suggestions and 390px mobile visual review passed, including a contrast repair verified from computed styles. Exact-head CI and final full-size screenshot review are still pending. Standalone Chromium in the dot cloud workspace cannot reach the OSM tile endpoint (`ERR_CONNECTION_REFUSED`); the supported interactive browser loaded and visually confirmed 9/9 real tiles. The strict screenshot gate correctly fails this environment rather than publishing a gray map. Real-service appliance happy-path testing remains explicitly excluded from the local test gate, not counted as passed.
