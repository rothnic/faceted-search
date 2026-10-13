# Actual PostgreSQL screenshot

![Actual PostgreSQL garage search with secondary details collapsed](screenshots/actual-pg-collapsed-desktop.png)

Captured 2026-10-13 at **1180 × 757** from the real local PostgreSQL demo:
- Provider: Native PostgreSQL; mode: keyword; query: `garage`
- Actual execution: `postgres-fts`; **35 matches**
- All 9 visible OpenStreetMap tiles loaded and opaque
- Serving source: independently reviewed `9dcedfd5d19812a5779cec73f1555fd38caf6f85`; its frontend changes are included in this PR commit. Both secondary-information controls are collapsed; the first result starts at y=219px and two complete cards are visible
- Independently inspected; original PNG bytes preserved (Git blob `73a55e6181a21293c2d551facab43410210a3829`)

This proves the shown PostgreSQL view only. The full multi-provider screenshot gallery, mobile capture and final CI are separate pending checks. Other screenshot files inherited from PR3 remain historical unless explicitly identified as current real-service evidence.

[Earlier real PostgreSQL view](screenshots/actual-pg-desktop.png) shows the preceding layout before secondary information was compacted. It remains historical evidence, not the latest layout.
