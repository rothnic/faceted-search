# daisyUI component audit

Reviewed 2026-10-13 against installed **daisyUI 5.7.50**, the official documentation, and application source through cosmetic checkpoint `22435e1`. This is an implementation inventory and recommendation, not a claim that the migrations below are already complete.

## Filter answer

The current filter is a custom `aside.panel` containing `facet-group` form sections. On mobile, JavaScript toggles `mobile-open` and custom CSS shows/hides the same panel. Its inputs already use daisyUI Checkbox, Input and Select. Its container is **not** daisyUI Drawer, Menu or Megamenu.

Use **Drawer for the responsive container**, **Fieldset/legend for related controls**, and **Collapse for sections that benefit from disclosure**. Keep desktop filters persistent and mobile filters dismissible. Preserve selected values, counts, existing OR/scope logic, scroll position, focus return, and the visible Show results action. Drawer is a CSS/sidebar primitive; keyboard dismissal, focus behavior and any modal background treatment still need explicit testing. [Drawer](https://daisyui.com/components/drawer/), [Fieldset](https://daisyui.com/components/fieldset/), [Collapse](https://daisyui.com/components/collapse/)

Megamenu is available in 5.7.50, but its documented purpose is large top-of-page navigation popovers. It can hold custom content, yet moving this persistent multi-facet form into a navigation menu would be a poor fit. The smaller Filter primitive supports radio **and checkbox** choice groups; it does not replace the whole range/geo/saved-search sidebar or query engine. [Megamenu](https://daisyui.com/components/megamenu/), [Filter](https://daisyui.com/components/filter/)

## Inventory and decisions

| Area | Current implementation | Better standard option / decision |
|---|---|---|
| Global navigation | Custom topbar/nav flex layout and active links | Adopt Navbar + Menu presentation, retaining ordinary anchors and aria-current. No need for a many-column Megamenu for seven destinations. [Navbar](https://daisyui.com/components/navbar/), [Menu](https://daisyui.com/components/menu/) |
| Filter container | Custom aside and mobile visibility class | Replace container with responsive Drawer, as above. Do not rewrite query/state logic. |
| Facet sections and range groups | Generic div/strong sections; numeric labels lack for/id association | Use Fieldset + legend; explicit input IDs/labels. Keep native Checkbox/Input. Optional independent details-based Collapse for long groups; selected values/counts remain visible. |
| Facet Show more/fewer | Custom selected-first bucket/count expansion | Keep this domain behavior. Collapse can style the section, but does not implement selected-first facet semantics. |
| Search/mode/provider/sort | daisyUI Input/Select with native controls, custom compact layout | Keep primitives; consolidate layout/radius overrides into theme tokens. Native Select supplies behavior better than a custom option picker. |
| Autocomplete suggestions | Custom absolutely positioned button list | Use Dropdown presentation where helpful, but implement/test real combobox/listbox keyboard semantics. Dropdown does not supply filtering, highlighted-option state, Arrow/Enter/Escape behavior or async cancellation. [Dropdown](https://daisyui.com/components/dropdown/) |
| Search info and diagnostics | Native details with custom overlay/section CSS | Use Dropdown for the small anchored information panel and Collapse on details for diagnostics. Retain one info entry, focus preservation and honest execution warnings. Do not convert interactive content into a tooltip. |
| Listing cards | daisyUI card class plus custom article layout | Keep Card; use card-body/card-title/card-actions where they remove CSS without adding whitespace. Property content, map linkage and virtualization stay application-owned. [Card](https://daisyui.com/components/card/) |
| Status and removable chips | New Badge variants on spans/native buttons | Keep Badge styling. There is no separate Chip module. Native removable/add-filter buttons still require explicit names, focus and adequate targets. Apply same primitives to old dialog tags/chips. [Badge](https://daisyui.com/components/badge/) |
| Save-search naming | Browser prompt | Replace with native dialog + daisyUI Modal, labeled Input, Cancel/Save buttons and validation; do not create a second custom popup system. [Modal](https://daisyui.com/components/modal/) |
| Property-detail dialog | Custom backdrop + section role=dialog | High-priority replacement: native dialog.showModal() with Modal/Modal-box. Current code has no identified focus trap, background inertness or opener restoration. Keep property-specific contents and test focus return, Escape, backdrop, repeated opening, and form actions. |
| Loading search and connection state | Custom loading-skeleton boxes and plain status paragraph | Use Skeleton for placeholder geometry and Loading for indeterminate work, retaining status text/aria-busy. No fabricated completion. [Skeleton](https://daisyui.com/components/skeleton/), [Loading](https://daisyui.com/components/loading/) |
| Errors, warnings and operations | Custom notice/error blocks | Use Alert variants and native role/status appropriately; retain actionable Retry controls, persistent important errors, and unknown values. Toast is optional only for transient confirmations, not lost backend failures. [Alert](https://daisyui.com/components/alert/) |
| Model download progress | Native progress with custom styling | Use Progress styling on the existing progress element. Only measured downloaded bytes get determinate values; queue history is not a completion percentage. [Progress](https://daisyui.com/components/progress/) |
| System / queue metric cards | Custom status-grid/card and dl pairs | Consider Stat/Status for truly numeric summaries; retain semantic dl for heterogeneous state/configuration. Resolve the .stats class collision before enabling Stat. [Stat](https://daisyui.com/components/stat/) |
| Schema tables | Custom table/schema styles in native disclosures | Use Table + Collapse while preserving actual headings, SQL/code regions, overflow and declared-not-live labeling. [Table](https://daisyui.com/components/table/) |
| Provider comparison | Custom matrix and provider cards | Table for capability matrix, Card for summary sections; preserve per-provider differences instead of cosmetic homogenization. |
| Saved searches | Custom saved-list/saved-row and actions | List for repeated records; Buttons/Badges for actions/status. Use semantic rows and preserve failure counts as unknown. [List](https://daisyui.com/components/list/) |
| InstantSearch routes | Third-party InstantSearch/adapters and generated widgets | Keep adapter-owned behavior. Apply daisyUI-compatible presentation via supported templates/class hooks, not a reimplementation of the search engine widgets. |
| Map, geographic popups and marker selection | Leaflet map/markers/popups | Keep Leaflet. daisyUI has no map engine or geographic anchoring replacement. Reuse Card/Badge/Button inside rich previews; use Leaflet tooltip anchoring for markers. |
| Utility tooltips | Native titles / new tooltip slice under development | DaisyUI Tooltip suits short noninteractive desktop hints and focused icon controls. Ensure accessible text; interactive mobile preview remains a card/dialog, not hover-only tooltip. [Tooltip](https://daisyui.com/components/tooltip/) |
| Map/List view control | Native button plus shared-DOM application state | Keep minimal state logic. Optional Button/Join styling; do not force tab semantics unless implementing complete keyboard/selection behavior. Preserve map viewport and list offset. |
| Virtual results / infinite pagination | TanStack Virtual and custom pagination requests | Keep existing library; daisyUI supplies appearance, not virtual scrolling or backend pagination. Do not replace with Carousel or generic List behavior. |
| Empty states | Small custom explanatory panel and recovery action | Compose Card/Alert/Button primitives; no need to invent a component absent from the library or add a large hero. |
| Scrollbars / responsive grid | Native browser scrolling and app geometry | Keep minimal CSS. No custom scrollbar framework; preserve keyboard scroll, forced colors and discoverability. |

## Implementation hazards

- Only `button, input, select, checkbox, badge, card` are enabled in the daisyUI include list. Adding class names alone does not install the other component styles.
- Expand the allowlist deliberately rather than enabling everything. Existing `.stats` means muted paragraph text; daisyUI Stat uses `.stats` as a grid container. Rename the helper before adding Stat.
- Existing `.modal-backdrop` is a custom shell and conflicts with daisyUI's same name. Migrate structure and CSS together. With this explicit include filter, include the relevant `rootscrolllock` and `rootscrollgutter` base modules for Modal's documented page-scroll behavior.
- Native details/summary and dialog are useful foundations, not evidence of hand-rolling by themselves. Prefer daisyUI's documented native patterns over recreating focus management.
- Avoid replacing tested behavior in a mass class-name migration. Measure CSS/bundle changes and remove obsolete overrides after each migrated component.

## Suggested bounded order

1. **Filter structure:** Drawer + Fieldset/labels, then optional Collapse, with desktop/mobile accessibility and state-retention tests.
2. **Modal shell:** native property details and save-search dialog, replacing the highest-risk custom interaction.
3. **Common feedback:** Alert, Loading/Skeleton, Progress; preserve truthful backend/error semantics.
4. **Secondary pages:** Table, List and selected Card/Collapse patterns; then Navbar/Menu and optional Stat after collision cleanup.
5. **Remaining presentation:** Dropdown/Tooltip wrappers and theme consolidation. Retain Leaflet, native Select and TanStack behavior.

Each step should keep the current reviewed screenshot source distinct, rerun all affected interactions, and capture the actual service-backed page at desktop, 761px boundary, 390px and 320px as applicable.

## Secondary-route implementation detail

- **System/pipeline:** keep compact semantic definition lists. Use Card shells, Badge status, Alert errors, native Progress and details-based Collapse. The failure table is a direct Table fit. Stat tiles are optional for only the few genuinely important numbers; dense operational facts should not all become oversized metrics.
- **Schema:** keep multiple details open for comparison; do not impose single-open Accordion behavior. Preserve captions, column scopes, matching-table expansion and labeled horizontal scroll regions when applying Table/Collapse.
- **Providers:** the capability matrix needs a horizontal overflow wrapper during Table migration; current custom provider matrix lacks the explicit wrapper already used on Schema/pipeline.
- **Saved Searches:** List/list-row maps directly to named records, metadata and actions. Apply stays an anchor, Evaluate a button. Criteria JSON remains native pre, optionally inside Collapse.
- **InstantSearch:** current routes rely on bespoke ais-* CSS and do not configure cssClasses. Prefer supported cssClasses/templates hooks for Input, Checkbox, Badge and Button appearance. Keep all widgets/adapters. Pagination can use Button + Join; `join` is a utility include and there is no standalone pagination module. [InstantSearch SearchBox hooks](https://www.algolia.com/doc/api-reference/widgets/search-box/js), [pagination hooks](https://www.algolia.com/doc/api-reference/widgets/pagination/js), [daisyUI pagination](https://daisyui.com/components/pagination/)
- **Migration cleanup:** remove superseded unlayered matrix/notice/panel/modal-backdrop CSS while migrating. Adding component classes under stronger old rules does not actually retire the hand-rolled presentation. [Include configuration](https://daisyui.com/docs/config/)

## Implemented checkpoint: responsive filters

The search sidebar now uses the installed Drawer and Fieldset modules. Desktop keeps one persistent filter form; mobile presents that same form with an overlay, Escape/Show results dismissal, focus containment/return, and an inert background. Numeric range labels are explicitly associated with inputs, facet controls have stable IDs, and rerenders preserve focus and panel scroll. Resize closes mobile modality and restores desktop controls. Drawer opening has no delayed visibility transition so initial focus can be placed immediately; its checked root is above the toolbar stacking context.

The same checkpoint normalizes Map/List and Save search to shared 44px height, 12px type and 14px horizontal padding. Map/List uses a quiet ghost style. Cards use one spacing rhythm instead of adding grid gaps to child margins. Search text, warning content, badge labels and touch areas are retained. Native service screenshots remain subject to the exact-head CI and independent visual gate.

The Modal, feedback, navigation and secondary-page recommendations above remain outstanding; this checkpoint does not claim those migrations.
