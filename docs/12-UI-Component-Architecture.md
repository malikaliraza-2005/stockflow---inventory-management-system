# UI Component Architecture

## Web-Based Inventory Management System — React / TypeScript / Tailwind CSS

| | |
|---|---|
| **Document ID** | UCA-IMS-012 |
| **Version** | 1.0 (Approved) |
| **Date** | 2026-07-23 |
| **Status** | **APPROVED — READY FOR PRODUCTION** (design-system review rating 9/10) |
| **Source of truth** | WIR-IMS-011 (wireframes) · FEA-IMS-007 (tiers, FD-1…5, state discipline) · SMP-IMS-010 (routes/chunks) · SRS §15 — this document conforms to all and never overrides them |
| **Review record** | Principal Frontend Architect audit — Issues 1–3 incorporated (§10) |
| **Governing rule** | The catalog is **closed**: a component not listed here follows the same review path as a new feature |

---

## Table of Contents

1. [Taxonomy & Hierarchy](#1-taxonomy--hierarchy)
2. [Layout & Navigation Components](#2-layout--navigation-components)
3. [UI Primitives](#3-ui-primitives)
4. [Feedback & Error Infrastructure](#4-feedback--error-infrastructure)
5. [Domain Components](#5-domain-components)
6. [Auth Components](#6-auth-components)
7. [State Responsibility Matrix](#7-state-responsibility-matrix)
8. [Accessibility & Responsive Requirements](#8-accessibility--responsive-requirements)
9. [Implementation Guidelines](#9-implementation-guidelines)
10. [Review Findings Incorporated](#10-review-findings-incorporated)
11. [Reuse Verification & Exclusions](#11-reuse-verification--exclusions)

---

## 1. Taxonomy & Hierarchy

Three tiers (FEA §3.1), strict downward composition, plus guard/boundary infrastructure:

```text
TIER 3  pages/               14 route targets — fetch data, own URL state, compose tier 2
            │
TIER 2  components/domain/   business-aware, ONE interaction each
            │                 (may use stores, API mutations, usePermission)
TIER 1  components/ui/       presentational primitives — zero domain knowledge,
            │                 zero store access, props-in / callbacks-out
        components/layout/    chrome + guards (AppShell, PublicLayout,
                              RequireAuth, RequireRole, ForcePasswordChange)
```

```text
AppShell
├── TopBar ─ UserMenu
├── Sidebar ─ NavItem* ─ (Admin section via usePermission)
├── MobileDrawer (<768) · QuickScanBar (mobile bottom, NFR-31)
├── Breadcrumbs (product branch only)
└── <Outlet> → page
      page → PageHeader · domain components → ui primitives
Global singletons: ToastRegion · ConfirmDialogHost · RouteErrorBoundary
```

---

## 2. Layout & Navigation Components (`components/layout/`)

| Component | Purpose | State | Key props / notes |
|---|---|---|---|
| `AppShell` | Sidebar + TopBar + Outlet — the single protected chrome | Zustand (ui: sidebar) | Children via router Outlet |
| `PublicLayout` | Centered card, no chrome | Stateless | — |
| `RequireAuth` / `RequireRole` / `ForcePasswordChange` | Guard spine (SMP §6); **guards wrap lazy elements, never the reverse** | Zustand (auth) | `role`; deny → redirect `/` + notice (EC-19) |
| `TopBar` | App name, user menu, drawer trigger | Stateless | `onMenuToggle` |
| `Sidebar` / `NavItem` | Primary nav, active highlighting; Admin section filtered | via `usePermission` | `to, label, end` |
| `MobileDrawer` | Full nav list < 768 px | Local (open) | Focus-trapped; `Esc` closes |
| `QuickScanBar` | Persistent mobile scanner entry | Stateless | Thumb-zone placement |
| `UserMenu` | Profile / Logout | Local (open) | Menu-button ARIA pattern |
| `Breadcrumbs` | `Products → {name} → Edit` only | Stateless | `items: {label, to?}[]` |
| `PageHeader` | Title + action slot + optional breadcrumbs | Stateless | `title, actions?, breadcrumbs?` |
| `PageContainer` / `Section` | Padding, max-width, vertical rhythm — no page defines its own spacing | Stateless | Wrapper conventions |

---

## 3. UI Primitives (`components/ui/`) — reusable everywhere, domain-blind

### 3.1 Load-bearing primitives (full specifications)

**`DataTable<T>`** — the one table implementation (Products, Transactions, Audit, Users, Categories, Reports)

| Aspect | Specification |
|---|---|
| Props | `columns: ColumnDef<T>[]` (`{key, header, sortable?, render, align?}`) · `rows: T[]` · `sort?: {key, dir}` · `onSortChange?` · `rowKey` · `rowActions?: (row) => Action[]` · `virtualized?: boolean` · `mobileCard?: (row) => ReactNode` · `emptyState: ReactNode` · `loading?: boolean` (skeleton rows) · **expansion (review Issue 2):** `renderExpandedRow?: (row) => ReactNode` · `expandedKeys` · `onExpandedChange` (controlled, page-owned like sort) |
| State | Stateless — sort/pagination/filters live in the **page's URL params** (SMP §4), never inside the table |
| A11y | `<table>` semantics, `scope="col"`, sort buttons with `aria-sort`; expansion toggle is a labeled button with `aria-expanded`, expanded content in a full-width row associated to its parent; row-action menu is a labeled menu button |
| Responsive | ≥ 768: real table, virtualized past ~50 rows; < 768: `mobileCard` stack or own-container scroll |
| Performance | Row renders memoized by `rowKey` + row version — virtualized re-renders stay O(visible) under refetches |

**`Modal`** — base for every dialog: `open, onClose, title, size?, children, initialFocusRef?`. Focus trap, `Esc`, overlay click (disabled for destructive flows), **returns focus to trigger** (WIR §0.3), full-screen < 768. `role="dialog"`, `aria-modal`, `aria-labelledby`. Controlled by parent.

**`FormField`** — the only way inputs appear in forms: `label, htmlFor, error?, hint?, required?, children`. Owns `aria-describedby` wiring; error text in a live region.

**`SearchInput`** — `value, onDebouncedChange (300 ms), placeholder, onClear`. Local draft state; committed value lives in URL params. `type="search"`, labeled, reachable clear button.

**`Toast` / `ToastRegion` + `useToast`** — `toast.success|error(message, {correlationId?})`. uiStore queue; single `aria-live` region (`polite`; errors `assertive`); top-right desktop / top mobile; stack ≤ 3; success auto-dismisses; errors persist (WIR §0.3).

### 3.2 Primitive catalog (same conventions)

`Button` (variant `primary|secondary|danger|ghost`; `loading` disables + spinner) · `IconButton` (required `label`) · `Input` · `NumberInput` (integer mode for quantities; min/max per §15) · `Select` · `TextArea` · `Checkbox` · `DateInput` (wrapped native date input — report/ledger ranges) · `SegmentedToggle` (range 7/30/90, adjustment delta⇄counted, tabs — radiogroup semantics) · `Badge` (generic `tone + text` — **domain-blind per review Issue 1**) · `PlaceholderImage` (uniform fallback, BR-37/EC-23) · `Pagination` (`page, totalPages, onChange`; "Showing a–b of n") · `Skeleton` (text/card/table-row/chart variants) · `Spinner` · `EmptyState` (`message, action?`) · `AlertBanner` (`tone, message, action?` — STALE_WRITE, archived banner, maintenance) · `SubmitRow` (`onCancel, submitLabel, loading` — cancel left, submit right, everywhere)

---

## 4. Feedback & Error Infrastructure

| Component | Purpose | State |
|---|---|---|
| `ConfirmDialog` + `useConfirm` | Promise-based confirmation naming its target (`await confirm({title, body, tone})`); destructive button last (NFR-32) | uiStore |
| `RouteErrorBoundary` / `ErrorFallback` | Per-chunk-group boundary: message + `[Retry]` + correlation ID | Local |
| `NotFoundPage` | Ratified 404 (SMP §9) | Stateless |

---

## 5. Domain Components (`components/domain/`) — one business interaction each

### 5.1 Complex components (full specifications)

**`StockMovementDialog`** — Stock In/Out per WIR §17.1 incl. product-select Step 0
- Props: `open, onClose, product?: ProductRef` (absent → Step 0), `defaultType?, onCompleted(result)`
- Internal: step (`select|form|confirming`), drafts, warning-ack; **`useIdempotencyKey`** (same key across retries; regenerates on success/cancel)
- Server: `POST /inventory/movements`; `INSUFFICIENT_STOCK` renders server `available` inline
- Children: `ProductPicker` (Step 0), `NumberInput`, `SubmitRow` · Events: `onCompleted` → parent refetch (FD-2) + scanner-card update

**`ScannerViewport`** — camera decode per the FEA §6.1 state machine; every state a named rendering
- Props: `onDecoded(code)`, `paused` · Internal: machine state, 2 s duplicate-read cooldown, torch detection
- Dependencies: **lazy ZXing chunk**; `useCamera` · A11y: guidance states as text; decode announced; `ManualCodeEntry` sibling always rendered

**`ImageUploader`** — FEV-01 contract
- Props: `value: UploadedImage[], onChange, max = 5` · Internal: per-file progress/error; exactly-one-primary selection (DBR-03 mirror)
- Failure: failed tile `[Retry][Remove]`; never blocks product save (BR-37); remove-before-save destroys the asset

**`ProductForm`** — shared Add/Edit form (WIR §7/§8)
- Props: `mode: 'create'|'edit'`, `initial?`, `onSubmit(values)`, `submitting` — mode drives SKU editability, initial-quantity presence, `version` token
- Internal: local form state + zod (§15.2), blank→absent normalization (PDV-04); dirty tracking via **`useUnsavedChanges`** (review Issue 3)
- Children: `FormField`×n, `Select` (categories), `ImageUploader`, `SubmitRow`

### 5.2 Domain catalog

`StockStatusBadge` (**moved here per review Issue 1** — maps `IN_STOCK|LOW_STOCK|OUT_OF_STOCK|ARCHIVED` onto `Badge`) · `ProductPicker` (debounced search-select; movement Step 0) · `AdjustmentDialog` (Admin; `SegmentedToggle` mode, reason enum, note-required-for-OTHER; same warning/error states) · `ScanResultCard` (found/not-found/archived variants, role-dependent CTAs, post-movement success flash) · `ManualCodeEntry` · `QRLabel` (client-rendered SKU code; print-clean, rest `print:hidden`) · `KpiCard` (label, value, skeleton) · `StockAlertList` (low/out-of-stock rows; product link + pre-filled `[+]`) · `RecentTransactions` (dashboard 10-row list → ledger links) · `ChartPanel` (**lazy Recharts chunk**; series via props from Dashboard's single call — never fetches, NFR-11) · `TransactionTable` / `AuditTrailTable` (column defs over `DataTable`; audit uses expansion props for diff rows) · `CategoryFormModal` · `ReassignDeleteModal` · `UserFormModal` · `ResetLinkModal` (link + `[Copy]`, AS-6) · `ProductRowCard` (mobile renderer for `DataTable.mobileCard`)

---

## 6. Auth Components

`LoginForm` · `ResetPasswordForm` · `ForcePasswordChangeScreen` (gate rendering — no route) · `ChangePasswordForm` (Profile) — all compose `FormField` + `SubmitRow`; login errors stay generic (AAD §2).

---

## 7. State Responsibility Matrix

| Class | Holder | Members |
|---|---|---|
| Stateless | props only | All ui primitives except noted; layout chrome; badges; `QRLabel` |
| Local state | component | Dialog steps/drafts, form drafts, drawer/menu open, scanner machine, upload progress |
| Zustand | 3 stores only (NFR-25) | auth (guards, `usePermission`, `UserMenu`) · ui (toasts, confirms, sidebar) · settings (formatters) |
| Server state | page-scoped `useQueryState` | Pages fetch lists; domain components receive data via props and own **at most one mutation** |

**Rules:** tier-1 components never touch stores or the API. Domain components never fetch lists. No domain component renders another domain component's dialog — parents orchestrate.

**Shared hooks:** `usePermission` · `useIdempotencyKey` · `useQueryState` · `useDebounce` · `useCamera` · `useToast` · `useConfirm` · **`useUnsavedChanges(dirty)`** (review Issue 3 — router blocker + `useConfirm`; consumers: `ProductForm`, form modals, Settings).

---

## 8. Accessibility & Responsive Requirements

**Accessibility (component-level, per WIR §0.3):** dialogs trap focus + return to trigger; drawer likewise. Every action keyboard-reachable; row-action menus arrow-navigable; `SegmentedToggle` is a radiogroup. `IconButton` requires `label`; `FormField` owns `aria-describedby`. Live regions: `ToastRegion`, form errors, scanner state changes. Tables: semantics + `aria-sort` + `aria-expanded` on expansion toggles. Status always text + tone, never color alone.

**Responsive summary:**

| Component | < 768 | ≥ 768 |
|---|---|---|
| `AppShell` | Drawer + `QuickScanBar` | Fixed sidebar |
| `DataTable` | `mobileCard` stack / contained scroll | Table, virtualized |
| Modals/dialogs | Full-screen | Centered, sized |
| `ScannerViewport` | ~60% viewport height; thumb-zone actions | Constrained width |
| `KpiCard` grid | 1-column stack | 3-up |
| `ProductForm` | Single column | Two-column groups |

---

## 9. Implementation Guidelines

- **Folders:** exactly the approved tree (FST-008) — `ui/`, `layout/`, `domain/` (subgroup by feature past ~15 files); pages own column defs and URL-state parsing.
- **Naming:** PascalCase components; `use*` hooks; events `on<Event>` with past-tense results (`onCompleted`, `onDecoded`); boolean props positive (`open`, `loading`, `disabled`).
- **Props:** controlled inputs (`value`/`onChange`); variant unions, not boolean explosions; slot props for composition (`PageHeader.actions`); no prop drilling past two levels — restructure composition instead.
- **Performance:** lazy chunks per SMP §7 (`ScannerViewport` → scanner, `ChartPanel` → charts, `ProductForm`/`ImageUploader`/`UserFormModal` → admin — guard-outside-lazy); `DataTable` virtualization threshold ~50 rows; memoized column defs, chart series, and rows (§3.1); `SearchInput` debounce is the only client-side wait.
- **Testing:** every interactive component exposes a stable `data-testid` derived from its name; enumerated dialog/machine states are direct Testing Library targets (FEA §11).

---

## 10. Review Findings Incorporated

| # | Finding (severity) | Resolution |
|---|---|---|
| 1 | `StatusBadge` carried inventory domain knowledge inside domain-blind `ui/` (Minor — tier-rule breach) | Generic `Badge` stays in `ui/`; **`StockStatusBadge`** mapping lives in `domain/` (§5.2) |
| 2 | `DataTable` lacked expansion support required by the Audit Trail — would force a table fork (Minor→Major if unfixed) | Additive controlled expansion props + a11y semantics (§3.1) |
| 3 | Unsaved-changes protection buried in `ProductForm` — per-component reimplementation guaranteed inconsistency (Minor) | Extracted **`useUnsavedChanges`** hook (§7); `ProductForm` is its first consumer |
| + | Row memoization (improvement) | Pinned in `DataTable` spec (§3.1) — retrofitting memo boundaries later is churn |

---

## 11. Reuse Verification & Exclusions

**Reuse trace:** every WIR frame decomposes into this catalog with zero one-off components — e.g., Products page = `PageHeader + SearchInput + Select×2 + DataTable(+StockStatusBadge, RowActionsMenu, ProductRowCard) + Pagination + StockMovementDialog + AdjustmentDialog + ConfirmDialog`. The same `DataTable`, `FormField`, `Modal`, `SubmitRow`, `Pagination`, `EmptyState` serve all 14 pages.

**Explicit exclusions (requested categories with no approved basis):**

| Excluded | Reason |
|---|---|
| Product Form Modal / Scanner Modal | Both are **pages** in the approved sitemap |
| Bulk actions | Ratified absence (no SRS requirement) |
| MultiSelect, RadioGroup, Switch, custom DatePicker | No wireframe needs them — `SegmentedToggle`, `Checkbox`, native `DateInput` cover all cases |
| Transaction Timeline / Activity Feed | Wireframes specify plain lists (`RecentTransactions`) |
| Standalone barcode display / `CopyButton` / `Tooltip` | Text rendering, one-consumer, or no frame requires it |
| Theme system / dark mode | FD-4 |
| React Query integration | FD-1 — page-scoped hooks by ratified decision |

---

*End of document — UCA-IMS-012 v1.0 · Approved — Ready for Production · 2026-07-23*
