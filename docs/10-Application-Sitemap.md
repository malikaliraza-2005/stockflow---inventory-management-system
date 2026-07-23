# Application Sitemap

## Web-Based Inventory Management System

| | |
|---|---|
| **Document ID** | SMP-IMS-010 |
| **Version** | 1.0 (Approved) |
| **Date** | 2026-07-23 |
| **Status** | **APPROVED — READY FOR PRODUCTION** (UX/IA review rating 9/10) |
| **Source of truth** | SRS-IMS-001 (§5, §8, §9) · FEA-IMS-007 (§5 routing, §6 workflows, FD-1…5, FEV-02) — this document conforms to both and never overrides them |
| **Review record** | Principal UX/IA/React Architect audit — Issues 1–2 incorporated; 404 addition and 403-as-redirect ratified (§9) |
| **Target** | React 18 + TypeScript + React Router v6 lazy route objects |

---

## Table of Contents

1. [Route Hierarchy](#1-route-hierarchy)
2. [Page Inventory](#2-page-inventory)
3. [Navigation Model](#3-navigation-model)
4. [URL State Conventions](#4-url-state-conventions)
5. [Deep Linking](#5-deep-linking)
6. [Guards & Access Enforcement](#6-guards--access-enforcement)
7. [Lazy-Loading & Chunk Groups](#7-lazy-loading--chunk-groups)
8. [Layout Relationships](#8-layout-relationships)
9. [Routing Infrastructure & Ratified Decisions](#9-routing-infrastructure--ratified-decisions)
10. [Coverage Verification](#10-coverage-verification)

---

## 1. Route Hierarchy

```text
<Root>  ── error boundary + Suspense fallback (route-level skeletons)
│
├── PublicLayout            (minimal centered card, no app chrome)
│   ├── /login                     Login
│   ├── /reset-password            Reset Password        (?token=…)
│   └── *                          → redirect /login
│
├── <RequireAuth>           (no session → /login with return-to)
│   └── <ForcePasswordChange gate>  (FEV-02: flag set → change-password screen
│       │                            renders for EVERY route below until cleared)
│       └── AppShell        (shared layout: Sidebar + TopBar + <Outlet/>)
│           ├── /                          Dashboard            (?range=7|30|90)
│           ├── /products                  Products (list)      (search/filter/page params)
│           │   ├── /products/new          Add Product          [Admin]
│           │   └── /products/:id          Product Detail
│           │       └── /products/:id/edit Edit Product         [Admin]
│           ├── /scanner                   Scanner
│           ├── /categories                Categories
│           ├── /transactions              Transactions         (?tab=ledger|audit)
│           │     · tab "audit"            [Admin — tab-level guard]
│           ├── /reports                   Reports              (?type=…)
│           │     · type "consistency" + CSV export   [Admin]
│           ├── /users                     Users                [Admin]
│           ├── /settings                  Settings             [Admin]
│           ├── /profile                   Profile
│           └── *                          Not Found (404)
│
└── [Admin] = <RequireRole role="ADMIN">
    unauthorized → redirect "/" + notice toast (EC-19; the server's 403 is the boundary)
```

Static segments (`/products/new`) rank above dynamic (`/products/:id`) per Router v6 segment ranking — verified non-conflicting.

---

## 2. Page Inventory

### 2.1 Public routes

| Route | Page | Purpose | Nav source | Auth | Role |
|---|---|---|---|---|---|
| `/login` | Login | Authenticate (UC-01) | Direct entry; all auth-failure redirects | No | — |
| `/reset-password?token=` | Reset Password | Complete admin-issued reset (UC-03) | Out-of-band link only (AS-6) | No (valid token) | — |

Authenticated users hitting public routes are redirected to `/`.

### 2.2 Protected routes — any role

| Route | Page | Purpose | Parent | Children | Nav source | Role |
|---|---|---|---|---|---|---|
| `/` | Dashboard | Inventory health (UC-11) | AppShell root | — | Post-login landing; sidebar | Any |
| `/products` | Products | Browse/search catalog | `/` | `new`, `:id` | Sidebar; dashboard drill-downs | Any |
| `/products/:id` | Product Detail | Full view; action hub; QR label | `/products` | `edit` | Products row; scanner card; dashboard alerts; ledger rows | Any (read-only for Staff) |
| `/scanner` | Scanner | Camera lookup + fast movements (UC-10) | `/` | — | Sidebar; dashboard quick action | Any |
| `/categories` | Categories | Taxonomy view/manage | `/` | — | Sidebar | Any (writes Admin) |
| `/transactions` | Transactions | Ledger + Audit Trail tabs (UC-13) | `/` | — | Sidebar; product-detail; dashboard recent list | Any (audit tab Admin) |
| `/reports` | Reports | Generate/view reports (UC-12) | `/` | — | Sidebar | Any (export + consistency Admin) |
| `/profile` | Profile | Own account + password | `/` | — | TopBar user menu | Any |

### 2.3 Protected routes — Admin only

| Route | Page | Purpose | Parent | Nav source |
|---|---|---|---|---|
| `/products/new` | Add Product | Create product (UC-05) | `/products` | Products header CTA; scanner unknown-code CTA (pre-filled via route state) |
| `/products/:id/edit` | Edit Product | Modify catalog fields (UC-06) | `/products/:id` | Detail edit action |
| `/users` | Users | Account lifecycle (UC-04) | `/` | Sidebar (Admin section) |
| `/settings` | Settings | System configuration (UC-14) | `/` | Sidebar (Admin section) |

---

## 3. Navigation Model

**Primary (Sidebar, AppShell):** Dashboard · Products · Scanner · Categories · Transactions · Reports — then an Admin-only section (rendered via `usePermission`, FD-3): Users · Settings. Active-route highlighting; identical structure for both roles minus the Admin section.

**Secondary (contextual):** TopBar user menu → Profile, Logout. Page-level tabs (Transactions). In-page action surfaces (movement dialogs, archive confirmations) are **modals, not routes** — dialogs never fork navigation (FEA §6).

**Mobile (< 768 px, NFR-36):** Sidebar collapses to a hamburger drawer; Scanner keeps a persistent thumb-reachable entry (NFR-31); tables collapse; dialogs go full-screen.

**Breadcrumbs** (desktop/tablet; product branch only — the sole hierarchy deeper than one level):
`Products → {product name}` · `Products → {product name} → Edit` · `Products → New`. All other pages are top-level; breadcrumbs suppressed.

---

## 4. URL State Conventions

**Rule: view state that should survive refresh and sharing lives in URL search params** (review Issue 1 — one convention, applied everywhere):

| Page | Search params |
|---|---|
| Products | `search`, `categoryId`, `stockStatus`, `archived`, `sort`, `page`, `limit` |
| Transactions | `tab=ledger\|audit` (audit subject to the Admin tab-guard) + `from`, `to`, `type`, `productId`, `userId`, `includeArchived`, `page` |
| Reports | `type=inventory\|low-stock\|transactions\|product-performance\|consistency` + report filters |
| Dashboard | `range=7\|30\|90` |

Ephemeral state (dialog open/closed, form drafts, scanner machine state) never enters the URL.

---

## 5. Deep Linking

| Deep link | Behavior |
|---|---|
| Any protected URL, unauthenticated | → `/login` with return-to; restored after login (superseded by the ForcePasswordChange gate when flagged) |
| `/products/:id` | Canonical product URL — used by scanner, alerts, ledger rows |
| `/transactions?productId=…` | Pre-filtered ledger (UC-13 A1) |
| `/products?stockStatus=low` | Dashboard low-stock drill-down |
| `/reports?type=low-stock` | Shareable direct report link |
| Scanner → `/products/new` | Barcode pre-fill via router state (FR-SCAN-04); state absent → plain form |
| `/reset-password?token=` | Invalid/expired token → in-page error state (no redirect loop) |

---

## 6. Guards & Access Enforcement

| Guard | Position | Behavior |
|---|---|---|
| `RequireAuth` | Above AppShell | No session → `/login` + return-to |
| `ForcePasswordChange` | Inside RequireAuth (FEV-02) | Flag set → change-password screen for every route until cleared; deliberately **not** a URL (no account-state leak into history); server co-enforces (AAD §2) |
| `RequireRole("ADMIN")` | Route level (4 routes) + tab/section/menu level | Unauthorized → redirect `/` + notice toast (EC-19). No dedicated 403 page — ratified decision (§9) |

**Guard/lazy ordering rule (review Issue 2):** guards wrap lazy route elements, never the reverse — otherwise the chunk downloads before the role check. Pinned by a test: a Staff session performs zero `admin`-chunk requests.

---

## 7. Lazy-Loading & Chunk Groups (NFR-06)

| Chunk group | Routes | Rationale |
|---|---|---|
| `auth` (eager — entry path) | `/login`, `/reset-password` | Smallest first paint; LCP budget (NFR-03) |
| `core` | `/`, `/products`, `/products/:id`, `/categories`, `/transactions`, `/profile` | Post-login working set |
| `scanner` | `/scanner` | **ZXing isolated** — loads only when scanning |
| `charts` | Dashboard chart panel (component-level lazy inside `core`) | **Recharts isolated** — dashboard shell renders before charts hydrate |
| `admin` | `/products/new`, `/products/:id/edit`, `/users`, `/settings` | Staff sessions never download admin surfaces (§6 ordering rule) |
| `reports` | `/reports` | Report tables + export logic |

Every lazy boundary has a Suspense skeleton; every group sits inside the route-level error boundary (FEA §8 — no blank screens).

---

## 8. Layout Relationships

Exactly two shared layouts: **PublicLayout** (centered card) and **AppShell** (sidebar + topbar + outlet). All 12 protected pages are AppShell children — one nested-route mount point, one place the guard spine composes, one navigation source of truth. No page defines its own chrome.

---

## 9. Routing Infrastructure & Ratified Decisions

| Item | Status |
|---|---|
| **404 Not Found** — `*` catch-all inside AppShell (friendly page, link to Dashboard); public catch-all redirects to `/login` | **Ratified addition** — routing plumbing, not a business page (absent from SRS §9 by design) |
| **403 page** | **Ratified absence** — EC-19 redirect-with-notice is the approved behavior; the server's 403 remains the security boundary |
| **URL view-state convention** (§4) | Review Issue 1 — incorporated |
| **Guard-outside-lazy rule** (§6) | Review Issue 2 — incorporated, test-pinned |
| Loading fallbacks / error boundaries | Per FEA §8; skeletons per chunk group |

---

## 10. Coverage Verification

- **Pages:** 14/14 SRS §9 pages present; zero inventions beyond the ratified 404.
- **Flows:** every SRS §8 flow has a complete navigation path — login → dashboard; scan → movement (≤ 2 interactions from decode); scan-unknown → pre-filled create (1 click); alert → pre-filled Stock In (1 click); reset link → login. No flow requires sidebar backtracking.
- **Roles:** gating matches the SRS §5 matrix at route, tab, section, and menu granularity — all UX-layer; server-authoritative per §5.3.
- **Performance:** chunk groups realize NFR-06 exactly; heavy dependencies (ZXing, Recharts) are unreachable from the login path.
- **Scalability:** future modules (SRS §20) slot in as new sidebar sections + chunk groups; additional roles extend `RequireRole` + the generated matrix without restructuring.

---

*End of document — SMP-IMS-010 v1.0 · Approved — Ready for Production · 2026-07-23*