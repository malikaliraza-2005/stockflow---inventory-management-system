# System Architecture

## Web-Based Inventory Management System

| | |
|---|---|
| **Document ID** | ARC-IMS-002 |
| **Version** | 1.0 (Approved) |
| **Date** | 2026-07-22 |
| **Status** | **APPROVED FOR ERD DESIGN** |
| **Source of truth** | SRS-IMS-001 v1.0 (`01-SRS.md`) — this document implements it and never overrides it |
| **Prepared by** | Lead Software Architect |

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Components & Responsibilities](#2-components--responsibilities)
3. [Communication & Data Flows](#3-communication--data-flows)
4. [Technology Stack](#4-technology-stack)
5. [Deployment Architecture](#5-deployment-architecture)
6. [Quality Attributes](#6-quality-attributes)
7. [Architectural Patterns & Principles](#7-architectural-patterns--principles)
8. [Review Refinements (ARB-01…05)](#8-review-refinements-arb-0105)
9. [Architectural Assumptions](#9-architectural-assumptions)
10. [Risks](#10-risks)
11. [Traceability](#11-traceability)
12. [ERD Phase Handoff](#12-erd-phase-handoff)

---

## 1. Architecture Overview

### 1.1 Style: Modular Monolith + SPA

A single, layered, **stateless** backend service (modular monolith) with a statically hosted SPA client — explicitly **not** microservices.

| Consideration | Rationale |
|---|---|
| Scale envelope | SRS targets 10k products / 500k Transactions / 50 concurrent users (NFR-12, AS-18) — fits one well-indexed service with margin; distribution would add cost without a driver |
| Transactional integrity | The ledger invariant `product.quantity == Σ ledger` (BR-17) requires atomic multi-document writes (BR-19). In one service against one replica set this is a single MongoDB transaction; across services it becomes a distributed-saga problem the SRS never asks for |
| Modularity without distribution | Internal service-module seams align to future extensions (SRS §20, EXT-02) so later extraction is possible but never forced |
| Statelessness | NFR-09: no server-local session state; refresh tokens live in MongoDB. Any instance serves any request — horizontal scaling is configuration, not code |

### 1.2 System Context

```text
┌────────────┐   HTTPS    ┌─────────────┐   HTTPS/TLS   ┌───────────────┐
│  Operator  │──browser──▶│  SPA (CDN)  │               │ MongoDB Atlas  │
│ Admin/Staff│            └──────┬──────┘               │  replica set   │
└────────────┘                   │ /api/v1 (Bearer +    └───────▲───────┘
      │  camera (ZXing)          │  refresh cookie)             │ Mongoose,
      ▼                          ▼                              │ least-priv
┌────────────┐          ┌─────────────────┐                     │
│  Physical  │          │  Express API    │─────────────────────┘
│  barcodes  │          │  (N instances)  │──sign──┐
└────────────┘          └────────┬────────┘        ▼
                                 │           ┌────────────┐
              health/metrics ◀───┤           │ Cloudinary │◀─direct upload─ browser
   (uptime monitor, deploy gate) │           └────────────┘
                                 ▼
                     Error tracking + log sink
```

### 1.3 Layered Pattern (normative, NFR-24)

```text
┌───────────────────────────── Backend service ─────────────────────────────┐
│  Routes        → URL surface only (/api/v1/*)                             │
│  Middleware    → health(/health,/ready) → helmet → cors → compression →   │
│                  rate limiters → json(1MB) → mongo-sanitize →             │
│                  correlation-ID → auth (JWT + per-request user load) →    │
│                  authorize(role) → validate(schema)      (order per ARB-04)│
│  Controllers   → HTTP concerns only: shape request/response               │
│  Services      → ALL business rules (SRS §6 BR-01…41 live here, only here)│
│  Models        → Mongoose schemas, indexes, schema-level guards (min: 0)  │
│  Jobs          → ledger reconciliation (BR-18), orphan-image sweep (BR-38)│
└───────────────────────────────────────────────────────────────────────────┘
```

**Governing rule:** **MovementService is the single writer of `product.quantity`.** No other code path may mutate stock — the ledger invariant is structural, not aspirational.

---

## 2. Components & Responsibilities

### 2.1 Frontend (React 18 · Vite · TypeScript · Tailwind · Zustand · Axios · Recharts · ZXing)

| Component | Responsibility | Traces to |
|---|---|---|
| **App shell & router** | Lazy route-split pages for all 14 SRS §9 pages; `RequireAuth` / `RequireRole` guards (UX only — never the security boundary) | §5.3, NFR-06 |
| **API client layer** | Single Axios instance; interceptors: attach access token, **single-flight** silent refresh + one replay on 401 (ARB-03), map error envelope → user messages via one code table | FR-AUTH-02, §16 |
| **Zustand stores** | `authStore` (session, user, role), `uiStore` (dialogs/toasts), `settingsStore`; server data fetched per page, never duplicated globally | NFR-25 |
| **Scanner module** *(lazy chunk)* | ZXing camera decode, 2 s duplicate-read coalescing, payload validation (printable, ≤ 64 chars), permanent manual-entry fallback, permission-state UI | §3.6, BR-16, NFR-35 |
| **Movement dialogs** | Stock In / Out / Adjustment forms; idempotency-key generation per submission attempt-group; large-movement confirmation | FR-INV-06/07, BR-15 |
| **Chart panel** *(lazy chunk)* | Recharts dashboards (7/30/90-day ranges) | FR-DASH-02, NFR-06 |
| **QR label renderer** | Client-side SKU-encoded printable labels — zero backend dependency | FR-PROD-08 |

### 2.2 Backend service modules (Node.js 20 LTS · Express 4 · JWT · bcrypt · Mongoose 8)

| Service | Responsibility | Traces to |
|---|---|---|
| **AuthService** | Credential verify (bcrypt cost 12), lockout counters, token issue/rotation, reuse-detection family revocation, reset tokens | FR-AUTH-01…07, BR-32…35 |
| **UserService** | Provisioning, lifecycle, atomic last-admin guard, immediate session revocation on demotion/deactivation | FR-USER-01…06, BR-29/30 |
| **ProductService** | Catalog CRUD, SKU normalize/auto-generate (counters), optimistic concurrency, archive/restore/hard-delete with atomic predicates | FR-PROD-*, BR-01…07, BR-21…25 |
| **CategoryService** | Flat taxonomy; atomic referential delete with reassignment | BR-26…28 |
| **MovementService** ⚠ | *Sole mutator of `product.quantity`.* Conditional update + Transaction insert in one Mongo transaction; idempotency fast-path lookup with unique-index backstop (ARB-02); bounded transient-conflict retry | BR-11/17/19/20, FR-INV-* — **change-controlled** |
| **AuditService** | Append-only entity diffs + security events; invoked by every mutating service | FR-TXN-04/05 |
| **DashboardService** | Single aggregation pipeline; 30–60 s cache; `asOf` stamping | FR-DASH-03, NFR-11 |
| **ReportService** | Ledger-derived reports; streamed CSV (Admin gate); consistency report | FR-RPT-*, BR-40 |
| **UploadService** | Cloudinary signatures, destroys, orphan bookkeeping | SEC-08, BR-36…38 |
| **Jobs runtime** | Reconciliation (BR-18, snapshot reads per ARB-05) + orphan sweep (BR-38), leader-guarded (A-3) | NFR-23 alerting on drift |

### 2.3 Data plane & external services

| Component | Responsibility | Traces to |
|---|---|---|
| **MongoDB Atlas (replica set)** | System of record: 8 collections (SRS §10) with the full index set; replica set is mandatory (multi-document transactions) | BR-19, SCA-02 |
| **Cloudinary** | Media storage / CDN / transformations; browser uploads directly with backend-issued signatures — image bytes never transit the API; never on the movement critical path | SEC-08, NFR-16 |
| **Observability stack** | Structured JSON logs (correlation IDs), metrics (rate / p95 / errors), error tracking (both tiers), external uptime monitor | NFR-17/23, SEC-12 |

---

## 3. Communication & Data Flows

### 3.1 Request lifecycle (every authenticated call)

```text
Browser ──HTTPS──▶ Middleware chain ──▶ Controller ──▶ Service ──▶ Atlas
   ▲                │ 1. verify JWT signature/expiry
   │                │ 2. load user record (indexed point-read)  ← FR-AUTH-07:
   │                │    deactivated → 401 · demoted → 403        immediate effect
   │                │ 3. role gate (§5 matrix) → schema validation
   └── JSON (list envelope or §16.2 error envelope + correlation ID)
```

### 3.2 Stock Movement — the load-bearing flow

```text
Client                          API (MovementService)              Atlas
  │ POST /inventory/movements     │                                  │
  │ Idempotency-Key: K ──────────▶│ lookup Transaction by K ────────▶│
  │                               │  hit → return stored outcome     │ (replay fast path)
  │                               │ withTransaction (majority, A-1): │
  │                               │   findOneAndUpdate(product,      │
  │                               │     {isArchived:false,           │
  │                               │      quantity ≥ requested})      │ ← BR-11/22 guard
  │                               │   insert Transaction(K)          │ ← BR-17 ledger
  │                               │   duplicate-key on K? → abort,   │
  │                               │     re-read, return original     │ ← ARB-02 backstop
  │                               │ commit ── bounded retry on ──────│ (transient only)
  │ ◀── {transaction, product} ───│                                  │
  │ (timeout? retry with SAME K — committed work never re-executes)  │
```

Failure semantics: predicate miss → `INSUFFICIENT_STOCK` / `PRODUCT_ARCHIVED` (never retried); commit failure → nothing observable (BR-19); response lost → replay by key returns the stored outcome (A-4).

### 3.3 Authentication & authorization flow

```text
Login ──▶ bcrypt verify + counters ──▶ access JWT (client memory, 15 min)
                                    └▶ rotating refresh cookie (httpOnly·Secure·
                                       SameSite=Strict, 7 d, hashed + familyId)
401 on any call ──▶ single-flight POST /auth/refresh (rotate) ──▶ replay once (ARB-03)
Rotated-token reuse ──▶ revoke family + security event (BR-35; multi-tab accepted per SRS EC-31)
Authorization: every request re-checks the live user record — token claims are informational only
```

### 3.4 File upload flow

`POST /upload/signature` (Admin) → browser uploads **directly** to Cloudinary → attach `{publicId, url}` on product save → failed save destroys the asset → nightly sweep removes unattached assets > 24 h (BR-38). Rendering uses transformation-URL thumbnails (NFR-06); placeholder on absence or load error (BR-37).

### 3.5 QR / barcode scanning workflow

Decode (or manual entry) → validate payload as opaque untrusted string (BR-16) → `GET /products/lookup?code=` resolving barcode-then-SKU (BR-06) → confirmation card → movement dialogs (→ §3.2). Unknown code: role-dependent outcome (FR-SCAN-04); archived product: status surfaced, never "not found" (FR-SCAN-05).

### 3.6 Dashboard data flow

One aggregation-pipeline endpoint per range (7/30/90) → per-instance cache 30–60 s (A-2) → `asOf` surfaced in UI (NFR-11, BR-25).

### 3.7 Error handling & logging flow

- Single terminal error middleware; services throw typed errors; §16.3 catalog maps code → HTTP → user message.
- Every response carries the correlation ID; frontend surfaces it in error toasts; React error boundaries prevent blank screens; forms preserve input on any error.
- Structured JSON logs (`timestamp, level, correlationId, userId?, method, path, status, durationMs, code?`); `error` = 5xx/integrity, `warn` = 409/422/423/429 + lockouts + reconciliation drift; no PII/tokens/raw scan payloads (SEC-12).
- Unexpected errors → error tracking + opaque `500` with correlation ID.

---

## 4. Technology Stack

The stack is **fixed by the SRS**; recommendations below fill only the latitude it leaves.

| Layer | Fixed by SRS | Architecture recommendation (latitude) |
|---|---|---|
| Frontend | React / Vite / TS / Tailwind / Zustand / Axios / Recharts / ZXing | `react-router-dom` v6 lazy routes; `zod` client validation mirroring server schemas; `qrcode.react` (FR-PROD-08) |
| Backend | Node.js / Express / JWT / bcrypt | Node 20 LTS + Express 4 (A-5); `zod` for §12.4 schemas; `pino` logging; `helmet`, `express-rate-limit`, `express-mongo-sanitize`, `compression`, `cookie-parser`, `node-cron` per SRS §17 |
| Data | MongoDB Atlas + Mongoose | Mongoose 8 sessions (BR-19); `Decimal128` money (§10); **majority write/read concern on movement transactions** (A-1) |
| Media | Cloudinary | Signed uploads only (SEC-08) |
| Contract | OpenAPI 3 (NFR-27) | Types generated into the client at build; CI drift check |

---

## 5. Deployment Architecture

```text
                    ┌── CI/CD (SRS §18.3) ──────────────────────────────┐
                    │ lint→type→unit→integration→build→CVE scan→staging │
                    │ →E2E smoke→gate→rolling prod deploy (health-gated)│
                    └───────────────────────────────────────────────────┘
   PRODUCTION
   ┌──────────────┐      ┌──────────────────────────────┐     ┌─────────────────┐
   │ CDN / static │      │ App platform (trust-proxy    │     │ Atlas M10+      │
   │ host (SPA)   │      │  configured per ARB-01)      │     │ 3-node replica  │
   │ HSTS, hashed │      │ ┌─────────┐  ┌─────────┐     │────▶│ set, snapshots, │
   │ assets       │      │ │ api-1   │  │ api-2   │ …   │ TLS │ IP-restricted   │
   └──────────────┘      │ └─────────┘  └─────────┘     │     └─────────────────┘
                         │  LB + /ready health gate     │     ┌─────────────────┐
                         │  jobs: leader-guarded (A-3)  │     │ Cloudinary env  │
                         └──────────────┬───────────────┘     └─────────────────┘
                                        ▼
                         uptime monitor · error tracking · log sink · alerts
```

- **Environments:** dev → staging → prod, config-shape-identical (NFR-28); separate Atlas projects and Cloudinary environments; distinct secrets (SEC-10).
- **Scaling path:** stateless API → add instances; Atlas tier bump covers the SRS ceiling with headroom; no re-architecture before well past NFR-12 targets.
- **Availability:** ≥ 2 production instances; rolling deploys gated on `/ready`; graceful drain (NFR-15/21); degraded modes per NFR-16.
- **Recovery:** Atlas snapshots, RPO ≤ 24 h / RTO ≤ 4 h, quarterly staging restore drills (NFR-22).
- **Rate limiting note:** per-IP limits are per-instance (≈ N× nominal allowance at N instances) — acceptable because the DB-backed account lockout (BR-33) is global and authoritative; operators tune limits with instance count in mind.

---

## 6. Quality Attributes

### 6.1 Scalability

Stateless horizontal scaling (NFR-09); named index per query pattern with a no-collection-scan acceptance criterion (SCA-02); hard list caps `limit ≤ 100` (NFR-10); cached aggregates keep dashboard polling off the DB (NFR-11); ledger growth math documented with cold-archival reserved (FE-11).

### 6.2 Security

Defense in depth: UI guards → route authorization → per-request DB check → schema constraints. Session hygiene per SEC-01 + BR-35 with single-flight refresh (ARB-03). Hostile-input posture: schema validation everywhere, `$`-operator sanitization, opaque scan payloads (SEC-06/07, BR-16). Signed-only uploads, least-privilege DB user, platform secret manager, CI CVE gates, opaque production errors (SEC-08…12). Correct client-IP attribution via strict proxy trust (ARB-01).

### 6.3 Performance

Budgets per NFR-01…03, verified by the Phase 6 load test with query-plan checks (NFR-08). List projections only; ZXing/Recharts lazy chunks off the login path; Cloudinary thumbnails; virtualized tables; brotli + immutable asset caching (NFR-05…07). Per-request user load is one indexed point-read inside the NFR-01 budget (NFR-04).

### 6.4 Reliability & Availability

Atomic conditional updates avoid lock contention; idempotency makes retry storms harmless (NFR-19); DB timeouts fail fast ≤ 10 s (NFR-20); graceful shutdown (NFR-21); reconciliation job monitors the invariant (BR-18, ARB-05); health-gated rolling deploys and degraded modes deliver the 99.5% target (NFR-13…17).

---

## 7. Architectural Patterns & Principles

| Pattern | Where | SRS driver |
|---|---|---|
| **Single-writer invariant** | MovementService owns `quantity` | BR-17 |
| **Conditional atomic update** | Movements, archive, hard delete, last-admin, category delete | BR-11/22/23/27/30 |
| **Idempotency-key dedup (index-backstopped)** | Movement mutations | BR-20, NFR-19, ARB-02 |
| **Ledger / event-sourcing-lite** | Append-only Transactions; `quantity` as materialized state, job-reconciled | BR-17/18/40, FE-7/8 |
| **Contract-first** | OpenAPI normative; generated types both ways | NFR-27, EXT-04 |
| **Defense-in-depth authorization** | Four layers, per-request revocation effect | §5.3, FR-AUTH-07 |
| **Fail-fast config, fail-safe runtime** | Boot-time config schema vs. runtime DB retry/backoff | NFR-20/28 |
| **Cache-aside with staleness contract** | Dashboard aggregates | NFR-11, BR-25 |

---

## 8. Review Refinements (ARB-01…05)

Applied at architectural sign-off; no scope change, no SRS modification.

| ID | Refinement |
|---|---|
| **ARB-01 (High)** | **Client-IP correctness behind the LB.** Strict trust-proxy configuration (trusting exactly the platform's proxy hop, never blanket `X-Forwarded-For`) is a per-environment deployment requirement; without it, rate limiting (SEC-04) collapses to one shared bucket or becomes spoofable, and security-event IPs (FR-TXN-05) are corrupt. Verified per environment in Phase 0 (Risk R-4). |
| **ARB-02 (High)** | **Idempotency race resolution.** Concurrent same-key submissions can both miss the replay fast path; the sparse unique index is the authoritative dedup: a duplicate-key failure on `idempotencyKey` aborts the transaction, re-reads the stored Transaction, and returns the original outcome as a replay — never surfaces as an error. |
| **ARB-03 (Medium)** | **Single-flight refresh.** One in-flight refresh promise per client; all 401-ed requests await it and replay once — prevents parallel refreshes from tripping BR-35 reuse detection. Cross-tab collisions remain accepted per SRS EC-31. |
| **ARB-04 (Low)** | **Health endpoints precede limiters/auth** in the middleware chain; a limited or authenticated probe would fail deploy gates during incidents. |
| **ARB-05 (Low)** | **Reconciliation reads use snapshot consistency** (or re-check drifted products once) so the Consistency report never flags in-flight writes as drift. |

---

## 9. Architectural Assumptions

Decisions the SRS leaves open — ratify at design review. SRS §21 assumptions (AS-1…AS-20) remain in force unchanged.

| # | Assumption | Why necessary |
|---|---|---|
| **A-1** | Movement transactions use **majority write/read concern** | BR-19 forbids observable partial state; defaults could roll back acknowledged writes on failover |
| **A-2** | Dashboard cache is **per-instance in-memory** (no Redis) | NFR-09 requires loss-tolerant caches; worst-case staleness stays within BR-25/AS-14 bounds at 2–3 instances |
| **A-3** | Scheduled jobs run under a **DB-lease leader guard** | SRS mandates the jobs, not multi-instance coordination; prevents N instances running N sweeps |
| **A-4** | Idempotent replays are **reconstructed from the stored Transaction** | Satisfies BR-20's "original result" without a response-cache store |
| **A-5** | **Node 20 LTS, Express 4.x** | SRS names no versions; LTS + stable major minimizes risk |
| **A-6** | **Monorepo** (`/client`, `/server`) with one CI pipeline | Keeps OpenAPI-generated types atomically in sync (NFR-27) |
| **A-7** | Access token in **JS memory with refresh-on-load** | SEC-01 forbids localStorage; reload re-establishes the session via the cookie |

---

## 10. Risks

| ID | Risk | Mitigation |
|---|---|---|
| R-1 | Scanner UX variance across mobile browsers | Device spike first in Phase 4 (SRS §19) |
| R-2 | Transaction latency under hot-product contention (compounded by A-1) | Gated by the Phase 6 load test (NFR-08) |
| R-3 | Solo-operator process discipline (backups, alerts, rotation) | Named ownership (AS-19) |
| R-4 | Platform proxy-header behavior differs across hosts | ARB-01 verified per environment during Phase 0 |

---

## 11. Traceability

Every component in §2 carries its SRS trace inline. The load-bearing chain:

**BR-17/19/20 → MovementService (§3.2) → A-1/A-4 + ARB-02 → SRS Roadmap Phase 3 (change-controlled: deviations return to architecture review).**

Consistency verified at sign-off: all SRS §3 FR modules have owning services and page support; every quantified NFR has a named mechanism; §5 roles enforced at four layers; §8 flows realized in §3; all 14 §9 pages routed; §10 collections and indexes carried unchanged. No inconsistency with the SRS exists.

---

## 12. ERD Phase Handoff

1. **SRS §10 is the ERD's normative input** — the ERD formalizes entities, cardinalities, and constraints; any deviation discovered is an SRS-change request, never a silent fix.
2. **Embed-vs-reference decisions:** embedded — `product.supplier` (migration path documented), `product.images`; referenced — `product.categoryId`, all `userId`/`productId` attributions; self-reference — `transaction.refTransactionId`.
3. **Carry the full index catalog**, including the behavior-bearing indexes: sparse-unique `idempotencyKey` (authoritative dedup per ARB-02) and the TTL index on `refreshTokens.expiresAt`.
4. **Annotate immutability and write paths:** `transactions` / `auditLogs` append-only; `products.quantity` writable only via MovementService; `sku` immutable post-create.
5. **Include seed state** (first Admin, settings singleton, Uncategorized category) so BR-28/BR-41 preconditions are part of the data design.
6. **Model `Decimal128` money and the `version` concurrency token explicitly** — schema decisions, not implementation detail.

---

*End of document — ARC-IMS-002 v1.0 · Approved for ERD Design · 2026-07-22*
