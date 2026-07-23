# Software Requirements Specification (SRS)

## Web-Based Inventory Management System

| | |
|---|---|
| **Document ID** | SRS-IMS-001 |
| **Version** | 1.0 (Approved) |
| **Date** | 2026-07-22 |
| **Status** | **APPROVED FOR SYSTEM DESIGN** |
| **Prepared by** | Lead Software Architect |
| **Audience** | Development team, QA, DevOps, Project stakeholders |

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Project Scope](#2-project-scope)
3. [Functional Requirements](#3-functional-requirements)
4. [Non-Functional Requirements](#4-non-functional-requirements)
5. [User Roles & Permissions](#5-user-roles--permissions)
6. [Business Rules](#6-business-rules)
7. [Use Cases](#7-use-cases)
8. [User Flow](#8-user-flow)
9. [Application Pages](#9-application-pages)
10. [Database Design](#10-database-design)
11. [System Architecture](#11-system-architecture)
12. [REST API Specification](#12-rest-api-specification)
13. [Folder Structure](#13-folder-structure)
14. [Security Requirements](#14-security-requirements)
15. [Validation Rules](#15-validation-rules)
16. [Error Handling Strategy](#16-error-handling-strategy)
17. [Third-Party Libraries](#17-third-party-libraries)
18. [Deployment Architecture](#18-deployment-architecture)
19. [Development Roadmap](#19-development-roadmap)
20. [Future Enhancements](#20-future-enhancements)
21. [Assumptions](#21-assumptions)
- [Appendix A: Traceability Matrix](#appendix-a-traceability-matrix)

---

## 1. Executive Summary

### 1.1 Purpose

This document specifies the complete functional and non-functional requirements for a modern, responsive, web-based **Inventory Management System (IMS)**. It is the **single source of truth** for the development team: every feature, business rule, page, API endpoint, database structure, and quality attribute required to implement the system is defined here. Implementation may begin from this document without further clarification.

### 1.2 Scope Summary

The IMS enables a business to manage its product catalog, record and audit all inventory movements (Stock In, Stock Out, Adjustments), scan barcodes/QR codes with a device camera for fast operations, and monitor inventory health through dashboards and reports. The system supports two user roles (Admin, Staff), operates against a single warehouse/location, and is optimized for desktop, tablet, and mobile browsers.

### 1.3 Objectives

| # | Objective |
|---|---|
| O-1 | Provide accurate, real-time visibility of stock levels and inventory value |
| O-2 | Guarantee a complete, immutable audit trail of every quantity change |
| O-3 | Reduce data-entry time and errors via camera barcode/QR scanning |
| O-4 | Alert operators to low-stock and out-of-stock conditions before they impact operations |
| O-5 | Enforce role-appropriate access for administrative vs. floor-operation users |
| O-6 | Deliver a production-grade system: secure, observable, recoverable, and horizontally scalable |

### 1.4 Business Value

- **Inventory accuracy** — the ledger invariant (see [BR-17](#6-business-rules)) makes stock counts provably reconcilable, eliminating silent drift.
- **Operational speed** — scan-driven workflows reduce a stock movement to seconds on a mobile device.
- **Accountability** — every movement and every catalog change is attributable to a user and timestamp.
- **Decision support** — dashboards and reports expose value, velocity, and shortage risks.
- **Low operating cost** — managed services (MongoDB Atlas, Cloudinary) minimize infrastructure burden.

### 1.5 Glossary (Canonical Terminology)

These terms are used exclusively and consistently throughout this document.

| Term | Definition |
|---|---|
| **Product** | A catalog item identified by a unique SKU, optionally carrying a unique barcode |
| **Stock Movement** | The *operation* of changing a product's quantity: Stock In, Stock Out, or Adjustment |
| **Transaction** | The *immutable ledger record* produced by every Stock Movement. Types: `STOCK_IN`, `STOCK_OUT`, `ADJUSTMENT`, `INITIAL` |
| **Archive** | Soft deletion of a product: hidden from active lists, excluded from dashboard totals, retained for history, restorable by Admin. "Delete" without qualification never means Archive |
| **Hard Delete** | Permanent removal; permitted only for products with zero Transactions |
| **Deactivate** | The only lifecycle end-state for a user account. Users are never deleted |
| **Adjustment** | An Admin-only Stock Movement correcting quantity (signed delta or counted absolute), always with a reason code |
| **Low Stock** | `0 < quantity ≤ lowStockThreshold` for that product |
| **Out of Stock** | `quantity = 0` |
| **Inventory Value** | `Σ (product.quantity × product.costPrice)` across active (non-archived) products |
| **Idempotency Key** | Client-generated unique key attached to a Stock Movement request so a retried request cannot execute twice |

### 1.6 Document Conventions

- **Requirement IDs**: `FR-<MODULE>-NN` (functional), `NFR-NN` (non-functional), `BR-NN` (business rule), `UC-NN` (use case), `SEC-NN` (security). Cross-references cite these IDs.
- **Modules**: AUTH (Authentication & Session), USER (User Management), PROD (Products), CAT (Categories), INV (Inventory / Stock Movements), SCAN (Barcode & QR), DASH (Dashboard), TXN (Transactions & Audit), SRCH (Search & Filtering), RPT (Reports), SET (Settings).
- **MUST / MUST NOT** denote mandatory behavior; **SHOULD** denotes strong recommendation.

---

## 2. Project Scope

### 2.1 In Scope

1. Secure authentication (JWT access + rotating refresh tokens), session management, logout, admin-triggered password reset, account lockout.
2. User management with two roles (Admin, Staff), account deactivation, last-admin protection.
3. Product management: create, edit, archive/restore, hard delete (restricted), images (Cloudinary), categories, SKU and barcode management, embedded supplier information, per-product low-stock threshold.
4. Category management: flat taxonomy, CRUD with referential protection.
5. Inventory management: Stock In, Stock Out, Adjustments (incl. manual quantity correction), full movement history.
6. Barcode & QR: camera scanning (ZXing), manual entry fallback, barcode/SKU lookup, scan-driven Stock Movements, printable SKU-encoded QR labels.
7. Dashboard: total products, inventory value, current stock, low-stock and out-of-stock alerts, recent Transactions, trend charts (7/30/90 days).
8. Transactions: complete, immutable audit ledger (product, user, timestamp, type, quantity delta) plus an administrative Audit Trail of catalog/user/settings changes.
9. Search, filtering, sorting, and pagination on all list views.
10. Reports: Inventory Summary, Low Stock, Transaction History, Product Performance, and an Admin-only Ledger Consistency report; CSV export (Admin).
11. Settings: system currency, default low-stock threshold.
12. Production-readiness: quantified NFRs, health endpoints, structured logging, monitoring hooks, backup/restore requirements, CI quality gates.

### 2.2 Out of Scope (v1.0)

| # | Exclusion | Notes |
|---|---|---|
| OS-1 | Multiple warehouses / locations | Single location; see [§20](#20-future-enhancements) |
| OS-2 | Purchase orders, supplier management module | Supplier data is embedded per product only |
| OS-3 | Sales module, POS integration, customer management | Future enhancement |
| OS-4 | Email / SMS notifications | Alerts are dashboard-only in v1 |
| OS-5 | Bulk CSV import/export of products | Explicitly deferred; see §20 |
| OS-6 | Offline mode / PWA queueing | Online-only; forms preserve state on transient failures |
| OS-7 | Multi-currency, localization / i18n | Single configurable currency; English UI |
| OS-8 | Accounting valuation methods (FIFO/LIFO/WAC) | Inventory value = current cost × quantity |
| OS-9 | Fractional units of measure | Quantities are integers ("units") |
| OS-10 | Native mobile applications | Responsive web only; see §20 |
| OS-11 | Self-service user registration | All accounts are Admin-provisioned |
---

## 3. Functional Requirements

Each module lists: purpose, requirements, inputs/outputs, dependencies, and success criteria. Business rules are centralized in [§6](#6-business-rules) and cited by ID; validation details are centralized in [§15](#15-validation-rules).

### 3.1 Authentication & Session (AUTH)

**Purpose:** Authenticate users, maintain secure sessions, and terminate them safely.

| ID | Requirement |
|---|---|
| FR-AUTH-01 | The system MUST authenticate users with email + password and issue a short-lived JWT access token (15 min) plus a rotating refresh token (7 days) delivered as an `httpOnly`, `Secure`, `SameSite=Strict` cookie. |
| FR-AUTH-02 | The client MUST silently refresh an expired access token via the refresh endpoint and replay the original request once; on refresh failure the user is redirected to login. User input in open forms MUST NOT be discarded on auth errors. |
| FR-AUTH-03 | Logout MUST revoke the server-side refresh token and clear the session cookie. |
| FR-AUTH-04 | After 5 consecutive failed login attempts for an account, the account MUST lock for 15 minutes (BR-33). Lockouts are recorded as security events. |
| FR-AUTH-05 | Admin MUST be able to issue a password-reset token (single-use, 30-minute expiry) for any user; the user sets a new password via the reset flow and MUST change any temporary password on first login. |
| FR-AUTH-06 | Presenting an already-rotated refresh token MUST revoke the entire session family and record a security event (BR-35). |
| FR-AUTH-07 | Authorization MUST be evaluated per request against the user's current database record (role, active status); token claims are informational only (BR-34). |

- **Inputs:** email, password; refresh cookie; reset token + new password.
- **Outputs:** access token, session cookie, authenticated user profile; security events.
- **Dependencies:** `users`, `refreshTokens` collections (§10); SEC-01…SEC-05 (§14).
- **Success criteria:** valid credentials yield a working session ≤ 2 s; revoked/deactivated sessions are unusable within one request; no authentication path bypasses lockout or per-request checks.

### 3.2 User Management (USER)

**Purpose:** Admin-controlled provisioning and lifecycle of user accounts.

| ID | Requirement |
|---|---|
| FR-USER-01 | Admin MUST be able to create users with name, unique email, role (Admin/Staff), and a temporary password. Self-registration MUST NOT exist. |
| FR-USER-02 | Admin MUST be able to edit user name, role, and active status. Users are deactivated, never deleted (BR-29). |
| FR-USER-03 | The system MUST always retain ≥ 1 active Admin; the last active Admin cannot be deactivated or demoted, including by themselves (BR-30). The check MUST be atomic under concurrency. |
| FR-USER-04 | Deactivation or demotion MUST take effect immediately: all refresh tokens revoked; subsequent requests fail per FR-AUTH-07. |
| FR-USER-05 | Every user MUST be able to view/edit their own profile (name) and change their own password (current password required). |
| FR-USER-06 | The first Admin account and default settings MUST be provisioned by a documented, environment-variable-driven seed procedure. |

- **Inputs:** user attributes, role, status; own-profile edits.
- **Outputs:** user records; audit entries (§3.8); revocations.
- **Dependencies:** AUTH; `users`, `auditLogs` (§10); §5 matrix.
- **Success criteria:** Staff account operational immediately after creation; last-admin rule cannot be violated under any interleaving.

### 3.3 Product Management (PROD)

**Purpose:** Maintain the product catalog that all inventory operations reference.

| ID | Requirement |
|---|---|
| FR-PROD-01 | Admin MUST be able to create products with: name, SKU (unique, immutable; BR-01…04), optional barcode (unique when present; BR-05…07), category, description, cost price, selling price (BR-08…09), initial quantity, low-stock threshold, optional supplier info `{name, contactName?, phone?, email?}`, and 0–5 images. |
| FR-PROD-02 | A non-zero initial quantity MUST produce an `INITIAL` Transaction (BR-17). |
| FR-PROD-03 | Admin MUST be able to edit all product fields except SKU. Edits use optimistic concurrency (BR-24) and are recorded in the Audit Trail with before/after values. |
| FR-PROD-04 | Admin MUST be able to Archive a product (quantity must be 0; BR-21…22) and Restore it. Archived products remain visible in history with an "Archived" badge and reserve their SKU/barcode. |
| FR-PROD-05 | Hard Delete MUST be permitted only for products with zero Transactions, executed atomically with that check (BR-23), and MUST remove associated Cloudinary assets. |
| FR-PROD-06 | Product images: JPEG/PNG/WebP, ≤ 5 MB each, max 5 per product, one primary; uploads via backend-signed requests; replacing/removing an image deletes the Cloudinary asset; failed product saves destroy just-uploaded assets (BR-36…38). Images are never required; all UI renders a placeholder when absent. |
| FR-PROD-07 | Both roles MUST be able to view product lists and read-only product detail; all catalog writes are Admin-only (§5). |
| FR-PROD-08 | The system MUST render a printable, SKU-encoded QR label from product detail (client-rendered; no server dependency). |

- **Inputs:** product attributes, images, archive/restore commands.
- **Outputs:** product records, `INITIAL` Transactions, audit entries, signed upload parameters.
- **Dependencies:** CAT, INV, `products`/`counters` (§10), Cloudinary (§11).
- **Success criteria:** duplicate SKU/barcode is impossible (DB-enforced); archive/restore is lossless; no orphaned images accumulate.

### 3.4 Category Management (CAT)

**Purpose:** Flat product classification.

| ID | Requirement |
|---|---|
| FR-CAT-01 | Admin MUST be able to create/edit categories with a unique (case-insensitive) name and optional description (BR-26). |
| FR-CAT-02 | Category deletion MUST be blocked while any product (active or archived) references it; the UI offers bulk reassignment to another category or the system category **Uncategorized** (BR-27…28). The check is atomic with the delete. |
| FR-CAT-03 | Both roles view categories; writes are Admin-only. |

- **Dependencies:** PROD; `categories` (§10).
- **Success criteria:** no product can ever reference a nonexistent category.

### 3.5 Inventory Management (INV)

**Purpose:** All quantity-changing operations, with guaranteed ledger consistency.

| ID | Requirement |
|---|---|
| FR-INV-01 | Both roles MUST be able to perform **Stock In** (quantity 1–100,000, optional note) increasing product quantity. |
| FR-INV-02 | Both roles MUST be able to perform **Stock Out** (quantity 1–100,000, optional note). Stock Out MUST be an atomic conditional update (`quantity ≥ requested`); on failure the API returns `INSUFFICIENT_STOCK` with the current available quantity (BR-11…12). |
| FR-INV-03 | Admin MUST be able to perform **Adjustments**: signed delta or counted absolute value (system computes the delta), with a mandatory reason code — `DAMAGED`, `LOST`, `FOUND`, `COUNT_CORRECTION`, `RETURN`, `OTHER` (note required for `OTHER`) (BR-13). Negative adjustments obey the same conditional guard as Stock Out. |
| FR-INV-04 | Every quantity change — including manual corrections — MUST create an immutable Transaction; no code path mutates quantity without one (BR-17). "Manual quantity update" is a UI convenience over an Adjustment. |
| FR-INV-05 | The Transaction insert and product quantity update MUST occur in a single MongoDB multi-document transaction; partial state MUST never be observable (BR-19). Transient transaction conflicts are retried a bounded number of times server-side. |
| FR-INV-06 | Stock Movement requests MUST carry a client-generated idempotency key (sparse-unique on Transactions); replays with an identical payload return the original result; the same key with a different payload returns `IDEMPOTENCY_CONFLICT` (BR-20). |
| FR-INV-07 | Movements above a configurable warning threshold (default 1,000 units) MUST require explicit UI confirmation (BR-15). |
| FR-INV-08 | A scheduled reconciliation MUST compare each product's quantity to its ledger sum and surface any drift in the Admin Consistency report (BR-18). |

- **Inputs:** product reference, movement type, quantity/delta, reason code, note, idempotency key.
- **Outputs:** updated quantity, Transaction record.
- **Dependencies:** PROD, TXN; `transactions` (§10); REL requirements (§4).
- **Success criteria:** `product.quantity == Σ(signed Transaction quantities)` holds at all times and under all concurrent interleavings; no double-execution under retry.

### 3.6 Barcode & QR Scanning (SCAN)

**Purpose:** Camera-driven product lookup and fast Stock Movements.

| ID | Requirement |
|---|---|
| FR-SCAN-01 | The Scanner page MUST decode barcodes/QR codes via the device camera (ZXing) and MUST always offer a manual code-entry field as fallback. |
| FR-SCAN-02 | Lookup resolution order: exact `barcode` match, then exact SKU match (supports SKU-encoded QR labels). |
| FR-SCAN-03 | A successful lookup shows a product confirmation card (name, image, current quantity) from which the operator launches Stock In / Stock Out (both roles) or Adjustment (Admin). |
| FR-SCAN-04 | Unknown code: Admin is offered "Create product with this barcode" (pre-filled); Staff sees "Product not found — notify an administrator." |
| FR-SCAN-05 | A code resolving to an Archived product MUST be reported as archived (Admin sees a Restore action), never as "not found." |
| FR-SCAN-06 | Camera-permission-denied and no-camera states MUST show actionable guidance; scanning requires a secure (HTTPS) context. |
| FR-SCAN-07 | Scan payloads are untrusted input: validated (printable, ≤ 64 chars), sanitized, rendered escaped, never navigated to or executed (BR-16, SEC-07). Identical decodes within ~2 s are treated as one scan event. |

- **Success criteria:** scan-to-recorded-movement in ≤ 3 interactions on mobile; all failure states have a defined UI outcome.

### 3.7 Dashboard & Analytics (DASH)

**Purpose:** At-a-glance inventory health.

| ID | Requirement |
|---|---|
| FR-DASH-01 | The dashboard MUST show: total active products, total inventory value (BR-08), total units in stock, low-stock count and list, out-of-stock count and list, and the 10 most recent Transactions. |
| FR-DASH-02 | Charts (Recharts): stock-movement trend (in vs. out) and transaction volume over a selectable range of 7/30/90 days (server-validated parameter). |
| FR-DASH-03 | All metrics come from a single aggregate endpoint, server-cached 30–60 s; the UI displays the "as of" timestamp. |
| FR-DASH-04 | Low-stock and out-of-stock entries link directly to the product and to a pre-filled Stock In action. |

- **Dependencies:** INV, PROD; aggregation indexes (§10.9).
- **Success criteria:** dashboard renders within NFR-02 budgets at 10k products / 500k Transactions.

### 3.8 Transactions & Audit (TXN)

**Purpose:** Complete, immutable history of stock and administrative changes.

| ID | Requirement |
|---|---|
| FR-TXN-01 | Every Transaction records: product, type (`STOCK_IN`/`STOCK_OUT`/`ADJUSTMENT`/`INITIAL`), signed quantity delta, quantity-after, acting user, server timestamp, reason code (adjustments), note, and idempotency key (client-originated movements). |
| FR-TXN-02 | Transactions are append-only: no update or delete API exists; corrections are compensating Adjustments referencing the original Transaction ID (BR-17). |
| FR-TXN-03 | Both roles MUST be able to list/filter Transactions by date range, type, product, and user, with pagination (§3.9). Archived products render with a badge; an include/exclude-archived filter is provided. |
| FR-TXN-04 | An append-only **Audit Trail** MUST record create/update/archive/restore/delete on products, categories, users, and settings: actor, timestamp, entity, action, before/after values of changed fields. Admin-only, viewable as a tab of the Transactions page. |
| FR-TXN-05 | Security events (login success/failure, lockout, password reset, role change, deactivation, repeated 403s) MUST be recorded with actor, timestamp, source IP, and outcome, and are visible in the Audit Trail. |
| FR-TXN-06 | Timestamps and actor attribution are server-authoritative; client-supplied values for these fields MUST be ignored (BR-39). |

- **Success criteria:** any current quantity is fully explainable from the ledger; any price/role change is attributable.

### 3.9 Search, Filtering & Pagination (SRCH)

**Purpose:** Uniform list behavior across the application.

| ID | Requirement |
|---|---|
| FR-SRCH-01 | All list endpoints are paginated: default `limit=20`, maximum `limit=100`; no endpoint returns an unbounded array (reports paginate or stream CSV). |
| FR-SRCH-02 | Product search matches name, SKU, and barcode (case-insensitive, partial). Search input is debounced (~300 ms); all filtering/sorting/searching is server-side. |
| FR-SRCH-03 | Standard list response envelope: `{ data, page, limit, totalItems, totalPages }`. Sortable fields are enumerated per endpoint (§12); default sort `createdAt` descending. |
| FR-SRCH-04 | Product filters: category, stock status (in/low/out), archived state. Transaction filters: date range, type, product, user. |

### 3.10 Reports (RPT)

**Purpose:** Operational and audit reporting.

| ID | Requirement |
|---|---|
| FR-RPT-01 | **Inventory Summary** — per product: SKU, name, category, quantity, cost price, line value; totals row. Filter: category, stock status. |
| FR-RPT-02 | **Low Stock** — products at or below threshold, with threshold, quantity, and shortage. |
| FR-RPT-03 | **Transaction History** — ledger view over a mandatory date range (≤ 366 days), filterable by type/product/user. Derived exclusively from the ledger; re-running a past-period report yields identical results (BR-40). |
| FR-RPT-04 | **Product Performance** — per product movement totals (in/out/net) over a date range. |
| FR-RPT-05 | **Ledger Consistency** (Admin-only) — reconciliation results per FR-INV-08. |
| FR-RPT-06 | On-screen tables for both roles; **CSV export is Admin-only** (hidden in UI and enforced with 403 at the API). Reports state the timezone and that values use current cost. |

### 3.11 Settings (SET)

**Purpose:** System-wide configuration.

| ID | Requirement |
|---|---|
| FR-SET-01 | Admin MUST be able to configure: system currency (ISO 4217), default low-stock threshold (integer ≥ 0), and large-movement warning threshold. |
| FR-SET-02 | Settings is a seeded singleton (FR-USER-06); a missing settings document is a startup integrity failure. Changes are audited (FR-TXN-04). |

---

## 4. Non-Functional Requirements

### 4.1 Performance

| ID | Requirement |
|---|---|
| NFR-01 | API p95 response time < 500 ms for CRUD and list operations at reference volume (10,000 products / 500,000 Transactions). |
| NFR-02 | API p95 < 2 s for dashboard aggregates and reports. |
| NFR-03 | Frontend Largest Contentful Paint < 2.5 s on a mid-range mobile device over broadband. |
| NFR-04 | Per-request authorization lookup (FR-AUTH-07) is a single indexed point-read and is included in the NFR-01 budget; it MUST NOT be cached away. |
| NFR-05 | All filtering/sorting/search is server-side; list responses carry projection fields only (no full documents, no image binaries). |
| NFR-06 | Route-level code splitting: ZXing and Recharts bundles are lazy-loaded and MUST NOT be part of the login-path bundle. Thumbnails are served via Cloudinary transformations. Long tables use virtualized rendering. |
| NFR-07 | API responses are compressed (gzip/brotli); built frontend assets are hash-named and served with immutable cache headers. |
| NFR-08 | A pre-release load test MUST demonstrate NFR-01/02 at reference volume; hot-path queries MUST show index-backed plans (no collection scans). |

### 4.2 Scalability

| ID | Requirement |
|---|---|
| NFR-09 | The API tier is stateless: no server-local session state; any instance can serve any request; horizontal scaling requires configuration only. |
| NFR-10 | Every list endpoint enforces a hard `limit ≤ 100`; reports paginate or stream CSV. |
| NFR-11 | Dashboard aggregates are computed by a single aggregation-pipeline endpoint with a 30–60 s server-side cache (staleness surfaced in UI). |
| NFR-12 | Design volume: 10,000 products and 500,000 Transactions without degradation; Transaction growth math and a future cold-archival path are documented (§20). |

### 4.3 Availability

| ID | Requirement |
|---|---|
| NFR-13 | Availability target: 99.5% monthly (production Atlas tier and monitored hosting assumed — see §21). |
| NFR-14 | `GET /health` (liveness) and `GET /ready` (readiness incl. DB connectivity) endpoints exist and are unauthenticated. |
| NFR-15 | Deploys are rolling/blue-green, gated on `/ready`; documented rollback to the previous artifact in < 15 minutes. |
| NFR-16 | Degraded modes: Cloudinary outage never blocks Stock Movements (placeholders render, uploads fail gracefully); DB outage yields `/ready` failure, a maintenance banner, and no partial writes. |
| NFR-17 | Independent external uptime monitoring of frontend and API with alerting to a named contact. |

### 4.4 Reliability

| ID | Requirement |
|---|---|
| NFR-18 | Stock Movement writes are atomic multi-document MongoDB transactions (FR-INV-05); transient conflicts retried server-side with a bound. |
| NFR-19 | Stock Movement requests are idempotent via client keys (FR-INV-06). Clients auto-retry idempotent GETs only; mutations retry solely through the idempotency mechanism. |
| NFR-20 | All DB operations carry timeouts; requests fail within 10 s with `503` + `Retry-After` rather than hanging. Startup retries DB connection with backoff while `/ready` is negative; invalid configuration fails fast at boot instead. |
| NFR-21 | On SIGTERM the process drains in-flight requests before exit (graceful shutdown). |
| NFR-22 | Backups: Atlas daily snapshots (or continuous), RPO ≤ 24 h, RTO ≤ 4 h; restore is verified by a periodic documented drill to staging. |
| NFR-23 | Observability: structured JSON logs with levels and per-request correlation IDs (returned in error responses); request rate / p95 latency / error-rate metrics; error-tracking service on frontend and backend. No PII or secrets in logs. |

### 4.5 Security

Security requirements are specified in [§14](#14-security-requirements) (SEC-01…SEC-12) and are normative NFRs.

### 4.6 Maintainability

| ID | Requirement |
|---|---|
| NFR-24 | Backend layering is mandatory: routes → controllers (HTTP only) → services (all business rules) → models. Business logic in controllers or models is a defect. |
| NFR-25 | Frontend: API access only through a typed service layer (single Axios instance + interceptors); server state lives in designated Zustand stores only. |
| NFR-26 | Tests: unit tests covering ≥ 80% of business-rule code (every BR traceable to ≥ 1 test); API integration tests (ephemeral MongoDB) covering every endpoint's auth, validation, and error paths; an E2E smoke suite (login → add product → stock in → stock out → ledger check). CI blocks merge on failure. |
| NFR-27 | An OpenAPI 3 document is the normative machine-readable form of §12, kept in CI-verified sync; frontend types derive from it. |
| NFR-28 | All configuration via environment variables validated against a schema at boot (fail fast); `.env.example` enumerates every variable (§18.4). |
| NFR-29 | TypeScript strict mode (frontend); ESLint + Prettier enforced in CI on both tiers; ADRs recorded for load-bearing decisions (session model, ledger invariant, Archive lifecycle). |

### 4.7 Usability & Accessibility

| ID | Requirement |
|---|---|
| NFR-30 | WCAG 2.1 AA conformance; full keyboard operability; visible focus states; form errors announced to assistive technology. |
| NFR-31 | The Scanner page is usable one-handed on a mobile device; primary actions are reachable within thumb range. |
| NFR-32 | All destructive or irreversible actions require explicit confirmation naming the target. |
| NFR-33 | Timestamps are stored UTC and displayed in the browser's local timezone (BR-39). |

### 4.8 Browser Compatibility & Responsiveness

| ID | Requirement |
|---|---|
| NFR-34 | Supported: last 2 major versions of Chrome, Edge, Firefox, Safari (desktop and mobile). |
| NFR-35 | Camera scanning requires HTTPS (secure context) and a user gesture to start on iOS Safari; manual entry is the universal fallback. |
| NFR-36 | Responsive layouts for ≥ 360 px (mobile), ≥ 768 px (tablet), ≥ 1280 px (desktop); no horizontal page scroll; tables collapse or scroll within their own container on small screens. |

---

## 5. User Roles & Permissions

### 5.1 Roles

- **Admin** — full system control: catalog, users, settings, adjustments, exports, audit.
- **Staff** — floor operations: lookups, scanning, Stock In/Out, viewing dashboards/transactions/reports.

### 5.2 Permission Matrix

| Capability | Admin | Staff |
|---|:---:|:---:|
| Products — view (list & read-only detail) | ✔ | ✔ |
| Products — create / update | ✔ | ✖ |
| Products — archive / restore / hard delete | ✔ | ✖ |
| Product images — upload / remove | ✔ | ✖ |
| Categories — view | ✔ | ✔ |
| Categories — create / update / delete | ✔ | ✖ |
| Stock In / Stock Out | ✔ | ✔ |
| Adjustments (incl. manual quantity correction) | ✔ | ✖ |
| Transactions — view ledger | ✔ | ✔ |
| Audit Trail — view | ✔ | ✖ |
| Dashboard — view | ✔ | ✔ |
| Reports — view on-screen | ✔ | ✔ |
| Reports — CSV export | ✔ | ✖ |
| Ledger Consistency report | ✔ | ✖ |
| Users — create / edit / deactivate / role change / reset password | ✔ | ✖ |
| Settings — view / update | ✔ | ✖ |
| Own profile — view / edit / change own password | ✔ | ✔ |

### 5.3 Enforcement

1. This matrix is the single authority; [§9](#9-application-pages) page permissions and [§12](#12-rest-api-specification) endpoint roles derive from it verbatim.
2. Authorization is enforced **server-side on every request** against the user's current DB record (FR-AUTH-07). Client-side route guards are UX only, never the security boundary.
3. Staff navigation to an Admin route: client redirects to Dashboard with a notice; the server independently returns `403`. Repeated `403`s are recorded as security events (FR-TXN-05).
4. Role changes and deactivations take effect immediately (FR-USER-04).

---

## 6. Business Rules

### 6.1 SKU Rules

| ID | Rule |
|---|---|
| BR-01 | SKU is unique system-wide, compared case-insensitively. Uniqueness is enforced by a database unique index — client-side checks are advisory only; the API returns `409 DUPLICATE_SKU` on conflict (including creation races). |
| BR-02 | SKU format: uppercase alphanumeric plus hyphens, 3–32 characters. Input is trimmed and uppercased before validation and storage. |
| BR-03 | SKU is immutable after product creation (it appears on printed labels and historical records). |
| BR-04 | If left blank at creation, SKU is auto-generated as `<CATEGORY-PREFIX>-<sequence>` from an atomic counter, retrying transparently on collision. Archived products keep their SKU reserved; a hard-deleted product's SKU becomes reusable (safe: it has no ledger entries). |

### 6.2 Barcode Rules

| ID | Rule |
|---|---|
| BR-05 | Barcode is optional; when present it is unique (sparse unique index), stored trimmed, compared exactly. `409 DUPLICATE_BARCODE` errors identify the conflicting product (name + SKU) to enable mislabel resolution. |
| BR-06 | Scanner lookup precedence: exact barcode match, then exact SKU match (FR-SCAN-02). Ambiguity is impossible because both fields are unique. |
| BR-07 | A barcode resolving to an Archived product is reported as archived with its status — never "not found" (FR-SCAN-05). |

### 6.3 Pricing & Value Rules

| ID | Rule |
|---|---|
| BR-08 | Products carry `costPrice` and `sellingPrice`, both ≥ 0 with 2-decimal precision. Inventory Value = Σ(quantity × costPrice) over active products. |
| BR-09 | A single system-wide currency (Settings, ISO 4217) applies to all monetary values. No multi-currency in v1 (OS-7). |

### 6.4 Quantity & Stock Movement Rules

| ID | Rule |
|---|---|
| BR-10 | Product quantity is an integer ≥ 0 at all times, enforced at the schema level as defense-in-depth. Maximum product quantity: 10,000,000. |
| BR-11 | Stock Out and negative Adjustments execute as atomic conditional updates (`quantity ≥ requested`); on failure: `409 INSUFFICIENT_STOCK` including current available quantity. The server value is authoritative over any quantity displayed at form-render time. |
| BR-12 | Movement quantity: integer, 1 ≤ qty ≤ 100,000. Zero and negative movement quantities are invalid; direction derives from movement type, never from sign (the Adjustment delta is the sole signed input). |
| BR-13 | Adjustments require a reason code: `DAMAGED`, `LOST`, `FOUND`, `COUNT_CORRECTION`, `RETURN`, `OTHER` (+ mandatory note for `OTHER`). Counted-absolute mode cannot produce a negative result by construction. |
| BR-14 | Quantities are integer "units"; no fractional stock (OS-9). |
| BR-15 | Movements above the configured warning threshold (default 1,000) require explicit UI confirmation — guards against barcode-digits-scanned-into-quantity errors. |
| BR-16 | Scan payloads are opaque untrusted strings: printable characters, length ≤ 64, else `INVALID_BARCODE`; never navigated to or executed (SEC-07). |

### 6.5 Ledger & Transaction Rules

| ID | Rule |
|---|---|
| BR-17 | **Ledger invariant:** every quantity change creates an immutable Transaction; `product.quantity == Σ(signed Transaction quantities)` always. Non-zero initial stock produces an `INITIAL` Transaction. Transactions are append-only; corrections are compensating Adjustments referencing the original Transaction. |
| BR-18 | A scheduled reconciliation compares each product's quantity to its ledger sum; drift is surfaced in the Admin Ledger Consistency report. |
| BR-19 | The Transaction insert and quantity update are one atomic multi-document transaction; partial state is never observable. |
| BR-20 | Client-originated movements carry an idempotency key (sparse-unique). Replay with identical payload → original result. Same key, different payload → `422 IDEMPOTENCY_CONFLICT`. System-originated Transactions (`INITIAL`, compensations) carry no key. |

### 6.6 Product Lifecycle Rules

| ID | Rule |
|---|---|
| BR-21 | A product with ≥ 1 Transaction can only be Archived, never hard-deleted. |
| BR-22 | Archiving requires quantity = 0, checked as a conditional predicate inside the archive write (a concurrent movement aborts one of the two operations). Archived products are hidden from active lists, excluded from dashboard totals, render with a badge in history, and are restorable by Admin. |
| BR-23 | Hard Delete: only for products with zero Transactions; the zero-transaction check and the delete execute atomically; associated Cloudinary assets are removed. |
| BR-24 | Product updates use optimistic concurrency (document version); a stale write returns `409 STALE_WRITE` prompting refresh-and-reapply. Movements are unaffected (they never write catalog fields). |
| BR-25 | Dashboard/report visibility of a just-archived product may lag by the aggregate cache TTL (≤ 60 s) — an accepted, stated staleness bound. |

### 6.7 Category Rules

| ID | Rule |
|---|---|
| BR-26 | Category names are unique (case-insensitive); taxonomy is flat (no nesting) in v1. |
| BR-27 | Category deletion is blocked while any product — active or archived — references it: `409 CATEGORY_IN_USE`. The reference check and delete are atomic against concurrent product assignment. |
| BR-28 | The system category **Uncategorized** always exists and cannot be deleted; bulk reassignment targets it by default. |

### 6.8 User & Authentication Rules

| ID | Rule |
|---|---|
| BR-29 | Users are deactivated, never deleted; historical attribution is preserved forever. |
| BR-30 | ≥ 1 active Admin must exist at all times. The check is atomic under concurrency (`409 LAST_ADMIN` on violation). Self-deactivation/self-demotion is allowed only when not the last active Admin, requires explicit confirmation, and immediately revokes the user's own sessions. |
| BR-31 | All accounts are Admin-provisioned (no self-registration). Temporary passwords must be changed at first login. |
| BR-32 | Password policy: ≥ 10 characters, at least one letter and one digit, checked against a common-password deny-list. Passwords hashed with bcrypt, cost factor 12. |
| BR-33 | Account lockout: 5 consecutive failures → 15-minute lock (`423 ACCOUNT_LOCKED`); lockout events are security events. |
| BR-34 | Authorization uses the per-request DB record; a deactivated user's structurally-valid token yields `401 ACCOUNT_DEACTIVATED`; a demoted Admin's privileged call yields `403`. |
| BR-35 | Refresh tokens rotate on use; reuse of a rotated token revokes the whole session family and records a security event. Token validation is server-authoritative with ≤ 30 s clock-skew leeway. No idle timeout beyond token TTLs (see §21). |

### 6.9 Image Rules

| ID | Rule |
|---|---|
| BR-36 | Images: JPEG/PNG/WebP, ≤ 5 MB, ≤ 5 per product, one primary; validated by MIME type and magic bytes; uploaded only via backend-signed requests. |
| BR-37 | Images are never required (0 images is valid); every image slot renders a deterministic placeholder when absent or on load error (externally-deleted assets degrade gracefully). |
| BR-38 | No orphaned assets: replacing/removing an image destroys the Cloudinary asset; a failed product save destroys just-uploaded assets; a periodic sweep removes unattached uploads older than 24 h. |

### 6.10 Cross-Cutting Rules

| ID | Rule |
|---|---|
| BR-39 | Timestamps and actor attribution are server-authoritative (UTC storage, local display); client-supplied values for these fields are ignored. |
| BR-40 | Historical reports derive exclusively from the ledger, never from mutable current state; re-running a past-period report yields identical results. Monetary values in reports use current cost and say so. |
| BR-41 | Settings is a seeded singleton; its absence is a startup integrity failure, not a runtime default. |

---

## 7. Use Cases

Fourteen use cases cover the system. Error codes referenced here are defined in [§16.3](#16-error-handling-strategy).

### UC-01 — Log In

| | |
|---|---|
| **Actor** | Admin, Staff |
| **Description** | Authenticate and establish a session. |
| **Preconditions** | Active account exists; user is not authenticated. |
| **Main Flow** | 1. User opens Login page. 2. Enters email + password, submits. 3. System validates credentials, resets the failure counter, issues access token + refresh cookie, records a security event. 4. User lands on Dashboard. |
| **Alternate Flows** | A1: Temporary/reset password → user is forced into the change-password step before proceeding (FR-AUTH-05). |
| **Exceptions** | E1: Invalid credentials → generic error, failure counter incremented. E2: 5th consecutive failure → `ACCOUNT_LOCKED` (15 min). E3: Deactivated account → `ACCOUNT_DEACTIVATED`. |
| **Postconditions** | Valid session established; security event recorded. |

### UC-02 — Log Out / Session Expiry

| | |
|---|---|
| **Actor** | Admin, Staff |
| **Description** | End a session deliberately or by expiry. |
| **Preconditions** | Authenticated session. |
| **Main Flow** | 1. User selects Logout. 2. System revokes the refresh token, clears the cookie. 3. Client clears state and returns to Login. |
| **Alternate Flows** | A1: Access token expires mid-use → silent refresh + single replay of the original request; user input preserved (FR-AUTH-02). A2: Refresh fails → forced re-login; unsaved form state preserved best-effort through the redirect. |
| **Exceptions** | E1: Rotated-token reuse detected → session family revoked, security event (FR-AUTH-06). |
| **Postconditions** | No usable tokens remain for the ended session. |

### UC-03 — Reset a User's Password

| | |
|---|---|
| **Actor** | Admin (initiator), any user (completer) |
| **Description** | Recover access for a user who lost their password. |
| **Preconditions** | Admin authenticated; target account exists and is active. |
| **Main Flow** | 1. Admin opens the user in Users page, triggers "Reset password". 2. System generates a single-use token (30-min expiry), revokes the user's sessions, records audit + security events. 3. Admin conveys the reset link out-of-band (no email service in v1 — see §21). 4. User opens the link, sets a new password meeting BR-32. 5. User logs in. |
| **Alternate Flows** | A1: User changes their own known password via Profile (current password required). |
| **Exceptions** | E1: Expired/used token → error with instruction to request a new reset. |
| **Postconditions** | New password active; all prior sessions revoked; events recorded. |

### UC-04 — Manage Users

| | |
|---|---|
| **Actor** | Admin |
| **Description** | Create, edit, deactivate/reactivate users; change roles. |
| **Preconditions** | Admin authenticated. |
| **Main Flow** | 1. Admin opens Users page. 2. Creates a user (name, unique email, role, temporary password) or edits an existing one. 3. System validates, persists, records audit entry. |
| **Alternate Flows** | A1: Deactivation → all target-user sessions revoked immediately (FR-USER-04). A2: Reactivation restores login ability. |
| **Exceptions** | E1: Duplicate email → validation error. E2: Action would remove the last active Admin → `LAST_ADMIN` (atomic check, incl. concurrent attempts and self-demotion). |
| **Postconditions** | User lifecycle state consistent; audit trail updated. |

### UC-05 — Add Product

| | |
|---|---|
| **Actor** | Admin |
| **Description** | Create a catalog product, optionally with initial stock and images. |
| **Preconditions** | Admin authenticated; ≥ 1 category exists (Uncategorized always does). |
| **Main Flow** | 1. Admin opens Add Product. 2. Enters fields per FR-PROD-01 (SKU manual or blank for auto-generation). 3. Optionally uploads images (backend-signed). 4. Submits. 5. System validates, normalizes SKU (BR-02), persists product; non-zero initial quantity creates an `INITIAL` Transaction atomically (BR-17/19); audit entry recorded. 6. UI confirms and navigates to the product. |
| **Alternate Flows** | A1: Entry via Scanner "Create product with this barcode" → form pre-filled with the scanned code (FR-SCAN-04). |
| **Exceptions** | E1: `DUPLICATE_SKU` / `DUPLICATE_BARCODE` (conflict details shown). E2: Image upload fails → product may be saved without it (BR-37); failed-save uploads are destroyed (BR-38). E3: Validation errors per §15.2. |
| **Postconditions** | Product exists; ledger and audit consistent. |

### UC-06 — Edit Product

| | |
|---|---|
| **Actor** | Admin |
| **Description** | Modify catalog fields (not SKU, not quantity). |
| **Preconditions** | Admin authenticated; product exists (active). |
| **Main Flow** | 1. Admin opens product Edit. 2. Changes fields (prices, category, threshold, supplier, images, barcode…). 3. Submits with the document version (BR-24). 4. System validates, persists, records audit entry with before/after values. |
| **Alternate Flows** | A1: Quantity correction attempted here → UI routes to Adjustment (UC-09); direct quantity edit does not exist (BR-17). |
| **Exceptions** | E1: `STALE_WRITE` → refresh and reapply. E2: `DUPLICATE_BARCODE`. E3: Category no longer exists → validation error. |
| **Postconditions** | Product updated; every changed field auditable. |

### UC-07 — Archive / Restore / Hard Delete Product

| | |
|---|---|
| **Actor** | Admin |
| **Description** | Remove a product from active use, reversibly or permanently. |
| **Preconditions** | Admin authenticated. Archive: quantity = 0. Hard delete: zero Transactions. |
| **Main Flow (Archive)** | 1. Admin selects Archive, confirms (NFR-32). 2. System archives with an atomic quantity-=-0 predicate (BR-22); audit entry recorded. 3. Product leaves active lists; SKU/barcode remain reserved. |
| **Alternate Flows** | A1: Restore → product returns to active state losslessly. A2: Hard delete (zero-Transaction products only) → atomic check + delete; Cloudinary assets removed (BR-23). A3: Non-zero quantity at archive → UI prompts for a final Adjustment first. |
| **Exceptions** | E1: Concurrent movement lands during archive → one operation fails with `409` (BR-22). E2: Transaction created between check and hard delete → delete aborts (BR-23). |
| **Postconditions** | Lifecycle state consistent; history intact; no orphaned assets. |

### UC-08 — Stock In / Stock Out

| | |
|---|---|
| **Actor** | Admin, Staff |
| **Description** | Record received or dispatched stock. |
| **Preconditions** | Authenticated; product exists and is active. |
| **Main Flow** | 1. Operator opens the Stock Movement dialog (from Products row, Scanner card, or Dashboard quick action). 2. Selects type (In/Out), enters quantity (1–100,000), optional note. 3. Client attaches an idempotency key and submits. 4. System executes the atomic conditional update + Transaction insert in one DB transaction (BR-11/17/19/20). 5. UI shows the new quantity. |
| **Alternate Flows** | A1: Quantity above warning threshold → explicit confirmation (BR-15). A2: Network timeout → client retries with the same key; committed work is not repeated (BR-20). |
| **Exceptions** | E1: `INSUFFICIENT_STOCK` (with current available). E2: `IDEMPOTENCY_CONFLICT` (client bug). E3: `PRODUCT_ARCHIVED`. E4: DB unavailable → `SERVICE_UNAVAILABLE`, no partial write. |
| **Postconditions** | Quantity and ledger updated atomically; movement attributed and timestamped. |

### UC-09 — Adjust Inventory

| | |
|---|---|
| **Actor** | Admin |
| **Description** | Correct quantity with a reason (damage, loss, count, return…). |
| **Preconditions** | Admin authenticated; product active. |
| **Main Flow** | 1. Admin opens Adjustment (product actions or Scanner card). 2. Chooses mode: signed delta or counted absolute (system computes delta). 3. Selects reason code (note required for `OTHER`), submits with idempotency key. 4. System applies BR-11/13/17/19/20 and records the `ADJUSTMENT` Transaction. |
| **Alternate Flows** | A1: Compensating correction of an earlier movement → adjustment references the original Transaction ID (BR-17). |
| **Exceptions** | E1: Negative result → `INSUFFICIENT_STOCK`. E2: Missing/invalid reason → validation error. |
| **Postconditions** | Ledger explains the correction with attribution and reason. |

### UC-10 — Scan-Driven Lookup & Movement

| | |
|---|---|
| **Actor** | Admin, Staff |
| **Description** | Use the camera (or manual entry) to find a product and act on it. |
| **Preconditions** | Authenticated; HTTPS context. |
| **Main Flow** | 1. Operator opens Scanner. 2. Grants camera permission; ZXing decodes a code (double-reads within ~2 s coalesce). 3. System validates the payload (BR-16), resolves barcode-then-SKU (BR-06). 4. Product card shows name, image, quantity. 5. Operator launches Stock In/Out (→ UC-08) or Adjustment (Admin, → UC-09). |
| **Alternate Flows** | A1: Camera denied/unavailable → guidance + manual entry field (FR-SCAN-01/06). A2: Unknown code → Admin: pre-filled create (UC-05); Staff: "notify an administrator" (FR-SCAN-04). A3: Archived product → archived status shown; Admin may Restore (FR-SCAN-05). |
| **Exceptions** | E1: `INVALID_BARCODE` (malformed/oversized payload). |
| **Postconditions** | Lookup resolved to a defined outcome; any movement follows UC-08/09 guarantees. |

### UC-11 — Review Dashboard

| | |
|---|---|
| **Actor** | Admin, Staff |
| **Description** | Monitor inventory health and recent activity. |
| **Preconditions** | Authenticated. |
| **Main Flow** | 1. User opens Dashboard. 2. Single aggregate call returns metrics, alerts, recent Transactions, chart data for the selected range (7/30/90 d). 3. User drills into low/out-of-stock items → product or pre-filled Stock In. |
| **Alternate Flows** | A1: Cached data served (≤ 60 s old) with "as of" timestamp (BR-25). |
| **Exceptions** | E1: Aggregate failure → cards show error states individually; navigation remains functional. |
| **Postconditions** | None (read-only). |

### UC-12 — Generate / Export Report

| | |
|---|---|
| **Actor** | Admin, Staff (view); Admin (export) |
| **Description** | Produce operational reports; export CSV. |
| **Preconditions** | Authenticated; for Transaction History a date range ≤ 366 days. |
| **Main Flow** | 1. User opens Reports, picks a report and filters. 2. System renders a paginated on-screen table (ledger-derived where historical, BR-40). 3. Admin optionally exports CSV (streamed). |
| **Alternate Flows** | A1: Admin opens Ledger Consistency report → reconciliation results with any drift flagged (FR-RPT-05). |
| **Exceptions** | E1: Invalid/oversized date range → validation error. E2: Staff export attempt → control hidden and API returns `403`. |
| **Postconditions** | None (read-only); exports contain exactly the on-screen dataset. |

### UC-13 — Review Transactions & Audit Trail

| | |
|---|---|
| **Actor** | Admin, Staff (ledger); Admin (audit tab) |
| **Description** | Inspect movement history and administrative changes. |
| **Preconditions** | Authenticated. |
| **Main Flow** | 1. User opens Transactions. 2. Filters ledger by date/type/product/user; archived products render badged. 3. Admin switches to the Audit Trail tab: entity changes with before/after values and security events. |
| **Alternate Flows** | A1: Deep link from a product detail → pre-filtered to that product. |
| **Exceptions** | E1: Invalid filter combination → validation error. |
| **Postconditions** | None (read-only; both stores are append-only). |

### UC-14 — Configure Settings

| | |
|---|---|
| **Actor** | Admin |
| **Description** | Maintain system-wide configuration. |
| **Preconditions** | Admin authenticated; settings singleton exists (BR-41). |
| **Main Flow** | 1. Admin opens Settings. 2. Edits currency, default low-stock threshold, movement warning threshold. 3. System validates (§15.8), persists, records audit entry. |
| **Alternate Flows** | — |
| **Exceptions** | E1: Invalid currency code / negative threshold → validation error. |
| **Postconditions** | New defaults apply to subsequent operations; change audited. |

---

## 8. User Flow

Text-based flow diagrams. `-->` = user/system action; `[?]` = decision; `(!)` = exception path. "Recording the Transaction" is not a separate flow — it is the mandatory ledger-write step inside every movement flow (BR-17), marked `«ledger»` below.

### 8.1 Login

```text
Login Page
  --> enter email + password --> submit
  [?] credentials valid?
      no  (!) show generic error, increment failure counter
            [?] 5th consecutive failure? --> yes: ACCOUNT_LOCKED (15 min)
      yes [?] account active?
            no  (!) ACCOUNT_DEACTIVATED
            yes [?] temporary/reset password?
                  yes --> forced Change Password --> Dashboard
                  no  --> issue access token + refresh cookie --> Dashboard
```

### 8.2 Logout & Session Expiry

```text
Any page --> user clicks Logout
  --> server revokes refresh token, clears cookie --> Login Page

Any API call --> 401 (access token expired)
  --> client silently calls /auth/refresh
  [?] refresh ok?
      yes --> replay original request once --> continue (form input preserved)
      no  (!) preserve unsaved form state (best effort) --> Login Page
```

### 8.3 Password Reset

```text
Users Page (Admin) --> select user --> "Reset password"
  --> system: single-use token (30 min), revoke user sessions, audit + security event
  --> Admin delivers link out-of-band
User opens link --> Reset Password page --> new password (policy BR-32)
  [?] token valid & unused?
      no  (!) error --> request new reset
      yes --> password saved --> Login
```

### 8.4 Add Product

```text
Products Page (Admin) --> "Add Product"
  --> fill form (name, SKU [blank = auto], barcode?, category, prices,
      initial qty, threshold, supplier?, images 0–5)
  --> upload images via backend-signed request (optional)
  --> submit
  [?] validation passes?  no (!) inline field errors
  [?] SKU/barcode unique? no (!) 409 with conflicting product shown
  yes --> save product
       [?] initial qty > 0? --> yes: «ledger» INITIAL Transaction (atomic)
       --> audit entry --> Product Detail
```

### 8.5 Stock In

```text
Entry: Products row action | Scanner card | Dashboard quick action
  --> Stock Movement dialog (type = STOCK_IN)
  --> enter quantity (1–100,000), note?
  [?] qty > warning threshold? --> yes: explicit confirmation
  --> submit with idempotency key
  --> server: atomic [update quantity + «ledger» STOCK_IN Transaction]
  --> UI shows new quantity
  (!) network timeout --> retry with SAME key --> original result returned
```

### 8.6 Stock Out

```text
Entry: Products row action | Scanner card | Dashboard quick action
  --> Stock Movement dialog (type = STOCK_OUT)
  --> enter quantity, note? --> submit with idempotency key
  --> server: conditional atomic update (quantity >= requested)
  [?] sufficient stock?
      no  (!) INSUFFICIENT_STOCK + current available --> operator adjusts input
      yes --> «ledger» STOCK_OUT Transaction (same DB transaction)
           --> UI shows new quantity
```

### 8.7 Adjustment (Admin)

```text
Entry: Product actions | Scanner card (Admin only)
  --> Adjustment dialog
  --> choose mode: signed delta | counted absolute (system computes delta)
  --> select reason code (note required for OTHER) --> submit with idempotency key
  [?] result would be < 0? (!) INSUFFICIENT_STOCK
  yes --> atomic [update + «ledger» ADJUSTMENT Transaction] --> confirmation
```

### 8.8 Barcode / QR Scan

```text
Scanner Page
  [?] camera available & permitted?
      no  (!) guidance + Manual Entry field (always present)
      yes --> ZXing decodes (duplicate reads < 2 s coalesced)
  --> validate payload (printable, <= 64 chars)  (!) INVALID_BARCODE
  --> lookup: exact barcode --> else exact SKU
  [?] product found?
      no  (!) Admin: "Create product with this barcode" (pre-filled UC-05)
           Staff: "Product not found — notify an administrator"
      yes [?] archived?
            yes (!) show archived status; Admin may Restore
            no  --> Product card (name, image, qty)
                 --> Stock In | Stock Out | Adjustment (Admin) --> flows 8.5–8.7
```

### 8.9 Archive Product (Admin)

```text
Product Detail --> "Archive"
  [?] quantity == 0?
      no  (!) prompt final Adjustment (8.7) first
      yes --> confirmation naming the product
           --> atomic archive (predicate qty == 0) --> audit entry
           --> product leaves active lists (SKU/barcode stay reserved)
```

### 8.10 Dashboard

```text
Login success --> Dashboard
  --> single aggregate call (cache <= 60 s, "as of" shown)
  --> cards: total products | inventory value | units in stock
             low-stock list | out-of-stock list | recent 10 Transactions
  --> charts: movement trend + volume [range: 7 | 30 | 90 days]
  --> click low-stock item --> Product Detail | pre-filled Stock In (8.5)
```

### 8.11 Simple Page Interactions (no diagram required)

Category CRUD, report generation, user creation, settings edits, and profile changes are single-form page interactions covered by UC-04/12/14 and §9; their absence here is a documented decision, not an omission.

---

## 9. Application Pages

All pages share the authenticated layout (sidebar navigation, top bar with user menu) except Login and Reset Password. Page access derives from the [§5 matrix](#5-user-roles--permissions); the server re-enforces every action regardless of page visibility.

### 9.1 Login Page

| | |
|---|---|
| **Route / Access** | `/login` — public (unauthenticated only) |
| **Purpose** | Authenticate users. |
| **Components** | Email + password fields, submit, lockout/deactivation error states, forced change-password step. |
| **Data** | None on load. |
| **Actions** | Log in (UC-01). |
| **Navigation** | → Dashboard on success. |

### 9.2 Reset Password Page

| | |
|---|---|
| **Route / Access** | `/reset-password?token=…` — public via valid token |
| **Purpose** | Complete an Admin-initiated password reset (UC-03). |
| **Components** | New password + confirmation, policy hints, token-invalid state. |
| **Actions** | Set password → redirect to Login. |

### 9.3 Dashboard

| | |
|---|---|
| **Route / Access** | `/` — Admin, Staff |
| **Purpose** | Inventory health overview (UC-11). |
| **Components** | Metric cards (products, inventory value, units), low-stock list, out-of-stock list, recent-Transactions table, Recharts trend + volume charts with 7/30/90-day selector, "as of" timestamp, quick action: New Movement. |
| **Data** | `GET /dashboard/summary?range=` (single call). |
| **Actions** | Drill into products; pre-filled Stock In; open Scanner. |
| **Navigation** | Entry page after login. |

### 9.4 Products Page

| | |
|---|---|
| **Route / Access** | `/products` — Admin, Staff |
| **Purpose** | Browse/search the catalog. |
| **Components** | Debounced search (name/SKU/barcode), filters (category, stock status, archived — archived filter Admin-only), sortable paginated table (thumbnail, name, SKU, category, qty, status badge, prices\*), row actions. (\*prices visible to both roles; all writes Admin-only.) |
| **Data** | `GET /products` with query params. |
| **Actions** | Both roles: open detail, Stock In/Out (movement dialog). Admin: add, edit, archive/restore, adjustment, hard delete (eligible rows only). |
| **Navigation** | → Product Detail, Add/Edit Product. |

### 9.5 Product Detail (role-conditional)

| | |
|---|---|
| **Route / Access** | `/products/:id` — Admin, Staff (read-only for Staff) |
| **Purpose** | Full product view; hub for product actions. |
| **Components** | Image gallery (placeholder-safe), all catalog fields, supplier info, quantity + status, printable SKU-encoded QR label (client-rendered), per-product recent Transactions, archived badge/state. |
| **Data** | `GET /products/:id`; `GET /transactions?productId=…`. |
| **Actions** | Both: Stock In/Out, print label. Admin: edit, adjustment, archive/restore. |

### 9.6 Add Product Page

| | |
|---|---|
| **Route / Access** | `/products/new` — Admin |
| **Purpose** | Create a product (UC-05); supports barcode pre-fill from Scanner. |
| **Components** | Form per FR-PROD-01, image uploader (0–5, primary selector), validation per §15.2. |
| **Data** | `GET /categories` for the selector. |
| **Actions** | Save → Product Detail; cancel. |

### 9.7 Edit Product Page

| | |
|---|---|
| **Route / Access** | `/products/:id/edit` — Admin |
| **Purpose** | Modify catalog fields (UC-06). SKU displayed read-only; quantity absent (adjustments only). |
| **Components** | Same form as Add minus SKU/initial-qty; version token for optimistic concurrency; stale-write recovery UI. |
| **Actions** | Save, cancel; manage images. |

### 9.8 Scanner Page

| | |
|---|---|
| **Route / Access** | `/scanner` — Admin, Staff |
| **Purpose** | Camera lookup and fast movements (UC-10). |
| **Components** | Camera viewport (ZXing), torch toggle where supported, **always-visible manual entry field**, permission/no-camera guidance states, product confirmation card, movement buttons (Adjustment shown to Admin only), unknown-code and archived-product states. |
| **Data** | `GET /products/lookup?code=…`. |
| **Actions** | Scan/enter code; launch UC-08/09; Admin: create-from-barcode. |

### 9.9 Categories Page

| | |
|---|---|
| **Route / Access** | `/categories` — Admin, Staff (read-only for Staff) |
| **Purpose** | Maintain the flat taxonomy. |
| **Components** | Table (name, description, product count), create/edit modal, delete flow with reassignment picker (default: Uncategorized). |
| **Data** | `GET /categories?withCounts=true`. |
| **Actions** | Admin: create, edit, delete-with-reassign. |

### 9.10 Transactions Page

| | |
|---|---|
| **Route / Access** | `/transactions` — Admin, Staff; **Audit Trail tab Admin-only** |
| **Purpose** | Ledger and administrative history (UC-13). |
| **Components** | Tab 1 *Stock Ledger*: paginated table (timestamp, product [badged if archived], type, qty delta, qty after, user, reason/note), filters (date range, type, product, user, include-archived). Tab 2 *Audit Trail* (Admin): entity changes with before/after diff, security events, filters. |
| **Data** | `GET /transactions`; `GET /audit-logs`. |
| **Actions** | Filter, paginate, deep-link from products. |

### 9.11 Reports Page

| | |
|---|---|
| **Route / Access** | `/reports` — Admin, Staff (export + Consistency: Admin) |
| **Purpose** | Operational reporting (UC-12). |
| **Components** | Report selector (Inventory Summary, Low Stock, Transaction History, Product Performance; + Ledger Consistency for Admin), filter panel (date range mandatory ≤ 366 d for history), paginated result table with totals, CSV export button (Admin), timezone note. |
| **Data** | `GET /reports/*`. |
| **Actions** | Generate; Admin: export CSV. |

### 9.12 Users Page

| | |
|---|---|
| **Route / Access** | `/users` — Admin |
| **Purpose** | Account lifecycle management (UC-04). |
| **Components** | User table (name, email, role, status, last login), create/edit modal, deactivate/reactivate with confirmation, role selector, reset-password action with link display, last-admin guard messaging. |
| **Data** | `GET /users`. |
| **Actions** | Create, edit, deactivate/reactivate, change role, trigger reset. |

### 9.13 Settings Page

| | |
|---|---|
| **Route / Access** | `/settings` — Admin |
| **Purpose** | System configuration (UC-14). |
| **Components** | Currency selector (ISO 4217), default low-stock threshold, movement warning threshold; save with confirmation. |
| **Data** | `GET /settings`. |
| **Actions** | Update settings (audited). |

### 9.14 Profile Page

| | |
|---|---|
| **Route / Access** | `/profile` — Admin, Staff |
| **Purpose** | Own account maintenance. |
| **Components** | Name editor, email (read-only), role display, change-password form (current + new + confirm). |
| **Data** | `GET /users/me`. |
| **Actions** | Update name; change password (revokes other sessions). |

---

## 10. Database Design

MongoDB Atlas via Mongoose. All collections carry `createdAt` / `updatedAt` (Mongoose timestamps, UTC). Monetary values are stored as `Decimal128` with 2-decimal precision. `ObjectId` references are validated at the service layer within the same transaction where consistency matters.

### 10.1 `users`

**Purpose:** Accounts, roles, lifecycle, and lockout state.

| Field | Type | Required | Validation / Notes |
|---|---|---|---|
| `_id` | ObjectId | auto | |
| `name` | String | ✔ | 2–80 chars, trimmed |
| `email` | String | ✔ | valid email, lowercased, **unique** |
| `passwordHash` | String | ✔ | bcrypt cost 12; never serialized to API responses |
| `role` | String | ✔ | enum `ADMIN` \| `STAFF` |
| `isActive` | Boolean | ✔ | default `true`; deactivation = `false` (BR-29) |
| `mustChangePassword` | Boolean | ✔ | default `true` for provisioned/temporary passwords |
| `failedLoginCount` | Number | ✔ | default 0 |
| `lockedUntil` | Date | — | set on 5th failure (BR-33) |
| `resetToken` | String (hash) | — | single-use, sparse |
| `resetTokenExpiresAt` | Date | — | 30 min after issue |
| `lastLoginAt` | Date | — | |

**Indexes:** `{ email: 1 }` unique · `{ role: 1, isActive: 1 }` (last-admin check).

### 10.2 `categories`

**Purpose:** Flat product taxonomy.

| Field | Type | Required | Validation / Notes |
|---|---|---|---|
| `name` | String | ✔ | 2–60 chars, **unique case-insensitive** (collation) |
| `description` | String | — | ≤ 300 chars |
| `isSystem` | Boolean | ✔ | `true` only for **Uncategorized** (undeletable, BR-28) |

**Indexes:** `{ name: 1 }` unique with case-insensitive collation.

### 10.3 `products`

**Purpose:** Catalog; `quantity` is the ledger-derived current stock (BR-17).

| Field | Type | Required | Validation / Notes |
|---|---|---|---|
| `name` | String | ✔ | 2–120 chars |
| `sku` | String | ✔ | BR-02 format; **unique**; stored uppercase; immutable (BR-03) |
| `barcode` | String | — | trimmed, ≤ 64 chars; **sparse unique** (BR-05) |
| `description` | String | — | ≤ 2,000 chars |
| `categoryId` | ObjectId → categories | ✔ | must reference an existing category |
| `costPrice` | Decimal128 | ✔ | ≥ 0, 2 dp (BR-08) |
| `sellingPrice` | Decimal128 | ✔ | ≥ 0, 2 dp |
| `quantity` | Number (int) | ✔ | ≥ 0 (schema `min: 0`, BR-10); mutated only inside movement transactions |
| `lowStockThreshold` | Number (int) | ✔ | ≥ 0; default from settings (B4) |
| `supplier` | Subdocument | — | `{ name (≤120), contactName?, phone?, email? }` (OS-2 migration path in §20) |
| `images` | Array (≤ 5) | — | `[{ publicId, url, isPrimary }]`; exactly one `isPrimary` when non-empty |
| `isArchived` | Boolean | ✔ | default `false` (BR-21…22) |
| `version` | Number | ✔ | optimistic concurrency token (BR-24) |

**Indexes:** `{ sku: 1 }` unique · `{ barcode: 1 }` unique+sparse · `{ categoryId: 1 }` · `{ isArchived: 1, quantity: 1 }` (low/out-of-stock queries) · text/prefix index on `name` + `sku` + `barcode` (search).

### 10.4 `transactions`

**Purpose:** Append-only stock ledger (BR-17). **No update/delete operations exist against this collection.**

| Field | Type | Required | Validation / Notes |
|---|---|---|---|
| `productId` | ObjectId → products | ✔ | |
| `type` | String | ✔ | enum `STOCK_IN` \| `STOCK_OUT` \| `ADJUSTMENT` \| `INITIAL` |
| `quantityChange` | Number (int) | ✔ | signed delta; ≠ 0 |
| `quantityAfter` | Number (int) | ✔ | ≥ 0; snapshot after application |
| `userId` | ObjectId → users | ✔ | server-derived from the authenticated context (BR-39) |
| `reason` | String | cond. | required when `type = ADJUSTMENT`; enum per BR-13 |
| `note` | String | cond. | ≤ 500 chars; required when `reason = OTHER` |
| `refTransactionId` | ObjectId → transactions | — | set on compensating Adjustments (BR-17) |
| `idempotencyKey` | String | — | client-originated movements; **sparse unique** (BR-20) |
| `createdAt` | Date | ✔ | server clock, UTC; immutable |

**Indexes:** `{ productId: 1, createdAt: -1 }` · `{ createdAt: -1 }` · `{ userId: 1, createdAt: -1 }` · `{ idempotencyKey: 1 }` unique+sparse.

### 10.5 `refreshTokens`

**Purpose:** Server-side session store enabling rotation, revocation, and reuse detection (BR-35).

| Field | Type | Required | Notes |
|---|---|---|---|
| `userId` | ObjectId → users | ✔ | |
| `tokenHash` | String | ✔ | hashed; raw token only in the cookie |
| `familyId` | String | ✔ | rotation family; reuse revokes the family |
| `expiresAt` | Date | ✔ | TTL index target (7 d) |
| `revokedAt` / `rotatedAt` | Date | — | lifecycle markers |
| `ip`, `userAgent` | String | — | security event context |

**Indexes:** `{ tokenHash: 1 }` unique · `{ userId: 1 }` · `{ familyId: 1 }` · TTL on `expiresAt`.

### 10.6 `auditLogs`

**Purpose:** Append-only entity-change and security-event record (FR-TXN-04/05).

| Field | Type | Required | Notes |
|---|---|---|---|
| `actorId` | ObjectId → users | ✔ | server-derived |
| `entityType` | String | ✔ | enum `PRODUCT` \| `CATEGORY` \| `USER` \| `SETTINGS` \| `SECURITY` |
| `entityId` | ObjectId | cond. | absent for some security events |
| `action` | String | ✔ | e.g. `CREATE`, `UPDATE`, `ARCHIVE`, `RESTORE`, `DELETE`, `LOGIN_FAILED`, `LOCKOUT`, `ROLE_CHANGE`, `PASSWORD_RESET` |
| `changes` | Array | — | `[{ field, before, after }]` for updates |
| `ip` | String | — | security events |
| `createdAt` | Date | ✔ | immutable |

**Indexes:** `{ entityType: 1, createdAt: -1 }` · `{ actorId: 1, createdAt: -1 }` · `{ entityId: 1, createdAt: -1 }`.

### 10.7 `settings`

**Purpose:** Seeded singleton (BR-41).

| Field | Type | Required | Notes |
|---|---|---|---|
| `currency` | String | ✔ | ISO 4217, e.g. `"USD"` |
| `defaultLowStockThreshold` | Number (int) | ✔ | ≥ 0, default 10 |
| `movementWarningThreshold` | Number (int) | ✔ | ≥ 1, default 1000 |

### 10.8 `counters`

**Purpose:** Atomic sequences for SKU auto-generation (BR-04). `{ _id: "<prefix>", seq: Number }`, advanced via atomic `findOneAndUpdate` with `$inc`.

### 10.9 Relationships

```text
users 1 ──── * transactions        (userId; attribution, never cascaded — BR-29)
users 1 ──── * refreshTokens       (userId; TTL-expired)
users 1 ──── * auditLogs           (actorId)
categories 1 ──── * products       (categoryId; delete blocked while referenced — BR-27)
products 1 ──── * transactions     (productId; product archive keeps ledger intact)
transactions 1 ──── * transactions (refTransactionId; compensations)
```

Referential integrity is enforced at the service layer (validated within the relevant multi-document transaction where a race is possible: BR-22, BR-23, BR-27).

---

## 11. System Architecture

### 11.1 Architecture Diagram

```text
                                   HTTPS (TLS, HSTS)
┌─────────────────────────────┐   ┌──────────────────────────────────────────────┐
│         CLIENT (Browser)     │   │        BACKEND — Node.js / Express           │
│  React 18 + Vite + TS        │   │  (stateless; N instances behind host LB)     │
│  ┌───────────────────────┐  │   │  ┌────────────────────────────────────────┐  │
│  │ Pages (§9)            │  │   │  │ Middleware chain                       │  │
│  │  Zustand stores       │  │   │  │  helmet → cors(allow-list) → compress  │  │
│  │  Recharts (lazy)      │  │   │  │  → rate limiters → json(limit)         │  │
│  │  ZXing scanner (lazy) │  │   │  │  → sanitize($-keys) → correlationId    │  │
│  └──────────┬────────────┘  │   │  │  → auth (JWT + per-request user load)  │  │
│             │ Axios instance │   │  │  → authorize(role)  → validate(schema) │  │
│  interceptors: attach token, │   │  └───────────────┬────────────────────────┘  │
│  silent refresh, error map   │   │   Routes → Controllers → Services → Models   │
└─────────────┬───────────────┘   │        (all business rules in Services)      │
              │  /api/v1/*         │  ┌──────────────┐  ┌───────────────────────┐ │
              └────────────────────┼─▶│ Aggregate    │  │ Mongo multi-document  │ │
                                   │  │ cache 30–60s │  │ transactions (BR-19)  │ │
   GET /health · /ready ◀──────────┤  └──────────────┘  └──────────┬────────────┘ │
   (uptime monitor, deploy gate)   └──────────────────────────────┼──────────────┘
                                                                   │ Mongoose (TLS,
                                                                   │ least-priv user)
                        ┌──────────────────────┐        ┌──────────▼─────────────┐
                        │      CLOUDINARY      │        │    MongoDB ATLAS        │
                        │  product images/CDN  │        │  replica set (multi-AZ) │
                        │  signed uploads only │        │  users products …       │
                        └──────────▲───────────┘        │  daily snapshots        │
                                   │ direct upload      └─────────────────────────┘
                                   │ (signature from backend)
                              Browser ────┘
        Observability: structured JSON logs (correlation IDs) · metrics ·
        error tracking (frontend + backend) · external uptime monitoring
```

### 11.2 Key Interactions

1. **Authentication** — login issues an access token (client memory) and refresh cookie (`httpOnly`); every API call passes `Authorization: Bearer`; middleware verifies the JWT **and** loads the user record (FR-AUTH-07) before role authorization.
2. **Stock Movement** — controller validates → service opens a Mongo transaction → conditional quantity update + Transaction insert → commit → response. Idempotency key checked first; a replay short-circuits to the stored outcome.
3. **Image upload** — client requests a signature from the backend, uploads directly to Cloudinary, then attaches `{publicId, url}` on product save; failure paths per BR-38.
4. **Dashboard** — one aggregation-pipeline endpoint behind a 30–60 s cache (NFR-11).
5. **Health** — `/health` and `/ready` feed the uptime monitor and deploy gates (NFR-14/15).

---

## 12. REST API Specification

### 12.1 Conventions

- **Base URL:** `/api/v1`. Evolution is additive within v1; breaking changes require `/api/v2` (deprecation window documented). Clients tolerate unknown response fields.
- **Auth:** `Authorization: Bearer <accessToken>` unless marked Public. Refresh token travels only in the `httpOnly` cookie scoped to `/api/v1/auth`.
- **Roles:** per the [§5 matrix](#5-user-roles--permissions); enforced per request (FR-AUTH-07).
- **Idempotency:** Stock Movement endpoints require header `Idempotency-Key: <uuid>` (BR-20).
- **Pagination:** `?page=1&limit=20` (max 100); list envelope `{ "data": [...], "page", "limit", "totalItems", "totalPages" }`.
- **Errors:** standard envelope per [§16.2](#16-error-handling-strategy); domain codes per §16.3.
- **Machine-readable contract:** an OpenAPI 3 document mirrors this section normatively (NFR-27).

### 12.2 Endpoint Summary

#### Auth — `/auth`

| Method | Route | Role | Description |
|---|---|---|---|
| POST | `/auth/login` | Public | Authenticate; set refresh cookie; return access token + profile. Errors: `VALIDATION_ERROR`, `UNAUTHORIZED`, `ACCOUNT_LOCKED` (423), `ACCOUNT_DEACTIVATED` |
| POST | `/auth/refresh` | Public (cookie) | Rotate refresh token; new access token. Reuse of rotated token → family revoked (BR-35), `UNAUTHORIZED` |
| POST | `/auth/logout` | Any | Revoke current refresh token; clear cookie |
| POST | `/auth/reset-password` | Public (token) | Body: `{ token, newPassword }`; single-use, 30-min expiry (UC-03) |
| POST | `/auth/change-password` | Any | Body: `{ currentPassword, newPassword }`; revokes other sessions |

#### Users — `/users`

| Method | Route | Role | Description |
|---|---|---|---|
| GET | `/users` | Admin | Paginated list; filters: `role`, `isActive`, search by name/email |
| POST | `/users` | Admin | Create (name, email, role, temporary password); `409` on duplicate email |
| GET | `/users/me` | Any | Own profile |
| PATCH | `/users/me` | Any | Update own name |
| GET | `/users/:id` | Admin | Single user |
| PATCH | `/users/:id` | Admin | Update name / role / `isActive`; `409 LAST_ADMIN` guard (BR-30); revocations per FR-USER-04 |
| POST | `/users/:id/reset-password` | Admin | Issue reset token; returns the reset link for out-of-band delivery |

#### Products — `/products`

| Method | Route | Role | Description |
|---|---|---|---|
| GET | `/products` | Any | Paginated list; `search`, `categoryId`, `stockStatus=in\|low\|out`, `archived=true\|false` (archived filter Admin-only), `sort` ∈ {name, sku, quantity, createdAt, costPrice} |
| POST | `/products` | Admin | Create (FR-PROD-01); blank SKU → auto-generate (BR-04); `409 DUPLICATE_SKU\|DUPLICATE_BARCODE` |
| GET | `/products/lookup?code=` | Any | Scanner resolution: barcode → SKU (BR-06); includes archived status (BR-07); `INVALID_BARCODE` on malformed payload |
| GET | `/products/:id` | Any | Full detail (read-only for Staff) |
| PATCH | `/products/:id` | Admin | Update non-SKU fields; requires `version` (BR-24 → `409 STALE_WRITE`) |
| POST | `/products/:id/archive` | Admin | Atomic archive; `409` if quantity ≠ 0 or concurrent movement (BR-22) |
| POST | `/products/:id/restore` | Admin | Restore archived product |
| DELETE | `/products/:id` | Admin | Hard delete; only with zero Transactions, atomic (BR-23); else `409` |

#### Categories — `/categories`

| Method | Route | Role | Description |
|---|---|---|---|
| GET | `/categories` | Any | List (optional `withCounts=true`) |
| POST | `/categories` | Admin | Create; unique name (case-insensitive) |
| PATCH | `/categories/:id` | Admin | Update |
| DELETE | `/categories/:id` | Admin | Delete; `?reassignTo=<categoryId>` for bulk reassignment; blocked while referenced → `409 CATEGORY_IN_USE` (BR-27); system category undeletable (BR-28) |

#### Inventory — `/inventory`

| Method | Route | Role | Description |
|---|---|---|---|
| POST | `/inventory/movements` | Any (STOCK_IN/OUT) · Admin (ADJUSTMENT) | Execute a Stock Movement. Header `Idempotency-Key` required. Errors: `INSUFFICIENT_STOCK`, `IDEMPOTENCY_CONFLICT` (422), `PRODUCT_ARCHIVED`, `VALIDATION_ERROR` |

#### Transactions & Audit

| Method | Route | Role | Description |
|---|---|---|---|
| GET | `/transactions` | Any | Paginated ledger; filters: `from`, `to`, `type`, `productId`, `userId`, `includeArchived` |
| GET | `/transactions/:id` | Any | Single Transaction |
| GET | `/audit-logs` | Admin | Paginated audit trail; filters: `entityType`, `entityId`, `actorId`, `from`, `to` |

*(No PUT/PATCH/DELETE exists for either collection — FR-TXN-02.)*

#### Dashboard, Reports, Uploads, Settings, Health

| Method | Route | Role | Description |
|---|---|---|---|
| GET | `/dashboard/summary?range=7\|30\|90` | Any | All metrics + chart series in one cached call (NFR-11); invalid range → `VALIDATION_ERROR` |
| GET | `/reports/inventory` | Any | Inventory Summary (filters: `categoryId`, `stockStatus`) |
| GET | `/reports/low-stock` | Any | Low Stock report |
| GET | `/reports/transactions?from&to` | Any | Transaction History; range mandatory, ≤ 366 days |
| GET | `/reports/product-performance?from&to` | Any | Movement totals per product |
| GET | `/reports/consistency` | Admin | Ledger reconciliation results (FR-RPT-05) |
| GET | `/reports/:name/export` | **Admin** | CSV stream of the filtered report; Staff → `403` |
| POST | `/upload/signature` | Admin | Signed Cloudinary upload parameters (BR-36) |
| DELETE | `/upload/:publicId` | Admin | Destroy an asset (failed-save cleanup, BR-38) |
| GET | `/settings` | Admin | Read settings singleton |
| PUT | `/settings` | Admin | Update settings (audited) |
| GET | `/health` · `/ready` | Public | Liveness / readiness (NFR-14); unauthenticated; no business data |

### 12.3 Representative Payloads

**POST `/auth/login` — 200**

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs…",
  "user": { "id": "665f1a…", "name": "Sara An", "email": "admin@example.com",
            "role": "ADMIN", "mustChangePassword": false }
}
```

**POST `/products` — request**

```json
{
  "name": "USB-C Cable 1m",
  "sku": "ELEC-00042",
  "barcode": "8412345678905",
  "categoryId": "664d20…",
  "description": "Braided, 60W",
  "costPrice": "2.10",
  "sellingPrice": "5.99",
  "initialQuantity": 150,
  "lowStockThreshold": 20,
  "supplier": { "name": "Acme Trading", "phone": "+1-555-0100" },
  "images": [ { "publicId": "ims/prod/abc123", "url": "https://res.cloudinary.com/…", "isPrimary": true } ]
}
```

**201** → full product document (with `id`, `quantity: 150`, `version: 0`); side effect: `INITIAL` Transaction (BR-17).

**POST `/inventory/movements` — request** (header `Idempotency-Key: 9f2c7a1e-…`)

```json
{ "productId": "665f2b…", "type": "STOCK_OUT", "quantity": 25, "note": "Order #1042" }
```

**200**

```json
{
  "transaction": { "id": "6660aa…", "productId": "665f2b…", "type": "STOCK_OUT",
                   "quantityChange": -25, "quantityAfter": 125,
                   "userId": "665f1a…", "createdAt": "2026-07-22T14:03:11.000Z" },
  "product": { "id": "665f2b…", "quantity": 125, "lowStockThreshold": 20, "stockStatus": "IN_STOCK" }
}
```

**409 `INSUFFICIENT_STOCK`**

```json
{ "error": { "code": "INSUFFICIENT_STOCK", "message": "Only 12 units available.",
             "details": { "available": 12, "requested": 25 },
             "correlationId": "c1f4…" } }
```

**Adjustment request** (Admin): `{ "productId": "…", "type": "ADJUSTMENT", "delta": -3, "reason": "DAMAGED", "note": "Crushed box" }` — or counted mode: `{ "countedQuantity": 122, "reason": "COUNT_CORRECTION" }`.

**GET `/products?search=usb&stockStatus=low&page=1&limit=20` — 200**

```json
{
  "data": [ { "id": "665f2b…", "name": "USB-C Cable 1m", "sku": "ELEC-00042",
              "thumbnailUrl": "https://res.cloudinary.com/…/w_96/…", "categoryName": "Electronics",
              "quantity": 12, "lowStockThreshold": 20, "stockStatus": "LOW_STOCK",
              "costPrice": "2.10", "sellingPrice": "5.99", "isArchived": false } ],
  "page": 1, "limit": 20, "totalItems": 1, "totalPages": 1
}
```

**GET `/dashboard/summary?range=30` — 200 (abridged)**

```json
{
  "asOf": "2026-07-22T14:05:00.000Z",
  "totals": { "activeProducts": 412, "inventoryValue": "48210.55", "unitsInStock": 10944 },
  "lowStock": { "count": 9, "items": [ { "id": "…", "name": "…", "quantity": 4, "lowStockThreshold": 10 } ] },
  "outOfStock": { "count": 2, "items": [ { "id": "…", "name": "…" } ] },
  "recentTransactions": [ { "id": "…", "type": "STOCK_OUT", "productName": "…", "quantityChange": -25,
                            "userName": "…", "createdAt": "…" } ],
  "charts": { "movementTrend": [ { "date": "2026-07-21", "in": 340, "out": 295 } ],
              "transactionVolume": [ { "date": "2026-07-21", "count": 57 } ] }
}
```

### 12.4 Validation at the API Boundary

Every endpoint validates its request against a schema before the controller runs (§15 defines field rules; §14 SEC-06 defines sanitization). Validation failures return `400 VALIDATION_ERROR` with a `details` array of `{ field, message }` — never a partial write.

---

## 13. Folder Structure

### 13.1 Backend (`/server`)

```text
server/
├── src/
│   ├── config/          # env loading + schema validation (fail-fast, NFR-28); db, cloudinary, cors config
│   ├── routes/          # Express routers only: path → middleware chain → controller
│   ├── controllers/     # HTTP concerns: parse validated input, call service, shape response. NO business logic
│   ├── services/        # ALL business rules (§6). Movement service owns BR-11/17/19/20; user service owns BR-29/30 …
│   ├── models/          # Mongoose schemas + indexes (§10). Schema-level guards only (min: 0, enums)
│   ├── middleware/      # auth (JWT + user load), authorize(role), validate(schema), rateLimiters,
│   │                    # sanitize, correlationId, errorHandler (§16.1)
│   ├── validation/      # request schemas per endpoint (§15) — single source for §12.4
│   ├── utils/           # logger (structured JSON), csvStream, tokenUtils, pagination helpers
│   ├── jobs/            # scheduled tasks: ledger reconciliation (BR-18), orphan-image sweep (BR-38)
│   ├── seeds/           # first-admin + settings + Uncategorized seed (FR-USER-06)
│   ├── app.js           # express app assembly (middleware order per §11.1)
│   └── server.js        # bootstrap: config validation → db connect (retry/backoff) → listen; graceful shutdown
├── tests/
│   ├── unit/            # service-layer tests (every BR traceable, NFR-26)
│   ├── integration/     # per-endpoint auth/validation/error tests (ephemeral MongoDB)
│   └── e2e/             # smoke: login → add product → in → out → ledger check
├── openapi.yaml         # normative machine-readable §12 (NFR-27)
├── .env.example         # every variable documented (§18.4)
└── package.json
```

### 13.2 Frontend (`/client`)

```text
client/
├── src/
│   ├── api/             # single Axios instance + interceptors (token attach, silent refresh,
│   │                    # error-envelope mapping); typed per-resource clients generated from openapi.yaml
│   ├── stores/          # Zustand: authStore (session, user), uiStore (toasts, dialogs),
│   │                    # settingsStore; server data is fetched per page, not globally duplicated (NFR-25)
│   ├── pages/           # one folder per §9 page (Login, Dashboard, Products, ProductDetail,
│   │                    # AddProduct, EditProduct, Scanner, Categories, Transactions, Reports,
│   │                    # Users, Settings, Profile, ResetPassword)
│   ├── components/
│   │   ├── ui/          # buttons, inputs, modal, table (virtualized), badge, placeholder-image
│   │   ├── layout/      # AppShell, Sidebar, TopBar, RequireAuth / RequireRole route guards (UX only)
│   │   └── domain/      # StockMovementDialog, AdjustmentDialog, ProductForm, QRLabel,
│   │                    # ScannerViewport (lazy ZXing), ChartPanel (lazy Recharts)
│   ├── hooks/           # useDebounce, usePagination, useIdempotencyKey, useCamera
│   ├── lib/             # formatters (money/date/tz per NFR-33), constants, error-code → message map (§16.3)
│   ├── types/           # generated API types + domain types (TS strict)
│   ├── router.tsx       # lazy route-split definitions (NFR-06)
│   └── main.tsx
├── tests/               # component + hook tests; Playwright E2E smoke
├── tailwind.config.js
├── vite.config.ts
└── package.json
```

**Rationale:** the structure enforces NFR-24/25 mechanically — business rules cannot hide in controllers or components because those layers have no natural home for them.

---

## 14. Security Requirements

| ID | Requirement |
|---|---|
| SEC-01 | **JWT authentication flow.** Access token: 15 min, carried in `Authorization: Bearer`, held in client memory (never localStorage). Refresh token: 7 days, rotating, `httpOnly` + `Secure` + `SameSite=Strict` cookie scoped to `/api/v1/auth`, stored server-side hashed (§10.5). Rotation reuse → family revocation + security event (BR-35). Token payload: `sub`, `role`, `iat`, `exp` only — no PII. Secrets ≥ 256-bit, environment-supplied, per-environment distinct; documented rotation procedure (forces re-login — accepted). |
| SEC-02 | **Passwords.** Policy per BR-32 (≥ 10 chars, letter + digit, deny-list); bcrypt cost 12; temporary passwords force change at first login; reset tokens single-use, 30-min, stored hashed. |
| SEC-03 | **Role-based authorization.** §5 matrix enforced server-side on every request against the live user record (FR-AUTH-07); client route guards are UX only. Privilege changes effective immediately (FR-USER-04). |
| SEC-04 | **Rate limiting & lockout.** Global limiter (300 req / 15 min / IP) plus strict auth limiter (10 login attempts / 15 min / IP), layered with the per-account lockout (BR-33). |
| SEC-05 | **Transport & headers.** HTTPS everywhere with HSTS; Helmet-managed secure headers including a restrictive Content-Security-Policy (self + Cloudinary image origin), `X-Content-Type-Options`, frame denial, referrer policy. CORS: explicit frontend-origin allow-list; credentials enabled only for the auth cookie routes. |
| SEC-06 | **Input validation & NoSQL-injection prevention.** Every request validated against a schema before handling (§12.4); request sanitization strips `$`-prefixed keys/operators from user-supplied objects; queries never interpolate raw request objects; JSON body size limited (1 MB). |
| SEC-07 | **XSS & untrusted content.** React's default escaping is never bypassed with raw-HTML injection for user data; scan payloads are opaque validated strings (BR-16); user-generated text (notes, names) rendered escaped. |
| SEC-08 | **Upload security.** Cloudinary uploads only via backend-generated signatures (no unsigned presets, no client credentials); MIME + magic-byte validation; size/count limits per BR-36. |
| SEC-09 | **Security event log.** Events per FR-TXN-05 recorded with actor, IP, outcome; Admin-visible in the Audit Trail. |
| SEC-10 | **Secrets & environment.** All secrets in the host platform's secret manager; never in repo, artifacts, or logs; startup fails on missing/invalid config (NFR-28). |
| SEC-11 | **Database least privilege.** App's Atlas user: `readWrite` on the app database only; Atlas network access restricted to backend hosts/VPC — never `0.0.0.0/0` in production. |
| SEC-12 | **Error opacity & logging hygiene.** Production responses never contain stack traces, ODM internals, or paths — only the §16.2 envelope with a correlation ID. Logs contain no passwords, tokens, or PII beyond user IDs. Dependency hygiene: CI vulnerability scanning fails builds on critical CVEs; lockfiles committed; monthly patch cadence. |

---

## 15. Validation Rules

Validation is dual-layer: client-side (immediate UX feedback) and server-side schemas (§12.4, authoritative). Server rules below are normative.

### 15.1 Login Form

| Field | Rules |
|---|---|
| Email | required; valid email format; lowercased |
| Password | required; non-empty (policy is NOT revealed at login; errors stay generic) |

### 15.2 Product Form (Add / Edit)

| Field | Rules |
|---|---|
| Name | required; 2–120 chars; trimmed |
| SKU | Add: optional (blank → auto BR-04); if present: `^[A-Z0-9-]{3,32}$` after trim+uppercase. Edit: read-only |
| Barcode | optional; trimmed; printable; ≤ 64 chars; unique (BR-05) |
| Category | required; must reference an existing category |
| Description | optional; ≤ 2,000 chars |
| Cost / Selling price | required; decimal ≥ 0; ≤ 2 decimal places |
| Initial quantity (Add only) | integer; 0 ≤ qty ≤ 10,000,000 |
| Low-stock threshold | integer ≥ 0 (defaults from settings) |
| Supplier | optional; name ≤ 120 chars; email valid if present; phone ≤ 30 chars |
| Images | 0–5; JPEG/PNG/WebP; ≤ 5 MB each; exactly one primary when non-empty |
| Version (Edit only) | required (BR-24) |

### 15.3 Category Form

| Field | Rules |
|---|---|
| Name | required; 2–60 chars; unique case-insensitive (BR-26) |
| Description | optional; ≤ 300 chars |
| Delete reassignment | `reassignTo` must be an existing, different category (default Uncategorized) |

### 15.4 Stock Movement Form (Stock In / Stock Out)

| Field | Rules |
|---|---|
| Product | required; existing, non-archived |
| Type | `STOCK_IN` \| `STOCK_OUT` |
| Quantity | integer; 1–100,000 (BR-12); > warning threshold → UI confirmation (BR-15) |
| Note | optional; ≤ 500 chars |
| Idempotency-Key header | required; UUID format (BR-20) |

### 15.5 Inventory Adjustment Form (Admin)

| Field | Rules |
|---|---|
| Mode | `delta` (signed integer ≠ 0, |delta| ≤ 100,000) XOR `countedQuantity` (integer 0–10,000,000) |
| Reason | required; enum BR-13 |
| Note | ≤ 500 chars; **required** when reason = `OTHER` |
| Idempotency-Key header | required |

### 15.6 User Form (Create / Edit)

| Field | Rules |
|---|---|
| Name | required; 2–80 chars |
| Email | required (create); valid; unique; lowercased |
| Role | required; `ADMIN` \| `STAFF`; change guarded by BR-30 |
| Temporary password | required (create); policy BR-32 |
| isActive | boolean; deactivation guarded by BR-30 |

### 15.7 Password Forms

| Form | Rules |
|---|---|
| Change password | current password required and verified; new password per BR-32; confirmation must match; new ≠ current |
| Reset password | token required, valid, unused, unexpired; new password per BR-32; confirmation match |

### 15.8 Settings Form

| Field | Rules |
|---|---|
| Currency | required; valid ISO 4217 code |
| Default low-stock threshold | integer ≥ 0 |
| Movement warning threshold | integer ≥ 1 |

### 15.9 Report & List Filters

| Input | Rules |
|---|---|
| Date range | `from ≤ to`; Transaction History: both required, span ≤ 366 days |
| `page` / `limit` | integers ≥ 1; `limit ≤ 100` (hard cap) |
| `range` (dashboard) | ∈ {7, 30, 90} |
| `type`, `stockStatus`, enums | must match their defined enum; unknown values → `VALIDATION_ERROR` |

---

## 16. Error Handling Strategy

### 16.1 Global Handling

1. A single Express error-handling middleware terminates every error path; controllers/services throw typed application errors, never write responses directly on failure.
2. Unexpected errors: logged at `error` level with stack + correlation ID, reported to error tracking, returned as opaque `500 INTERNAL_ERROR` (SEC-12).
3. Every response carries the request's correlation ID; the frontend surfaces it in error toasts ("reference: c1f4…") for supportability.
4. Frontend: the Axios interceptor maps the error envelope to user-friendly messages via a single code→message table (`lib/`); React error boundaries prevent blank-screen crashes; forms preserve input on any error (FR-AUTH-02, EC-28 behavior).
5. Process-level: unhandled rejections/exceptions are logged and terminate the process (the host restarts it — NFR-21 ensures drain on SIGTERM).

### 16.2 Error Response Envelope

```json
{
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "Only 12 units available.",
    "details": { "available": 12, "requested": 25 },
    "correlationId": "c1f4b7e2-…"
  }
}
```

`details` is optional and code-specific (`VALIDATION_ERROR` uses `[{ field, message }]`).

### 16.3 Error Code Catalog

| Code | HTTP | When | User-facing message pattern |
|---|---|---|---|
| `VALIDATION_ERROR` | 400 | Any schema/rule violation (§15) | Field-level messages |
| `UNAUTHORIZED` | 401 | Missing/invalid/expired token; bad credentials | "Please sign in again." / "Invalid email or password." |
| `ACCOUNT_DEACTIVATED` | 401 | Deactivated user (BR-34) | "This account has been deactivated." |
| `FORBIDDEN` | 403 | Role not permitted (§5) | "You don't have permission for this action." |
| `NOT_FOUND` | 404 | Unknown resource / unknown scan code | "Not found." |
| `DUPLICATE_SKU` | 409 | BR-01 | "SKU already exists." |
| `DUPLICATE_BARCODE` | 409 | BR-05 (+ conflicting product in details) | "Barcode already assigned to {product}." |
| `INSUFFICIENT_STOCK` | 409 | BR-11 (+ available in details) | "Only {n} units available." |
| `STALE_WRITE` | 409 | BR-24 | "This product was changed by someone else — review and retry." |
| `LAST_ADMIN` | 409 | BR-30 | "At least one active Admin is required." |
| `PRODUCT_ARCHIVED` | 409 | Movement on archived product | "This product is archived." |
| `CATEGORY_IN_USE` | 409 | BR-27 | "Category has products — reassign them first." |
| `INVALID_BARCODE` | 422 | BR-16 | "That code couldn't be read." |
| `IDEMPOTENCY_CONFLICT` | 422 | BR-20 | "Request conflict — please retry the operation." |
| `ACCOUNT_LOCKED` | 423 | BR-33 | "Account locked for 15 minutes after failed attempts." |
| `RATE_LIMITED` | 429 | SEC-04 | "Too many requests — try again shortly." |
| `INTERNAL_ERROR` | 500 | Unexpected | "Something went wrong. Reference: {correlationId}" |
| `SERVICE_UNAVAILABLE` | 503 | DB down / not ready (+ `Retry-After`) | "Service temporarily unavailable." |

### 16.4 Logging & Observability

- Structured JSON logs: `timestamp, level, correlationId, userId?, method, path, status, durationMs, code?`.
- Levels: `error` (5xx, integrity), `warn` (409/422/423/429, lockouts, reconciliation drift), `info` (lifecycle), `debug` (dev only).
- Metrics: request rate, p95 latency, error rate; reconciliation-drift and lockout counts alert-worthy (NFR-23).
- No PII, passwords, tokens, or raw scan payloads in logs (SEC-12).

---

## 17. Third-Party Libraries

### 17.1 Frontend

| Package | Purpose | Justification / Integration Notes |
|---|---|---|
| `react`, `react-dom` (18+) | UI framework | Fixed by stack; concurrent features for responsive tables |
| `vite` | Build tool | Fast dev server; route-level code splitting (NFR-06) |
| `typescript` | Type safety | Strict mode (NFR-29); API types generated from OpenAPI |
| `tailwindcss` | Styling | Utility-first, responsive breakpoints per NFR-36; no runtime CSS-in-JS cost |
| `zustand` | Client state | Minimal store API; designated stores only (NFR-25) |
| `axios` | HTTP client | Single instance; interceptors implement token attach, silent refresh, error mapping |
| `react-router-dom` | Routing | Lazy route objects; guards in `components/layout` |
| `recharts` | Dashboard charts | Declarative, responsive; **lazy-loaded chunk** (NFR-06) |
| `@zxing/browser`, `@zxing/library` | Camera barcode/QR decoding | Broad format support; **lazy-loaded**; requires HTTPS + user gesture (NFR-35) |
| `qrcode.react` | SKU-encoded printable labels (FR-PROD-08) | Client-side rendering; no server dependency |
| `zod` | Client-side form validation | Mirrors server schemas; single validation vocabulary |
| Dev: `eslint`, `prettier`, `vitest`, `@testing-library/react`, `playwright` | Quality gates | CI-enforced (NFR-26/29) |

### 17.2 Backend

| Package | Purpose | Justification / Integration Notes |
|---|---|---|
| `express` (4/5) | HTTP framework | Fixed by stack; middleware chain per §11.1 |
| `mongoose` (8+) | ODM | Schemas/indexes (§10); `Decimal128` for money; session support for multi-document transactions (BR-19) |
| `jsonwebtoken` | JWT sign/verify | SEC-01; HS256 with ≥ 256-bit secret |
| `bcrypt` | Password hashing | Cost 12 (BR-32); native bindings preferred over `bcryptjs` for throughput |
| `zod` (or `joi`) | Request schema validation | One schema per endpoint in `validation/` (§12.4); shared vocabulary with frontend if zod |
| `helmet` | Secure headers | SEC-05 incl. CSP |
| `cors` | Origin allow-list | SEC-05; credentials only on auth routes |
| `express-rate-limit` | Rate limiting | SEC-04 dual limiters |
| `express-mongo-sanitize` | `$`-operator stripping | SEC-06 |
| `cookie-parser` | Refresh-cookie handling | SEC-01 |
| `compression` | gzip/brotli | NFR-07 |
| `cloudinary` | Signed uploads + asset destroy | SEC-08, BR-38 |
| `pino` (+ `pino-http`) | Structured JSON logging | NFR-23; correlation-ID child loggers |
| `uuid` | Correlation + idempotency keys | BR-20 |
| `node-cron` | Scheduled jobs | Reconciliation (BR-18), orphan sweep (BR-38); single-instance guard documented |
| Dev: `vitest`/`jest`, `supertest`, `mongodb-memory-server`, `eslint`, `prettier` | Tests + quality gates | NFR-26; integration tests on ephemeral Mongo |

Version policy: lockfiles committed; no floating majors; CI vulnerability scanning per SEC-12.

---

## 18. Deployment Architecture

### 18.1 Topology

| Component | Hosting | Notes |
|---|---|---|
| Frontend | Static host/CDN (e.g., Vercel/Netlify/Cloudflare Pages) | Immutable hashed assets (NFR-07); SPA fallback routing; HTTPS + HSTS |
| Backend | Node host with health-checked instances (e.g., Render/Railway/Fly.io or container platform) | ≥ 1 instance dev/staging, ≥ 2 production; rolling deploys gated on `/ready` (NFR-15) |
| Database | MongoDB Atlas | Replica set (required for BR-19); production on a paid tier for SLA + snapshots (§21); network-restricted (SEC-11) |
| Media | Cloudinary | Signed uploads only; CDN delivery + transformations |
| Monitoring | External uptime monitor + error tracking | NFR-17/23; alerts to a named contact |

### 18.2 Environments

`development` → `staging` → `production`, config-identical in shape (NFR-28): separate Atlas projects/clusters, separate Cloudinary environments, distinct secrets (SEC-10). Staging receives every release before production and hosts restore drills (NFR-22).

### 18.3 CI/CD Pipeline

```text
push/PR --> lint + typecheck --> unit tests --> integration tests --> build
        --> dependency vulnerability scan (fail on critical)
merge   --> deploy to staging --> E2E smoke suite --> manual gate
        --> rolling deploy to production (health-gated) --> post-deploy smoke
rollback: redeploy previous artifact (< 15 min, NFR-15)
```

### 18.4 Environment Variables (`.env.example` inventory)

| Variable | Purpose |
|---|---|
| `NODE_ENV`, `PORT` | Runtime mode / bind port |
| `MONGODB_URI` | Atlas connection string (least-privilege user) |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | ≥ 256-bit, per-environment (SEC-01) |
| `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL` | Defaults 15m / 7d |
| `CORS_ORIGIN` | Frontend origin allow-list |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Signed uploads (SEC-08) |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | First-admin bootstrap (FR-USER-06); rotate after first login |
| `RATE_LIMIT_*` | Limiter tuning (SEC-04) |
| `LOG_LEVEL` | pino level |
| `SENTRY_DSN` (or equivalent) | Error tracking (NFR-23) |
| Frontend: `VITE_API_BASE_URL` | API origin |

Config is schema-validated at boot; missing/invalid values abort startup (NFR-28).

### 18.5 Backup & Recovery

Atlas snapshot backups (daily minimum; continuous where the tier allows). RPO ≤ 24 h, RTO ≤ 4 h (NFR-22). A documented quarterly restore drill to staging verifies the procedure; an untested backup is treated as no backup. Cloudinary assets are redundantly stored by the provider; `publicId`s in Mongo make re-linking deterministic.

---

## 19. Development Roadmap

Effort assumes 1–2 full-stack developers; sizes are relative engineering effort.

### Phase 0 — Foundations (≈ 1 week)

- **Objectives:** repos, CI skeleton, environments, contracts.
- **Deliverables:** monorepo scaffold per §13; CI with lint/typecheck/test gates; `.env` schema validation; OpenAPI stub; Atlas + Cloudinary environments; seed procedure (admin, settings, Uncategorized).
- **Dependencies:** none.

### Phase 1 — Auth & Users (≈ 1.5 weeks)

- **Objectives:** the full §3.1–§3.2 surface.
- **Deliverables:** login/refresh/logout with rotation + reuse detection; lockout; per-request authorization middleware; Users page; profile + password flows; security events; integration tests for every auth path.
- **Dependencies:** Phase 0.

### Phase 2 — Catalog (≈ 2 weeks)

- **Objectives:** products + categories end-to-end.
- **Deliverables:** product CRUD with SKU/barcode rules (BR-01…07), optimistic concurrency, archive/restore/hard-delete lifecycle (BR-21…25); signed image uploads + orphan cleanup (BR-36…38); categories with reassignment (BR-26…28); Products/Detail/Add/Edit/Categories pages; audit trail writes.
- **Dependencies:** Phase 1.

### Phase 3 — Inventory Core (≈ 2 weeks) ⚠ architecturally load-bearing

- **Objectives:** the ledger. BR-17/19/20 are change-controlled: deviations return to architecture review.
- **Deliverables:** movement service (atomic conditional updates, multi-document transactions, idempotency); Stock In/Out/Adjustment dialogs; Transactions page (ledger tab); reconciliation job + drift surfacing; exhaustive unit tests incl. concurrency and retry scenarios; `INITIAL` transaction wiring into product creation.
- **Dependencies:** Phase 2.

### Phase 4 — Scanning (≈ 1 week, parallelizable with Phase 5)

- **Objectives:** §3.6 complete, all failure paths.
- **Deliverables:** Scanner page (ZXing lazy chunk, manual fallback, permission states, unknown/archived handling, payload hardening BR-16); lookup endpoint; QR label printing; **device spike report** (target phones/browsers) — scheduled first within the phase (risk R-1, §21).
- **Dependencies:** Phase 3 (movements exist to launch).

### Phase 5 — Dashboard & Reports (≈ 1.5 weeks)

- **Objectives:** §3.7 + §3.10.
- **Deliverables:** aggregate endpoint + cache; dashboard UI with charts (lazy Recharts); all five reports; CSV streaming export with role gate; Audit Trail tab.
- **Dependencies:** Phase 3 (ledger data).

### Phase 6 — Hardening & Launch (≈ 1.5 weeks)

- **Objectives:** production readiness proven, not assumed.
- **Deliverables:** load test at reference volume with query-plan verification (NFR-08); accessibility pass (NFR-30); E2E smoke in CI; monitoring + alerting live; restore drill executed; security review against §14; staging → production launch; rollback rehearsal.
- **Dependencies:** all phases.

**Total: ≈ 10.5 developer-weeks** nominal, excluding stakeholder review cycles.

---

## 20. Future Enhancements

Listed with the v1 design decision that keeps each feasible (EXT-02).

| # | Enhancement | v1 Enabler / Migration Path |
|---|---|---|
| FE-1 | **Multi-warehouse inventory** | Movement logic isolated in one service; adding a location dimension extends the Transaction schema (`locationId`) rather than rewriting flows |
| FE-2 | **Purchase orders** | Ledger `type` enum is extensible (`PURCHASE`); supplier subdocument feeds PO seeding |
| FE-3 | **Supplier management module** | Embedded `product.supplier` documented for migration to a referenced `suppliers` collection |
| FE-4 | **Customer management & sales module** | `SALE` transaction type slots into the existing ledger; reports already ledger-derived |
| FE-5 | **POS integration** | OpenAPI contract (NFR-27) + additive-versioning policy enable third-party clients |
| FE-6 | **Email notifications** (low stock, resets) | Transaction creation is the designated event seam (EXT-03); reset flow already token-based |
| FE-7 | **Advanced analytics dashboard** | Append-only ledger is a complete event history for velocity/turnover analytics |
| FE-8 | **AI demand forecasting** | Ledger provides clean time-series training data per product |
| FE-9 | **Native mobile application** | Generated API types + contract-first backend; scanner flows already mobile-designed |
| FE-10 | **Bulk CSV import/export** | Validation schemas (§15) are reusable for row-level import validation |
| FE-11 | **Transaction cold archival** | Growth path documented (NFR-12); time-indexed ledger supports windowed export |

---

## 21. Assumptions

Every decision made on the stakeholders' behalf is recorded here; each is overridable before design freeze.

| # | Assumption | Impact if changed |
|---|---|---|
| AS-1 | **Staff permissions are operations-only** (no catalog writes, no adjustments, no exports) per §5 | Matrix, page actions, endpoint roles |
| AS-2 | Single warehouse/location (OS-1) | Schema + flows (see FE-1) |
| AS-3 | Single currency (ISO 4217, settings-configured); English-only UI | Money formatting, reports |
| AS-4 | Quantities are integer units; no fractional stock | Movement validation |
| AS-5 | Session model: 15-min access / 7-day rotating refresh; no idle timeout beyond TTLs | Auth flows |
| AS-6 | No email service in v1: reset links delivered out-of-band by Admin; alerts dashboard-only | UC-03, FE-6 |
| AS-7 | Accounts are Admin-provisioned; no self-registration | Auth surface |
| AS-8 | Low-stock threshold default 10 (per-product override); movement warning threshold default 1,000 | Settings defaults |
| AS-9 | SKU auto-format `<CAT-PREFIX>-<seq>`; SKU immutable post-creation | Labeling workflow |
| AS-10 | Printable SKU-encoded QR labels are in scope (client-rendered) | FR-PROD-08 |
| AS-11 | CSV product import is **out** of v1 (FE-10) | Roadmap |
| AS-12 | Production runs on a **paid Atlas tier** (SLA + snapshots); free tier acceptable for dev/staging | NFR-13/22 economics |
| AS-13 | Single-region deployment; 99.5% availability target | Infrastructure cost |
| AS-14 | Dashboard staleness ≤ 60 s is acceptable | NFR-11 |
| AS-15 | Audit Trail lives as an Admin-only tab of the Transactions page (no separate nav item) | Navigation |
| AS-16 | Transactions retained indefinitely in v1 (no purge); archival is FE-11 | Storage growth |
| AS-17 | Inventory value uses current cost (no FIFO/LIFO/WAC) and is labeled as such in reports | Accounting alignment |
| AS-18 | Reference volumes: 10k products, 500k Transactions, 50 concurrent users | NFR calibration |
| AS-19 | A named person owns operational duties (backups, alerts, secret rotation) | §18 viability |
| AS-20 | Uncategorized system category always exists and is undeletable | BR-28 |

**Open risks carried into System Design:** R-1 scanner UX variance across mobile browsers (spiked first in Phase 4); R-2 Atlas transaction latency under hot-product contention (gated by the Phase 6 load test); R-3 solo-operator process discipline (AS-19).

---

## Appendix A: Traceability Matrix

Business-rule → enforcement → verification mapping (NFR-26 requires every BR traceable to ≥ 1 test). Abridged to load-bearing rules; the full matrix is maintained alongside the OpenAPI document.

| Rule | Enforcing endpoint(s) / layer | Verifying test |
|---|---|---|
| BR-01/02 (SKU unique/format) | `POST /products` + unique index | Integration: duplicate + race; unit: normalization |
| BR-05 (barcode sparse-unique) | `POST/PATCH /products` + sparse index | Integration: duplicate incl. conflict payload |
| BR-11 (no negative stock) | `POST /inventory/movements` conditional update | Unit: concurrency simulation; integration: `INSUFFICIENT_STOCK` |
| BR-17 (ledger invariant) | Movement service (sole quantity mutator) | Unit: invariant property tests; E2E: ledger sum check |
| BR-19 (atomic writes) | Movement service Mongo transaction | Integration: injected failure → no partial state |
| BR-20 (idempotency) | Movement endpoint + sparse unique key | Integration: replay same/different payload |
| BR-22/23 (archive/delete atomicity) | Product lifecycle endpoints | Integration: interleaved movement race |
| BR-27 (category referential) | `DELETE /categories/:id` | Integration: delete-vs-assign race |
| BR-30 (last admin) | `PATCH /users/:id` | Integration: concurrent demotion |
| BR-32/33 (password/lockout) | Auth endpoints | Integration: policy matrix + lockout sequence |
| BR-35 (rotation reuse) | `POST /auth/refresh` | Integration: reuse → family revoked |
| BR-38 (no orphan assets) | Upload endpoints + sweep job | Integration: failed save destroys asset |

---

*End of document — SRS-IMS-001 v1.0 · Approved for System Design · 2026-07-22*
