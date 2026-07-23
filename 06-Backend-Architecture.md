# Backend Architecture

## Web-Based Inventory Management System — Node.js / Express.js

| | |
|---|---|
| **Document ID** | BEA-IMS-006 |
| **Version** | 1.0 (Approved) |
| **Date** | 2026-07-23 |
| **Status** | **APPROVED FOR FRONTEND ARCHITECTURE** |
| **Source of truth** | SRS-IMS-001 (`01-SRS.md`) · ARC-IMS-002 (`02-System-Architecture.md`) · ERD-IMS-003 (`03-ERD.md`) · DBD-IMS-004 (`04-Database-Design.md`) — this document conforms to all four and never overrides them |
| **API contract** | **SRS §12 is the normative REST API contract**, realized here as the four-way binding table (§5) and detailed in `05-REST-API-Specification.md` (added after the BEV-01 validation; this document was renumbered 05 → 06 accordingly). The OpenAPI 3 artifact (NFR-27) is generated during implementation as the machine-readable form |
| **Review record** | Principal Backend Architect validation (BEV-01…05) — all corrections incorporated below |

---

## Table of Contents

1. [Architectural Shape](#1-architectural-shape)
2. [Folder & Module Structure](#2-folder--module-structure)
3. [Middleware Pipeline](#3-middleware-pipeline)
4. [Service Layer Design](#4-service-layer-design)
5. [Endpoint Binding Table](#5-endpoint-binding-table)
6. [Cross-Cutting Designs](#6-cross-cutting-designs)
7. [Scheduled Jobs](#7-scheduled-jobs)
8. [Process Lifecycle](#8-process-lifecycle)
9. [Testing Architecture](#9-testing-architecture)
10. [Review Findings Incorporated](#10-review-findings-incorporated)
11. [Assumptions & Risks](#11-assumptions--risks)

---

## 1. Architectural Shape

A single **stateless** Express application (modular monolith per ARC §1), layered per NFR-24 — organized by **resource module** vertically and by **layer** horizontally:

```text
Request ─▶ Middleware pipeline ─▶ Route ─▶ Controller ─▶ Service ─▶ Model ─▶ Atlas
                                                            │
                                              ALL business rules (SRS §6)
                                              live here and only here
```

**Governing rules:**

1. **MovementService is the sole writer of `product.quantity`** (DN-1) — the ledger invariant is structural.
2. Controllers contain zero business logic; models contain only schema-level guards; nothing above the service layer touches a model.
3. **No repository layer — an explicit decision:** Mongoose models *are* the data-access abstraction. An added repository tier would be pass-through indirection at this scale and would dilute the DES-1 insert-only discipline (two layers to audit instead of one). Services are the only model consumers.
4. The change-controlled core (MovementService / T1) carries SRS Roadmap Phase 3 governance: deviations return to architecture review.

---

## 2. Folder & Module Structure

```text
server/src/
├── config/          # env schema validation (fail-fast, NFR-28) · db · cloudinary ·
│                    # cors · trustProxy (exact platform hop, ARB-01)
├── routes/          # one router per SRS §12 resource: auth, users, products,
│                    # categories, inventory, transactions, auditLogs, dashboard,
│                    # reports, upload, settings, health
│                    # → path + middleware chain + controller reference ONLY
├── controllers/     # HTTP concerns: extract validated input, call ONE service
│                    # method, shape response via serializers. Zero business logic
├── services/        # AuthService · UserService · ProductService · CategoryService ·
│                    # MovementService ⚠ · AuditService · DashboardService ·
│                    # ReportService · UploadService — all BR-01…41 live here
├── models/          # 8 Mongoose schemas mirroring DBD §2 field-for-field + indexes
├── middleware/      # requestId · httpLogger · rateLimiters · mongoSanitize ·
│                    # authenticate · authorize · validate · errorHandler
├── validation/      # zod schema per endpoint (SRS §15) — single source for §12.4;
│                    # encodes blank→absent normalization (PDV-04) at the boundary
├── serializers/     # the global wire contract: Decimal128→string, ObjectId→string,
│                    # ISO-8601 UTC dates, list envelope, user sanitization (no hashes)
├── errors/          # typed AppError hierarchy keyed to the §16.3 error-code catalog
├── lib/             # logger (pino, correlation-ID children) · ttlCache (per-instance,
│                    # A-2) · idempotency helper · csvStream (cursor-batched) · pagination
├── jobs/            # reconciliation (BR-18, ARB-05) · orphanSweep (BR-38, BEV-04)
│                    # — leader-guarded via TTL lease (A-8)
├── seeds/           # first Admin + settings singleton + Uncategorized (DBD §8)
├── app              # application assembly — the ONE place middleware order is defined
└── server           # lifecycle: validate config → connect (retry/backoff) →
                     # integrity check (settings + ≥1 active admin) → listen →
                     # SIGTERM graceful drain (NFR-21)
```

---

## 3. Middleware Pipeline

Normative order — deviations are defects:

| # | Middleware | Responsibility | Traces |
|---|---|---|---|
| 0 | **`/health`, `/ready`** — mounted before everything | Liveness; readiness = DB ping + settings/admin integrity. Public, unauthenticated, unlimited | NFR-14, ARB-04 |
| 1 | `requestId` | UUID correlation ID → response header + pino child logger | NFR-23, SEC-12 |
| 2 | `trust proxy` (app setting) | Exact platform hop count — real client IPs for limiters and security events; verified per environment in Phase 0 | ARB-01, R-4 |
| 3 | `helmet` | CSP (self + Cloudinary image origin), HSTS, frame-deny, referrer policy | SEC-05 |
| 4 | `cors` | Frontend-origin allow-list; credentials only on `/auth` routes | SEC-05 |
| 5 | `compression` | brotli/gzip | NFR-07 |
| 6 | Rate limiters | Global 300 req/15 min/IP; strict 10/15 min/IP on `/auth/login` + `/auth/reset-password`; per-instance (×N noted for ops); DB-backed lockout (BR-33) remains the global authority | SEC-04 |
| 7 | `express.json({limit:'1mb'})` + `cookie-parser` | Body parsing + refresh cookie | SEC-06, SEC-01 |
| 8 | `mongoSanitize` | Strip `$`-prefixed keys/operators | SEC-06 |
| 9 | `authenticate` | Verify JWT → **load user by `_id` (indexed point-read)** → reject deactivated (`ACCOUNT_DEACTIVATED`) — role/status changes take effect within one request | FR-AUTH-07, EC-17, NFR-04 |
| 10 | `authorize(...roles)` | §5 permission matrix per route; ≥ 5 role-denied responses per user per 15 min emits one security event, fire-and-forget (BEV-03) | SEC-03, SEC-09 |
| 11 | `validate(schema)` | zod parse → typed input; failures → `VALIDATION_ERROR` with field details | §12.4, §15 |
| ∞ | `errorHandler` (terminal) | Typed error → §16.2 envelope + correlation ID; unexpected → log + error tracking + opaque `500` | §16.1, SEC-12 |

---

## 4. Service Layer Design

| Service | Owns | Key mechanics |
|---|---|---|
| **AuthService** | BR-32…35 | Login (lockout counters, generic credential errors); refresh **rotation** with family revocation on reuse (`TOKEN_REUSE_DETECTED`); logout; reset issue/complete (DBR-04 index); change-password (revokes other sessions). **Rotation crash semantics are fail-closed (BEV-02):** a crash between rotate-mark and new-token insert forces re-login via reuse detection — accepted, documented, no transaction added |
| **UserService** | BR-29…31 | Provisioning, lifecycle; **T6**: atomic active-admin count + role/status change + session revocation + audit entry |
| **ProductService** | BR-01…10, 21…25, 36…38 | Create (**T2**: product + `INITIAL` via MovementService); SKU auto-gen (counters, PDV-02); edit with `version` precondition (`STALE_WRITE`); archive/restore (**T3**); hard delete (**T4**, Cloudinary destroy post-commit); **exactly-one-primary-image invariant (DBR-03)** |
| **CategoryService** | BR-26…28 | CRUD with collation-aware name queries (the single home of category-name matching); delete/reassign (**T5**); `isSystem` guard |
| **MovementService** ⚠ | BR-11…20 | **Sole writer of `quantity`.** **T1** with majority concerns (A-1); idempotency: fast-path key lookup → execute → duplicate-key = replay with A-4 reconstruction (ARB-02); bounded `TransientTransactionError` retries; reason-code rules (BR-13); warning threshold (BR-15). **Change-controlled** |
| **AuditService** | FR-TXN-04/05 | Insert-only; diff computation (sensitive fields never diffed); `entityLabel` capture (DN-4); money diffs as API strings (DBR-05); invoked *inside* T3–T6 boundaries |
| **DashboardService** | FR-DASH-* | Single aggregation pipeline per range (7/30/90); per-instance TTL cache 30–60 s (A-2); `asOf` stamping |
| **ReportService** | FR-RPT-*, BR-40 | Ledger-derived queries; **cursor-batched CSV streaming** (10 s timeout applies per batch, NFR-20); Admin export gate; consistency report reads reconciliation output |
| **UploadService** | SEC-08, BR-36/38 | Signature issue (scoped to the `ims/prod` folder), destroy, orphan discovery input for the sweep (BEV-04) |

**Dependency rule:** controllers → services → models, strictly downward. Services may call services (ProductService → MovementService for T2; all mutators → AuditService). Ledger writes need no AuditService call — the ledger is its own audit (BR-17).

---

## 5. Endpoint Binding Table

Every SRS §12 endpoint binds to: **validation schema (§15) · error subset (§16.3) · index (DBD §3) · transaction boundary (DBD §4)**. The full table is derived mechanically endpoint-by-endpoint; the load-bearing rows:

| Endpoint | Schema | Error subset | Index | Boundary |
|---|---|---|---|---|
| `POST /auth/login` | 15.1 | `UNAUTHORIZED, ACCOUNT_LOCKED, ACCOUNT_DEACTIVATED` | `users{email}` | — |
| `POST /auth/refresh` | cookie | `UNAUTHORIZED` | `refreshTokens{tokenHash}` | — (fail-closed, BEV-02) |
| `POST /auth/reset-password` | 15.7 | `VALIDATION_ERROR, UNAUTHORIZED` | `users{resetTokenHash}` sparse | — |
| `POST /inventory/movements` | 15.4/15.5 + `Idempotency-Key` header (UUID, required) | `INSUFFICIENT_STOCK, PRODUCT_ARCHIVED, IDEMPOTENCY_CONFLICT, VALIDATION_ERROR` | `transactions{idempotencyKey}`, `products{_id}` | **T1** |
| `POST /products` | 15.2 | `DUPLICATE_SKU, DUPLICATE_BARCODE` | `products{sku}`, `{barcode}` | **T2** |
| `PATCH /products/:id` | 15.2 + `version` | `STALE_WRITE, DUPLICATE_BARCODE` | `products{_id}` | — (single-doc conditional) |
| `POST /products/:id/archive` | — | `409` (qty ≠ 0) | `products{_id}` | **T3** |
| `DELETE /products/:id` | — | `409` (has transactions) | `transactions{productId, createdAt}` | **T4** |
| `GET /products` | 15.9 | — | archived/category compounds + Atlas Search (D-1) | — |
| `GET /products/lookup` | code param | `INVALID_BARCODE, NOT_FOUND` | `products{barcode}` → `{sku}` (BR-06) | — |
| `DELETE /categories/:id` | 15.3 | `CATEGORY_IN_USE` | `products{categoryId,…}` prefix | **T5** |
| `PATCH /users/:id` | 15.6 | `LAST_ADMIN` | `users{role, isActive}` | **T6** |
| `GET /dashboard/summary` | `range ∈ {7,30,90}` | `VALIDATION_ERROR` | `transactions{createdAt}`, `products{isArchived, quantity}` | — (cached) |
| `GET /reports/:name/export` | 15.9 | `FORBIDDEN` (Staff) | report-specific | — (stream) |
| `GET /audit-logs` | 15.9 filters | — | `auditLogs` compounds | — |
| `PUT /settings` | 15.8 | `VALIDATION_ERROR` | `_id` | — (audited) |

---

## 6. Cross-Cutting Designs

- **Typed errors:** `AppError(code, status, details?)` subclasses per the §16.3 catalog; services throw, controllers never catch (except to translate third-party errors into typed ones); the terminal handler is the only failure response-writer.
- **Serialization:** one serializer module owns the wire contract (`Decimal128 → "0.00"` strings, `ObjectId → string`, ISO-8601 UTC, list envelope `{data, page, limit, totalItems, totalPages}`, password/token fields structurally excluded). Controllers never hand-format documents.
- **Idempotency helper (`lib/`):** encapsulates fast-path lookup → duplicate-key-as-replay → A-4 response reconstruction, so T1 stays readable and the pattern cannot be half-applied.
- **Configuration:** zod-validated environment at boot (SRS §18.4 inventory); missing/invalid → process exit naming the variable (NFR-28). Misconfiguration ≠ outage: DB connection failures retry with backoff while `/ready` reports false (EC-27).
- **Logging:** pino structured JSON — `timestamp, level, correlationId, userId?, method, path, status, durationMs, code?`; level policy per SRS §16.4; no PII, tokens, or raw scan payloads (SEC-12).

---

## 7. Scheduled Jobs

| Job | Schedule | Design |
|---|---|---|
| **Ledger reconciliation** (BR-18) | Daily | Per-product ledger sum vs `quantity` with snapshot reads; any drifted product re-checked once before flagging (ARB-05); drift → `warn` log (alert-worthy) + Consistency report row |
| **Orphan image sweep** (BR-38) | Daily | **Discovery mechanism (BEV-04):** Cloudinary Admin API folder listing (`ims/prod/…`) cross-referenced against `products.images.publicId`; unreferenced assets older than 24 h are destroyed. Signature scoping makes the folder listing authoritative |

**Leadership (A-8):** each tick acquires a TTL-lease document via conditional upsert so exactly one instance runs a job. The lease store — **`jobLocks` — is an operational/infrastructure collection, explicitly outside the business data model (BEV-05):** no ERD entity, no API surface, no audit; declared here so the collection-count discrepancy with DBD §2 is a documented decision. Jobs check the shutdown flag between batches (NFR-21).

---

## 8. Process Lifecycle

```text
boot:  validate config (fail fast, named variable)
       → connect Mongo (retry/backoff; /ready false meanwhile)
       → integrity check: settings singleton present + ≥1 active Admin (BR-41/30)
       → register routes/pipeline → listen → /ready true
run:   stateless request serving · leader-guarded job ticks
stop:  SIGTERM → /ready false → stop accepting → drain in-flight
       → close DB → exit 0                                  (NFR-15/21)
crash: unhandled rejection/exception → log + track → exit (host restarts)
```

---

## 9. Testing Architecture (NFR-26)

| Tier | Scope | Notes |
|---|---|---|
| Unit | Service layer — every BR traceable to ≥ 1 test | MovementService: concurrency simulation (parallel T1s on one product), replay tests (same key: identical payload → original result; different payload → `IDEMPOTENCY_CONFLICT`), transient-retry behavior |
| Integration | Every endpoint via ephemeral MongoDB (in-memory server, **replica-set mode** so T1–T6 run for real) | Auth/role/validation/error matrix generated from the §5 binding table |
| E2E smoke | login → add product → stock in → stock out → **ledger-sum check** | BR-17 as an executable assertion; CI release gate |

---

## 10. Review Findings Incorporated

| ID | Finding | Resolution |
|---|---|---|
| BEV-01 | `05-REST-API-Design.md` did not exist at validation time | **Ratified:** SRS §12 is the normative API contract; §5's binding table is the design realization; OpenAPI 3 (NFR-27) is generated at implementation. Superseded in part: `05-REST-API-Specification.md` has since been added to the series, and this document was renumbered `05` → `06` |
| BEV-02 | Refresh-rotation crash semantics unstated | Documented as **fail-closed**: crash mid-rotation → reuse detection → family revoked → re-login (consistent with EC-31); no transaction added |
| BEV-03 | "Repeated 403s" had no threshold | ≥ 5 role-denied responses / user / 15 min → one security event, fire-and-forget |
| BEV-04 | Orphan sweep had no discovery mechanism | Cloudinary folder listing × `products.images.publicId` cross-reference; no new collection |
| BEV-05 | A-8 lease store implied a 9th collection | `jobLocks` declared an operational/infrastructure collection outside the business model |

*(Also recorded as an explicit decision: no repository layer — §1 rule 3.)*

---

## 11. Assumptions & Risks

**Assumptions (carried):** A-1…A-7 (ARC §9) · **A-8** TTL-lease job leadership with `jobLocks` infra collection · AS-1…AS-20 (SRS §21) · DES-1 + DBR-03 named invariants · D-1 (Atlas Search primary, fallback preserved).

**Risks (carried):**

| ID | Risk | Gate |
|---|---|---|
| R-2 | Hot-product movement contention (A-1 majority writes) | NFR-08 load test; T1 index count kept minimal |
| R-4 | Platform proxy-header behavior varies | ARB-01 verified per environment, Phase 0 |
| R-5 | Audit-trail query plans at volume | NFR-08 plan verification |
| R-6 | Atlas Search availability on target tier | Phase 0 verification |

**Next phase — Frontend Architecture:** consume the generated OpenAPI types (never hand-written); design the Axios interceptor pair first (token attach + single-flight refresh/replay, error-envelope mapping); specify the client idempotency-key lifecycle (generate per submission attempt-group, reuse across retries, discard on success); treat scanner states (permission / no-camera / unknown / archived / duplicate-read) as first-class component states.

---

*End of document — BEA-IMS-006 v1.0 · Approved for Frontend Architecture · 2026-07-23*
