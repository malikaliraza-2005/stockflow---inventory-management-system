# Frontend Architecture

## Web-Based Inventory Management System — React / Vite / TypeScript

| | |
|---|---|
| **Document ID** | FEA-IMS-007 |
| **Version** | 1.0 (Approved) |
| **Date** | 2026-07-23 |
| **Status** | **APPROVED FOR IMPLEMENTATION** |
| **Source of truth** | SRS-IMS-001 (`01-SRS.md`) · ARC-IMS-002 (`02-System-Architecture.md`) · ERD-IMS-003 (`03-ERD.md`) · DBD-IMS-004 (`04-Database-Design.md`) · `05-REST-API-Specification.md` (API contract) · BEA-IMS-006 (`06-Backend-Architecture.md`) — this document conforms to all six and never overrides them |
| **Review record** | Principal Frontend Architect validation (FEV-01…05) — all corrections incorporated below |
| **Fixed stack** | React 18 · Vite · TypeScript (strict) · Tailwind CSS · Zustand · Axios · Recharts · ZXing |

---

## Table of Contents

1. [Ratified Architecture Decisions](#1-ratified-architecture-decisions)
2. [State Management Strategy](#2-state-management-strategy)
3. [Component Design](#3-component-design)
4. [Data Flow](#4-data-flow)
5. [Routing & Authorization](#5-routing--authorization)
6. [Workflow Architectures](#6-workflow-architectures)
7. [Styling Strategy](#7-styling-strategy)
8. [Cross-Cutting UX Contracts](#8-cross-cutting-ux-contracts)
9. [Configuration & Assets](#9-configuration--assets)
10. [Performance Budget](#10-performance-budget)
11. [Testing Architecture](#11-testing-architecture)
12. [Review Findings Incorporated](#12-review-findings-incorporated)
13. [Assumptions, Risks & Implementation Order](#13-assumptions-risks--implementation-order)

---

## 1. Ratified Architecture Decisions

Decisions filling latitude the SRS leaves open — ratified at validation; everything else in this document is derived from approved artifacts:

| # | Decision | Rationale |
|---|---|---|
| FD-1 | **No query library** — page-scoped fetch hooks | Fixed stack; per-page lists with explicit refetch-after-mutation don't justify added machinery |
| FD-2 | **No optimistic updates** in v1 | Server is authoritative for quantity (BR-11); movement responses already return the new state |
| FD-3 | **Permission checks via one generated §5 matrix + `usePermission()`** | Scattered `role === 'ADMIN'` checks are a review-rejectable defect |
| FD-4 | **No dark mode / theming** | Not an SRS requirement — absence is a decision, not an omission |
| FD-5 | **System font stack** (no self-hosted fonts) | One less asset class; LCP win (NFR-03) — FEV-04 |

---

## 2. State Management Strategy

**Principle: client state is small and owned; server state is fetched, never duplicated (NFR-25).**

### 2.1 Client state — exactly three Zustand stores

| Store | Holds | Notes |
|---|---|---|
| `authStore` | Access token (**in-memory only**, A-7/SEC-01) · current user `{id, name, email, role, mustChangePassword}` · session status | Hydrated by silent refresh on app load; cleared on logout/refresh failure; `role` drives all UI gating |
| `uiStore` | Toasts, confirm dialogs, global modals, sidebar state | Pure presentation coordination |
| `settingsStore` | Currency, thresholds (fetched post-login) | Read-mostly; feeds formatters |

**Nothing else is global.** No products store, no transactions store — list data lives in page scope.

### 2.2 Server state — page-scoped fetch hooks

- Each page owns its data via a `useQueryState` hook pattern (`{data, loading, error, refetch}`) built on the typed API clients (FD-1).
- **Mutation → explicit refetch** of the affected page query (FD-2); movement dialogs apply the response's new quantity to their parent row immediately, then refetch.
- Dashboard renders the server's `asOf` timestamp verbatim (BR-25 staleness contract).

### 2.3 Form state — local + zod

Component-local controlled inputs validated by **zod schemas mirroring SRS §15** field-for-field; blank→absent normalization (PDV-04) happens here, at the boundary. Forms **never discard input on auth or network errors** (FR-AUTH-02, EC-28/30) — failures keep state and offer retry.

---

## 3. Component Design

### 3.1 Three tiers, strict downward composition

```text
pages/  ──compose──▶  domain components  ──compose──▶  ui primitives
 (route targets,       (business-aware:                (presentational only,
  data fetching,        StockMovementDialog,            zero domain knowledge:
  layout of domain      AdjustmentDialog, ProductForm,  Button, Input, Select,
  components)           ImageUploader, ScannerViewport, Modal, Table, Badge,
                        QRLabel, ChartPanel,            PlaceholderImage,
                        TransactionTable,               Skeleton, Toast)
                        AuditTrailTable)
```

- **ui/** primitives take props, render, and know nothing about products or roles; variants via plain class-map composition (no extra styling libraries).
- **domain/** components each encapsulate one business interaction and are the only place API mutations trigger outside pages.
- **layout/**: `AppShell` (sidebar + top bar), `RequireAuth`, `RequireRole`, `ForcePasswordChange` gate (FEV-02) — all guards are **UX only**; the server independently enforces every action (§5.3).

### 3.2 Role-conditional rendering (FD-3)

`usePermission()` reads `authStore.role` against a **generated frontend copy of the §5 permission matrix**. Components ask capability questions (`can('products.update')`), never compare roles inline.

---

## 4. Data Flow

### 4.1 The API layer — the dependency root, built first

```text
component → typed resource client (generated from OpenAPI, NFR-27 — never hand-written)
          → single Axios instance
              ├─ request interceptor: attach Bearer from authStore
              ├─ 401 handler: SINGLE-FLIGHT refresh (one in-flight promise; all
              │   401'd requests await it) → replay each original once → on
              │   refresh failure: preserve form state, route to login (ARB-03)
              └─ error interceptor: envelope → typed ApiError{code, message,
                  details, correlationId} → user message via the ONE
                  code→message table (05-REST-API §6.2); correlationId in toasts
```

- Wire conversions at the edge only: money strings and ISO-8601 UTC dates → `lib/formatters` (settings currency, browser timezone, NFR-33).
- Auto-retry: **idempotent GETs only**; mutations retry solely through the idempotency mechanism (NFR-19).

### 4.2 Unidirectional flow

`route → page (fetch) → domain components (props) → mutation → API → refetch → re-render`. No component reaches sideways into another page's data; cross-page context travels through the router (e.g., Scanner → pre-filled Add Product via route state).

---

## 5. Routing & Authorization

- **react-router v6 lazy route objects** — one route per SRS §9 page (14 pages); ZXing and Recharts chunks load with their routes, never on the login path (NFR-06).
- Guard nesting: `RequireAuth` → `ForcePasswordChange` gate (FEV-02: while `mustChangePassword` is set, every route renders the change-password screen until cleared) → `RequireRole` per the §5 matrix.
- Staff navigation to an Admin route: redirect to Dashboard with a notice; the server's `403` remains the security boundary (EC-19).

| Route | Page | Access |
|---|---|---|
| `/login` · `/reset-password` | Login · Reset Password | Public |
| `/` | Dashboard | Any |
| `/products` · `/products/:id` | Products · Product Detail (read-only for Staff) | Any |
| `/products/new` · `/products/:id/edit` | Add / Edit Product | Admin |
| `/scanner` | Scanner | Any (Adjustment action Admin-only) |
| `/categories` | Categories (read-only for Staff) | Any |
| `/transactions` | Transactions (Audit Trail tab Admin-only) | Any |
| `/reports` | Reports (export + Consistency Admin-only) | Any |
| `/users` · `/settings` | Users · Settings | Admin |
| `/profile` | Profile | Any |

---

## 6. Workflow Architectures

### 6.1 Scanner — explicit state machine (FR-SCAN-01…07)

```text
idle → requesting-permission → scanning → decoded → looking-up →
    found | not-found (role-dependent CTA) | archived (role-dependent CTA)
side states: permission-denied · no-camera · insecure-context
guards: payload validation (BR-16) · 2 s duplicate-read cooldown (EC-21)
manual-entry field: rendered in ALL states (FR-SCAN-01)
```

Every state is a named UI rendering — no improvised conditionals. `found` exposes Stock In/Out (any role) and Adjustment (Admin).

### 6.2 Movement dialogs — idempotency lifecycle

`useIdempotencyKey()`: generate a UUID when the dialog's submit attempt-group begins → **reuse the same key across retries** of that submission → discard and regenerate only after confirmed success or explicit cancellation (BEA §11.3). The warning-threshold confirmation (BR-15) and `INSUFFICIENT_STOCK` recovery (display the server's `available`, BR-11) are dialog states, not alerts.

### 6.3 Image upload — `ImageUploader` contract (FEV-01)

Select files (≤ 5 total; client validates type/size per §15.2) → `POST /upload/signature` → **direct upload to Cloudinary** with per-file progress → hold `{publicId, url}` in form state → attached only on product save. Failure paths: an upload failure never blocks saving the product without that image (BR-37, EC-29 — whole-file retry); remove-before-save calls `DELETE /upload/:publicId`; abandoned uploads are the backend sweep's responsibility (BEV-04) — the client does **not** attempt cleanup on navigation-away. Exactly-one-primary selection enforced in-component (DBR-03 client mirror).

### 6.4 QR label printing (FR-PROD-08)

`QRLabel` renders the SKU-encoded code client-side (zero backend dependency) with a print-clean layout; everything else is `print:hidden` (§7).

---

## 7. Styling Strategy

- **Tailwind utility-first, tokens centralized** in `tailwind.config`: brand palette, semantic colors (danger/warning/success mapped to stock states), spacing scale, breakpoints `360 / 768 / 1280` (NFR-36). No runtime CSS-in-JS.
- **Mobile-first responsive:** tables collapse to card lists or scroll within their own container — never page-level horizontal scroll; Scanner laid out for one-handed thumb reach (NFR-31); dialogs full-screen on mobile.
- **Accessibility (WCAG 2.1 AA, NFR-30):** visible focus rings; form errors bound via `aria-describedby` and announced; dialogs with focus traps + escape handling; full keyboard operability; color never the sole status signal (badges carry text).
- **Print stylesheet** for QR labels (§6.4). Dark mode/theming explicitly out (FD-4).

---

## 8. Cross-Cutting UX Contracts

| Concern | Contract |
|---|---|
| Loading | Skeletons for page loads; inline spinners for mutations; no layout shift |
| Errors | Route-level error boundaries (no blank screens); toast + correlationId for unexpected errors; inline field errors from `VALIDATION_ERROR` details |
| Empty states | Every list has a designed empty state with the role-appropriate CTA |
| Session expiry | Invisible when silent refresh succeeds; form-preserving redirect when it doesn't (EC-30) |
| Confirmations | Destructive/irreversible actions name their target (NFR-32); large movements confirm per BR-15 |
| Success feedback | Toast per mutation; movement dialogs show the new quantity inline |
| Images | `PlaceholderImage` primitive everywhere — absence and load-failure look identical and intentional (BR-37, EC-23) |

---

## 9. Configuration & Assets

- **Configuration (FEV-03):** a single `config` module validates `import.meta.env` (inventory per SRS §18.4 — `VITE_API_BASE_URL`, …) at bootstrap and fails loudly, mirroring the backend's fail-fast posture (NFR-28). Components never read `import.meta.env` directly.
- **Assets (FEV-04):** icons as typed React components in a single tree-shakeable module; static assets (logo, placeholder art) in `public/` with hashed references where imported; system font stack (FD-5); all product imagery from Cloudinary transformation URLs — never bundled.

---

## 10. Performance Budget (NFR-03/05/06)

Route-level code splitting · **ZXing and Recharts as lazy chunks excluded from the login path** · Cloudinary transformation URLs for all thumbnails · virtualized rendering for ledger/product tables · 300 ms debounced server-side search (PRF-01) · memoized chart series · hashed immutable assets (NFR-07). Target: LCP < 2.5 s mid-range mobile.

---

## 11. Testing Architecture (NFR-26 frontend slice)

| Tier | Scope |
|---|---|
| Component (Testing Library) | Domain components against their contracts — scanner state-machine transitions, movement-dialog idempotency/retry behavior, `ImageUploader` failure paths, role-conditional rendering via `usePermission` |
| Hook | Interceptor pair (single-flight refresh, replay-once, error mapping) · `useIdempotencyKey` lifecycle · `useQueryState` |
| E2E (Playwright) | The SRS smoke suite driven through the real UI: login → add product → stock in → stock out → ledger check (BR-17 as an executable assertion) — skeleton stood up in week one |

---

## 12. Review Findings Incorporated

| ID | Finding | Resolution |
|---|---|---|
| FEV-01 | Image upload workflow referenced but not architected | `ImageUploader` contract defined (§6.3) |
| FEV-02 | `mustChangePassword` had no routing enforcement | `ForcePasswordChange` gate inside `RequireAuth` (§5) |
| FEV-03 | Frontend configuration management unstated | Validated `config` module, fail-fast (§9) |
| FEV-04 | Asset organization undefined | Icon module + `public/` + system fonts (§9, FD-5) |
| FEV-05 | Charter referenced `05-REST-API-Design.md`; the artifact on disk is `05-REST-API-Specification.md` | Reported (same artifact, different filename); validation ran against the actual file — no approved document modified |

---

## 13. Assumptions, Risks & Implementation Order

**Assumptions (carried):** A-1…A-8 (architecture/backend) · AS-1…AS-20 (SRS §21) · DES-1/DBR-03/D-1 · FD-1…FD-5 (this document).

**Risks:**

| ID | Risk | Gate |
|---|---|---|
| R-1 | ZXing behavior variance across mobile browsers — the primary frontend risk; the state machine contains it architecturally | Device spike run immediately (Phase 4 first task) |
| R-7 | OpenAPI type generation depends on backend implementation order | Generate from the contract document itself in week one, not from a running server |

**Implementation order:**

1. `config` module → Axios instance + interceptor pair (with hook tests) → generated types — the dependency root.
2. ui primitives → `AppShell` + guard chain (incl. FEV-02 gate).
3. Pages in SRS roadmap order: auth → products → movements → scanner → dashboard/reports.
4. Playwright smoke skeleton in week one; ZXing device spike immediately (R-1).
5. Reconcile the pre-scaffolded `client/` tree against this blueprint when implementation begins (matches SRS §13.2; FEV-01…04 add `assets/` and `config` — minor adjustment, deferred until called for).

---

*End of document — FEA-IMS-007 v1.0 · Approved for Implementation · 2026-07-23*
