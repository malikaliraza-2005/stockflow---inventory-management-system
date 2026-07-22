# Database Design

## Web-Based Inventory Management System — MongoDB / Mongoose

| | |
|---|---|
| **Document ID** | DBD-IMS-004 |
| **Version** | 1.0 (Approved) |
| **Date** | 2026-07-23 |
| **Status** | **APPROVED FOR REST API DESIGN** |
| **Source of truth** | SRS-IMS-001 (`01-SRS.md`) · ARC-IMS-002 (`02-System-Architecture.md`) · ERD-IMS-003 (`03-ERD.md`) — this document conforms to all three and never overrides them |
| **Review record** | Lead Database Architect review (DBR-01…05) and Principal Database Architect validation (PDV-01…04) — all corrections incorporated below |
| **Database** | `ims` per environment · MongoDB Atlas replica set · Mongoose 8 |

---

## Table of Contents

1. [Design Conventions](#1-design-conventions)
2. [Collections](#2-collections)
3. [Index Catalog & Endpoint Mapping](#3-index-catalog--endpoint-mapping)
4. [Transaction Boundaries & Write Concerns](#4-transaction-boundaries--write-concerns)
5. [Validation Strategy](#5-validation-strategy)
6. [Append-Only Enforcement (DES-1)](#6-append-only-enforcement-des-1)
7. [Normalization & Formatting Rules](#7-normalization--formatting-rules)
8. [Seed Specification](#8-seed-specification)
9. [Review Findings Incorporated](#9-review-findings-incorporated)
10. [Coverage, Assumptions & Risks](#10-coverage-assumptions--risks)

---

## 1. Design Conventions

| Convention | Decision | Driver |
|---|---|---|
| Primary keys | `ObjectId _id` everywhere except `counters` (keyed by prefix string) | No natural key is system-stable |
| Timestamps | `createdAt` / `updatedAt` (Mongoose timestamps), UTC — **disabled (`updatedAt`) on the two append-only collections** | BR-39, NFR-33, FR-TXN-02 |
| Money | `Decimal128`, 2 dp; serialized as strings (`"5.99"`) at the API and inside audit diffs (DBR-05) | SRS §10, BR-08 |
| Concurrency | Explicit int `version` on `products`, incremented on catalog writes only (movements never touch it); Mongoose default `__v` disabled/ignored in favor of it | BR-24 |
| Write/read concern | `w: "majority"` + `readConcern: "majority"` inside all multi-document transactions; server defaults elsewhere | BR-19, A-1 (ratified) |
| Validation | Dual-layer: Mongoose schemas **and** MongoDB JSON-schema validators (`validationLevel: strict`) | BR-10 defense-in-depth |
| Case-insensitivity | Two deliberate strategies: SKU **normalized** (stored uppercase — collation-free index serves the scanner hot path); category name via **collation index** (`locale: en, strength: 2`) preserving display casing | BR-02 vs BR-26 |
| Sparse-field rule | Optional uniquely-indexed fields (`barcode`, `idempotencyKey`, `resetTokenHash`) are **unset when absent — never empty-string** (PDV-04) | Prevents spurious 409s |
| TTL semantics | TTL indexes are **garbage collection only**; validity is always checked against `expiresAt`/`revokedAt` values at use time (PDV-03) | Session security |
| Append-only | `transactions`, `auditLogs`: no update/delete code paths (DES-1, §6) | FR-TXN-02 |

---

## 2. Collections

### 2.1 `users` — accounts, roles, lifecycle, lockout *(ERD: User)*

**Purpose:** operator accounts; permanent (deactivated, never deleted — BR-29) so all attribution resolves forever.

```json
{ "_id": "…", "name": "Sara An", "email": "sara@example.com",
  "passwordHash": "$2b$12$…", "role": "ADMIN", "isActive": true,
  "mustChangePassword": false, "failedLoginCount": 0, "lockedUntil": null,
  "lastLoginAt": "2026-07-22T08:11:04Z", "createdAt": "…", "updatedAt": "…" }
```

| Field | Type | Req | Default | Constraints |
|---|---|---|---|---|
| `name` | String | ✔ | — | 2–80, trimmed |
| `email` | String | ✔ | — | valid, lowercased, **unique** |
| `passwordHash` | String | ✔ | — | bcrypt cost 12; `select: false` — excluded from every query by default |
| `role` | String | ✔ | — | enum `ADMIN` \| `STAFF` |
| `isActive` | Boolean | ✔ | `true` | BR-29 |
| `mustChangePassword` | Boolean | ✔ | `true` | set on provisioned/reset passwords |
| `failedLoginCount` | Int | ✔ | `0` | BR-33 |
| `lockedUntil` | Date | — | — | set on 5th consecutive failure |
| `resetTokenHash` | String | — | *unset* | hashed, single-use; PDV-04 rule applies |
| `resetTokenExpiresAt` | Date | — | — | 30 min after issue |
| `lastLoginAt` | Date | — | — | Users page display |

**Indexes:** `{email:1}` unique · `{role:1, isActive:1}` (atomic last-admin count, BR-30) · `{resetTokenHash:1}` **sparse** (reset-flow lookup, DBR-04) · implicit `_id` (**hot path:** per-request user load, FR-AUTH-07 / NFR-04).

**Integrity:** last-admin guard runs as a conditional count-and-update inside a transaction (BR-30, EC-13).

### 2.2 `categories` — flat taxonomy *(ERD: Category)*

**Purpose:** product classification; includes the permanent system member **Uncategorized**.

```json
{ "_id": "…", "name": "Electronics", "description": "Cables, chargers, accessories",
  "isSystem": false, "createdAt": "…", "updatedAt": "…" }
```

| Field | Type | Req | Default | Constraints |
|---|---|---|---|---|
| `name` | String | ✔ | — | 2–60; **unique via collation index** (`strength: 2`) |
| `description` | String | — | — | ≤ 300 |
| `isSystem` | Boolean | ✔ | `false` | `true` only for Uncategorized — undeletable (BR-28) |

**Indexes:** `{name:1}` unique with collation `{locale: "en", strength: 2}`.

**Collation rule:** every query matching on `name` must pass the same collation or the unique index is bypassed for matching; CategoryService is the single home of category-name queries and always applies it.

**Integrity:** delete = transaction { assert zero `products.categoryId` references (active **and** archived) → optional bulk reassignment → delete } (BR-27, EC-11).

### 2.3 `products` — catalog + materialized stock *(ERD: Product + value objects)*

**Purpose:** catalog items; `quantity` is the ledger-derived current stock (DN-1), **written only by MovementService**.

```json
{ "_id": "…", "name": "USB-C Cable 1m", "sku": "ELEC-00042",
  "barcode": "8412345678905", "description": "Braided, 60W",
  "categoryId": "…", "costPrice": {"$numberDecimal": "2.10"},
  "sellingPrice": {"$numberDecimal": "5.99"}, "quantity": 125,
  "lowStockThreshold": 20,
  "supplier": { "name": "Acme Trading", "phone": "+1-555-0100" },
  "images": [ { "publicId": "ims/prod/abc123", "url": "https://…", "isPrimary": true } ],
  "isArchived": false, "version": 3, "createdAt": "…", "updatedAt": "…" }
```

| Field | Type | Req | Default | Constraints |
|---|---|---|---|---|
| `name` | String | ✔ | — | 2–120 |
| `sku` | String | ✔ | auto (BR-04) | `^[A-Z0-9-]{3,32}$`, stored uppercase, **unique, immutable** (BR-01…03) |
| `barcode` | String | — | *unset* | trimmed, ≤ 64; **sparse unique** (BR-05); PDV-04 rule |
| `description` | String | — | — | ≤ 2,000 |
| `categoryId` | ObjectId → categories | ✔ | — | existence validated in-transaction where racy (BR-27) |
| `costPrice` / `sellingPrice` | Decimal128 | ✔ | — | ≥ 0, 2 dp (BR-08) |
| `quantity` | Int | ✔ | `0` | `min: 0` at schema **and** validator level (BR-10); DN-1 single-writer |
| `lowStockThreshold` | Int | ✔ | copied from settings (DN-3) | ≥ 0 |
| `supplier` | Subdoc 0..1 | — | — | `{name ≤ 120, contactName?, phone? ≤ 30, email?}` — embedded value object (OS-2 / FE-3) |
| `images` | Array ≤ 5 | — | `[]` | `{publicId, url, isPrimary}`; **exactly one primary when non-empty — service-enforced invariant** (DBR-03, BR-36) |
| `isArchived` | Boolean | ✔ | `false` | BR-21…22 |
| `version` | Int | ✔ | `0` | optimistic concurrency (BR-24 → `STALE_WRITE`) |

**Indexes:** `{sku:1}` unique · `{barcode:1}` unique **sparse** · `{categoryId:1, isArchived:1, createdAt:-1}` (category-filtered lists + referential checks via prefix, DBR-02) · `{isArchived:1, quantity:1}` (low/out-of-stock + dashboard counts) · `{isArchived:1, createdAt:-1}` (default list sort) · **Search (D-1, resolved): Atlas Search index** with `edgeGram (2–15)` analyzers over `name`, `sku`, `barcode`, filtered by `isArchived`. Fallback if the target tier lacks Atlas Search (verify in Phase 0, R-6): normalized lowercase auxiliary fields with anchored-prefix regex, or a bounded scan of ≤ 10k active products proven against NFR-01 in the NFR-08 load test (ERD §7).

### 2.4 `transactions` — append-only stock ledger *(ERD: Transaction)* ∎

**Purpose:** one immutable entry per Stock Movement; collectively the source of truth for quantity (BR-17). **No `updatedAt`; no update/delete path exists (DES-1).**

```json
{ "_id": "…", "productId": "…", "type": "STOCK_OUT", "quantityChange": -25,
  "quantityAfter": 125, "userId": "…", "reason": null, "note": "Order #1042",
  "refTransactionId": null, "idempotencyKey": "9f2c7a1e-…",
  "createdAt": "2026-07-22T14:03:11Z" }
```

| Field | Type | Req | Constraints |
|---|---|---|---|
| `productId` | ObjectId → products | ✔ | |
| `type` | String | ✔ | enum `STOCK_IN` \| `STOCK_OUT` \| `ADJUSTMENT` \| `INITIAL` |
| `quantityChange` | Int | ✔ | signed, ≠ 0 (BR-12) |
| `quantityAfter` | Int | ✔ | ≥ 0 snapshot (DN-2, BR-40) |
| `userId` | ObjectId → users | ✔ | server-derived actor (BR-39) |
| `reason` | String | cond. | required iff `ADJUSTMENT`; enum `DAMAGED, LOST, FOUND, COUNT_CORRECTION, RETURN, OTHER` (BR-13) |
| `note` | String | cond. | ≤ 500; required iff `reason = OTHER` |
| `refTransactionId` | ObjectId → transactions | — | compensations (R7, BR-17) |
| `idempotencyKey` | String | — | **sparse unique** — the authoritative dedup (BR-20, ARB-02); *unset* on `INITIAL`/compensations (PDV-04) |
| `createdAt` | Date | ✔ | server clock, UTC, immutable |

**Indexes:** `{productId:1, createdAt:-1}` (history, reconciliation) · `{createdAt:-1}` (ledger list, dashboard, reports) · `{userId:1, createdAt:-1}` · `{type:1, createdAt:-1}` (filters, charts) · `{idempotencyKey:1}` unique sparse.

**Integrity:** inserted **only** inside the movement transaction with the product update (BR-19); duplicate-key on `idempotencyKey` → abort, re-read, return original outcome as a replay (ARB-02).

### 2.5 `refreshTokens` — sessions *(ERD: Session)*

**Purpose:** server-side session store enabling rotation, revocation, and reuse detection (BR-35).

```json
{ "_id": "…", "userId": "…", "tokenHash": "sha256:9a1f…", "familyId": "fam_c81d…",
  "expiresAt": "2026-07-29T08:11:04Z", "rotatedAt": null, "revokedAt": null,
  "ip": "203.0.113.7", "userAgent": "Mozilla/5.0 (iPhone…)", "createdAt": "…" }
```

| Field | Type | Req | Constraints |
|---|---|---|---|
| `userId` | ObjectId → users | ✔ | |
| `tokenHash` | String | ✔ | **unique**; raw token exists only in the cookie |
| `familyId` | String | ✔ | rotation family; reuse of a rotated token revokes the family |
| `expiresAt` | Date | ✔ | **TTL index target** (7 d) — cleanup only; validity checked by value (PDV-03) |
| `rotatedAt` / `revokedAt` | Date | — | rotated-but-retained rows are what make reuse detectable |
| `ip`, `userAgent` | String | — | security-event context |

**Indexes:** `{tokenHash:1}` unique · `{userId:1}` (revoke-all) · `{familyId:1}` (family revocation) · TTL `{expiresAt:1}`.

### 2.6 `auditLogs` — entity changes + security events *(ERD: AuditLogEntry)* ∎

**Purpose:** append-only record of who changed non-stock state, with before/after diffs and security events. **No `updatedAt`; no update/delete path (DES-1).**

```json
{ "_id": "…", "actorId": "…", "entityType": "PRODUCT", "entityId": "…",
  "action": "UPDATE", "entityLabel": "USB-C Cable 1m (ELEC-00042)",
  "changes": [ { "field": "costPrice", "before": "2.10", "after": "2.35" } ],
  "ip": "203.0.113.7", "createdAt": "…" }
```

| Field | Type | Req | Constraints |
|---|---|---|---|
| `actorId` | ObjectId → users | ✔ | server-derived |
| `entityType` | String | ✔ | enum `PRODUCT` \| `CATEGORY` \| `USER` \| `SETTINGS` \| `SECURITY` |
| `entityId` | ObjectId | cond. | absent for some security events |
| `action` | String | ✔ | **closed enum (PDV-01):** `CREATE, UPDATE, ARCHIVE, RESTORE, DELETE, LOGIN_SUCCESS, LOGIN_FAILED, LOCKOUT, PASSWORD_RESET_ISSUED, PASSWORD_RESET_COMPLETED, PASSWORD_CHANGED, ROLE_CHANGE, DEACTIVATE, REACTIVATE, TOKEN_REUSE_DETECTED` |
| `entityLabel` | String | ✔ | **DN-4 (ERB-01)** — display identity captured at write time (product name + SKU / category name / user email); renders after hard deletes |
| `changes` | Array | — | `{field, before, after}`; money as API strings (DBR-05); **sensitive fields (passwordHash, token hashes) are never diffed** |
| `ip` | String | — | security events |
| `createdAt` | Date | ✔ | immutable |

**Indexes (R-5):** `{entityType:1, createdAt:-1}` · `{actorId:1, createdAt:-1}` · `{entityId:1, createdAt:-1}` — cover every `/audit-logs` filter combination.

### 2.7 `settings` — seeded singleton *(ERD: Settings)*

**Purpose:** system configuration; missing document = startup integrity failure (BR-41). Defaults are **copied** at product creation (DN-3), not referenced.

```json
{ "_id": "…", "currency": "USD", "defaultLowStockThreshold": 10,
  "movementWarningThreshold": 1000, "createdAt": "…", "updatedAt": "…" }
```

| Field | Type | Req | Default | Constraints |
|---|---|---|---|---|
| `currency` | String | ✔ | `"USD"` | ISO 4217 |
| `defaultLowStockThreshold` | Int | ✔ | `10` | ≥ 0 |
| `movementWarningThreshold` | Int | ✔ | `1000` | ≥ 1 |

No indexes beyond `_id`. Changes are audited (FR-TXN-04).

### 2.8 `counters` — SKU sequences *(ERD: Counter)*

**Purpose:** atomic sequence source for SKU auto-generation (BR-04).

```json
{ "_id": "ELEC", "seq": 42 }
```

Advanced via atomic `findOneAndUpdate` + `$inc` with upsert (first-creation upsert races retry on duplicate `_id`). **Formatting rule (PDV-02):** auto-generated SKUs are `<PREFIX>-<seq zero-padded to 5>` (e.g., `ELEC-00042`); past 99999 the number simply widens — no reset, no reuse. No additional indexes.

---

## 3. Index Catalog & Endpoint Mapping

Acceptance criterion (SCA-02 / NFR-08): each mapped query shows its expected plan at 10k products / 500k transactions — **no COLLSCAN on any row below.**

| Index | Serves (SRS §12) | Expected plan |
|---|---|---|
| `users {email}` unique | `POST /auth/login` | IXSCAN point |
| `users {_id}` | every authenticated request (auth middleware) | ID point-read |
| `users {role, isActive}` | `PATCH /users/:id` last-admin guard | covered count |
| `users {resetTokenHash}` sparse | `POST /auth/reset-password` | IXSCAN point |
| `categories {name}` unique + collation | `POST/PATCH /categories` duplicate check | IXSCAN point |
| `products {sku}` unique | `GET /products/lookup` (BR-06 fallback), duplicate guard | IXSCAN point |
| `products {barcode}` unique sparse | `GET /products/lookup` (BR-06 primary) | IXSCAN point |
| `products {categoryId, isArchived, createdAt}` | `GET /products?categoryId=`, category referential checks (prefix) | bounded IXSCAN + sort-free |
| `products {isArchived, quantity}` | dashboard low/out-of-stock; `stockStatus` filter | bounded IXSCAN |
| `products {isArchived, createdAt}` | `GET /products` default sort | IXSCAN + limit |
| Atlas Search (D-1) | `GET /products?search=` | search index — no scan |
| `transactions {productId, createdAt}` | product history; reconciliation sums (BR-18) | bounded IXSCAN |
| `transactions {createdAt}` | ledger list, dashboard ranges, transaction report | range IXSCAN |
| `transactions {type, createdAt}` | type filters, movement charts | range IXSCAN |
| `transactions {userId, createdAt}` | per-user ledger filter | bounded IXSCAN |
| `transactions {idempotencyKey}` unique sparse | movement replay fast path + ARB-02 backstop | point |
| `refreshTokens {tokenHash}` unique / `{userId}` / `{familyId}` / TTL | refresh, revoke-all, family revocation, expiry cleanup | point / covered |
| `auditLogs` ×3 compound | `GET /audit-logs` filters | bounded IXSCAN |

**Deliberate accepted costs:** (1) inventory-value aggregation scans active products (~10k) behind the 30–60 s dashboard cache (NFR-11) — revisit past ~100k products; (2) `skip/limit` pagination is bounded by `limit ≤ 100` and range-filtered queries (mandatory range on the transaction report); range-cursor pagination is the documented future optimization, not a v1 behavior.

---

## 4. Transaction Boundaries & Write Concerns

All boundaries run as a single MongoDB multi-document transaction with `w: "majority"` / `readConcern: "majority"` (A-1, ratified).

| # | Operation | Boundary contents |
|---|---|---|
| T1 | Stock Movement | conditional `findOneAndUpdate` product (`isArchived: false`; `quantity ≥ requested` for negatives) + insert Transaction. Duplicate key on `idempotencyKey` → abort, re-read, return original (ARB-02) |
| T2 | Product create with initial quantity | insert product + insert `INITIAL` Transaction |
| T3 | Archive | conditional update (`quantity == 0` predicate) + audit entry (BR-22) |
| T4 | Hard delete | assert zero transactions + delete + audit entry (BR-23); Cloudinary destroy after commit, sweep backstops (BR-38) |
| T5 | Category delete | assert/reassign references + delete + audit entry (BR-27) |
| T6 | Last-admin guard | count active admins + apply role/status change + revoke sessions + audit entry (BR-30) |

Transient-conflict retries: bounded, server-side, on `TransientTransactionError` labels only (NFR-18, EC-25). Reconciliation (BR-18) reads with snapshot consistency, or re-checks drifted products once before flagging (ARB-05).

---

## 5. Validation Strategy

Dual-layer (BR-10): Mongoose schemas (first line, rich messages) **plus** MongoDB JSON-schema validators (`validationLevel: strict`) on every collection — required fields, `bsonType`s, enums (including the closed audit-action enum), numeric minima (`quantity ≥ 0`, `quantityAfter ≥ 0`, prices ≥ 0), string bounds, and rejection of empty strings on sparse-indexed fields (PDV-04).

**Named service-enforced invariants** (validators cannot express them — assigned owners, per DBR-03/DES-1):

| Invariant | Owner |
|---|---|
| Exactly one `isPrimary` image when `images` non-empty (BR-36) | ProductService |
| `quantity == Σ ledger` (DN-1) | MovementService (sole writer) + reconciliation job |
| Category-name collation on all name queries | CategoryService |
| Blank → absent normalization on sparse fields | Request schemas (§15) + persistence layer |

---

## 6. Append-Only Enforcement (DES-1)

1. No update/delete route exists for `/transactions` or `/audit-logs` (SRS §12 surface — verified).
2. The service layer exposes **insert-only** operations for both models; no generic repository helper accepts them.
3. Neither collection defines `updatedAt`; JSON-schema validators reject its presence.
4. Code-review rule: any diff touching these models' write paths requires architecture sign-off (Phase 3 change control).

---

## 7. Normalization & Formatting Rules

| Rule | Detail | Driver |
|---|---|---|
| SKU | trim → uppercase before validation/storage; format `^[A-Z0-9-]{3,32}$`; auto-format `<PREFIX>-<00000>` (PDV-02) | BR-02/04 |
| Email | trim → lowercase | §10.1 |
| Barcode / idempotencyKey / resetTokenHash | blank → **field absent**; never empty-string (PDV-04) | sparse-unique correctness |
| Money | `Decimal128` storage; `"0.00"`-style strings at API and in audit diffs (DBR-05) | BR-08, §12 serialization |
| Dates | UTC storage; ISO-8601 at API; server-authoritative (BR-39) | NFR-33 |
| Session expiry | checked by value; TTL is cleanup only (PDV-03) | BR-35 |

---

## 8. Seed Specification

Idempotent, environment-variable-driven seed (FR-USER-06, BR-28/41) — upsert-by-natural-key only, never destructive on re-run:

1. **First Admin** — `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`, `role: ADMIN`, `mustChangePassword: true`.
2. **Settings singleton** — defaults per §2.7.
3. **Uncategorized category** — `isSystem: true`.

Startup integrity check: a missing settings document (or zero active admins) fails readiness with a explicit remediation message.

---

## 9. Review Findings Incorporated

| ID | Finding | Resolution (in this document) |
|---|---|---|
| DBR-01 | Missing sample documents for 3 collections | Samples added (§2.5–2.8) |
| DBR-02 | Category-filtered product lists under-indexed | `{categoryId, isArchived, createdAt}` compound replaces `{categoryId}` (§2.3, §3) |
| DBR-03 | "Exactly one primary image" inexpressible in validators | Named service-enforced invariant (§5) |
| DBR-04 | Password-reset lookup unindexed (unauthenticated-path scan) | `{resetTokenHash:1}` sparse index (§2.1) |
| DBR-05 | Money representation in audit diffs unspecified | API string form mandated (§2.6, §7) |
| PDV-01 | Open-ended audit action enum | Closed 15-value enum (§2.6) |
| PDV-02 | SKU sequence formatting implied only | `<PREFIX>-<00000>`, widen past 99999 (§2.8, §7) |
| PDV-03 | TTL mistaken for expiry enforcement would open a ~60 s hole | TTL = cleanup only; validity checked by value (§1, §2.5, §7) |
| PDV-04 | Empty-string values would break sparse unique indexes | Blank → absent rule on all sparse fields (§1, §7) |

---

## 10. Coverage, Assumptions & Risks

**Coverage:** all 8 ERD entities realized field-for-field from SRS §10 plus exactly the approved additions — `entityLabel` (DN-4/ERB-01), the D-1 Atlas Search index, and the DBR-04 reset index. Every R1–R9 relationship has its physical mechanism; every business rule has a designated enforcement layer (index, validator, transaction boundary, or named invariant); DN-1…4 each carry their preserving mechanism. No new entities or scope changes.

**Assumptions (carried):** A-1…A-7 (ARC §9) · AS-1…AS-20 (SRS §21) · DES-1 + DBR-03 invariants · D-1 resolved (Atlas Search primary; fallback preserved).

**Risks (carried):**

| ID | Risk | Gate |
|---|---|---|
| R-2 | Hot-product movement contention (A-1 majority writes) | NFR-08 load test; movement-path index count kept minimal |
| R-5 | Audit-trail query plans at volume | NFR-08 plan verification |
| R-6 | Atlas Search availability on target tier | Phase 0 verification (with ARB-01 proxy check) |

**Next phase:** REST API Design — bind each SRS §12 endpoint to its validation schema (§15), error subset (§16.3), index (this §3), and transaction boundary (this §4); fix the global serialization contract; formalize the `Idempotency-Key` header; author the phase as the OpenAPI 3 document (NFR-27).

---

*End of document — DBD-IMS-004 v1.0 · Approved for REST API Design · 2026-07-23*