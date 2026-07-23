# REST API Specification

## Web-Based Inventory Management System

| | |
|---|---|
| **Document ID** | API-IMS-005 |
| **Version** | 1.0 (Approved) |
| **Date** | 2026-07-23 |
| **Status** | **APPROVED FOR BACKEND ARCHITECTURE** |
| **Review record** | Lead API Architect review (APR-01…08) and Principal API Architect validation (PAV-01) — all corrections incorporated below (§8) |
| **Source of truth** | SRS-IMS-001 (`01-SRS.md`) · ARC-IMS-002 (`02-System-Architecture.md`) · ERD-IMS-003 (`03-ERD.md`) · DBD-IMS-004 (`04-Database-Design.md`) — this document conforms to all four and never overrides them |
| **Normative scope** | This document realizes SRS §12 endpoint-for-endpoint. **No endpoint exists that SRS §12 does not define; no SRS §12 endpoint is omitted.** Each endpoint is bound to its §15 validation schema, its §16.3 error subset, its DBD §3 index, and its DBD §4 transaction boundary, per the DBD §10 handoff |
| **Machine-readable form** | `server/openapi.yaml` (NFR-27) is generated from this specification and kept in CI-verified sync; frontend types derive from it |

---

## Table of Contents

1. [Global Conventions](#1-global-conventions)
2. [Serialization Contract](#2-serialization-contract)
3. [Authentication & Authorization Contract](#3-authentication--authorization-contract)
4. [Idempotency Contract](#4-idempotency-contract)
5. [Pagination, Filtering & Sorting Contract](#5-pagination-filtering--sorting-contract)
6. [Error Contract](#6-error-contract)
7. [Endpoint Reference](#7-endpoint-reference)
8. [API Design Decisions (APD-01…06)](#8-api-design-decisions-apd-0106)
9. [Traceability & Coverage](#9-traceability--coverage)

---

## 1. Global Conventions

| Convention | Rule | Driver |
|---|---|---|
| Base URL | `/api/v1` — all routes below are relative to it except `GET /health` and `GET /ready`, which are mounted at the server root ahead of all limiters and auth (ARB-04) | SRS §12.1, NFR-14 |
| Versioning | Additive evolution only within v1; breaking changes require `/api/v2` with a documented deprecation window. Clients MUST tolerate unknown response fields | SRS §12.1 |
| Content type | `application/json; charset=utf-8` both directions, except CSV export (`text/csv`) and the health endpoints. JSON request bodies limited to 1 MB | SEC-06 |
| Compression | gzip/brotli on all responses | NFR-07 |
| Correlation ID | Every response carries the request's correlation ID (`X-Correlation-Id` header, echoed in error envelopes). Frontend surfaces it in error toasts | NFR-23, §16.1 |
| Middleware order | health → helmet → cors → compression → rate limiters → json(1 MB) → mongo-sanitize → correlationId → auth (JWT + per-request user load) → authorize(role) → validate(schema) → controller | ARC §1.3, ARB-04 |
| Validation | Every endpoint validates its request against its §15 schema **before** the controller runs; failure → `400 VALIDATION_ERROR`, never a partial write | SRS §12.4 |
| Rate limits | Global 300 req / 15 min / IP; auth limiter 10 login attempts / 15 min / IP → `429 RATE_LIMITED`. Per-IP attribution requires strict trust-proxy config (ARB-01) | SEC-04 |
| List cap | `limit ≤ 100` hard cap on every list endpoint; no endpoint returns an unbounded array | NFR-10, FR-SRCH-01 |

---

## 2. Serialization Contract

The single global contract fixed by DBD §7 — every endpoint obeys it; no per-endpoint deviation exists.

| Type | Wire form | Rule |
|---|---|---|
| Object IDs | `"id": "665f2b…"` (string) | `_id` is internal; responses always expose `id`. Request references (`productId`, `categoryId`, `reassignTo`) are 24-hex-char strings |
| Money (`Decimal128`) | String, 2 dp: `"5.99"`, `"0.00"` | Applies to `costPrice`, `sellingPrice`, `inventoryValue`, and audit diffs (DBR-05). Requests submit money as strings; numeric literals → `VALIDATION_ERROR` |
| Dates | ISO-8601 UTC with ms: `"2026-07-23T14:03:11.000Z"` | Stored UTC, displayed local (NFR-33). Timestamps/actors are server-authoritative; client-supplied values for them are **ignored** (BR-39) |
| Enums | Exact uppercase tokens (`STOCK_IN`, `ADMIN`, `DAMAGED`…) | Unknown values → `VALIDATION_ERROR` (§15.9) |
| Optional sparse fields | Absent — never `null`, never `""` | Blank input on `barcode` is normalized to *absent* (PDV-04). Responses omit unset optional fields |
| `stockStatus` (derived, response-only) | `IN_STOCK` \| `LOW_STOCK` \| `OUT_OF_STOCK` | `quantity = 0` → OUT_OF_STOCK; `0 < quantity ≤ lowStockThreshold` → LOW_STOCK; else IN_STOCK (SRS §1.5) |
| `passwordHash`, token hashes | **Never serialized** | `select: false` at the model; excluded from audit diffs (DBD §2.6) |
| SKU / email normalization | SKU: trim → uppercase; email: trim → lowercase — applied at the validation boundary before any comparison | BR-02, DBD §7 |
| List projections | List endpoints return projection fields only (e.g., `thumbnailUrl`, `categoryName`) — never full documents or image arrays | NFR-05 |

---

## 3. Authentication & Authorization Contract

1. **Access token** — `Authorization: Bearer <accessToken>`; JWT HS256, 15-min TTL, payload `sub, role, iat, exp` only (SEC-01). Required on every endpoint not marked **Public**.
2. **Refresh token** — rotating, 7-day TTL, delivered exclusively as an `httpOnly; Secure; SameSite=Strict` cookie **scoped to `/api/v1/auth`**. It never appears in a body or header.
3. **Per-request authorization** (FR-AUTH-07): after JWT verification, the middleware loads the live user record (indexed `_id` point-read, NFR-04). Deactivated → `401 ACCOUNT_DEACTIVATED`; role insufficient per the §5 matrix → `403 FORBIDDEN`. Token claims are informational only.
4. **Role column** in §7 uses: **Public** (no token) · **Any** (Admin or Staff) · **Admin**. These derive verbatim from the SRS §5 permission matrix.
5. Repeated `403`s are recorded as security events (FR-TXN-05).

---

## 4. Idempotency Contract

Formalization of the `Idempotency-Key` header (BR-20, ARB-02) — applies to **exactly one endpoint**: `POST /inventory/movements`.

| Aspect | Rule |
|---|---|
| Header | `Idempotency-Key: <RFC 4122 UUID>` — **required**; missing or malformed → `400 VALIDATION_ERROR` (§15.4 "UUID format" — any version, APR-07) |
| Scope | The key is stored on the resulting Transaction (sparse-unique index — the authoritative dedup, DBD §2.4) |
| Replay, identical payload | Returns the **original outcome** (same status, same body), reconstructed from the stored Transaction (A-4). Committed work never re-executes |
| Same key, different payload | `422 IDEMPOTENCY_CONFLICT` |
| Concurrent same-key race | Both may miss the fast-path lookup; the duplicate-key error on insert aborts the transaction, the stored Transaction is re-read, and the original outcome is returned as a replay — never surfaced as an error (ARB-02) |
| Key generation | Client generates one key per submission attempt-group (`useIdempotencyKey` hook); a network-timeout retry reuses the **same** key (NFR-19) |
| System-originated Transactions | `INITIAL` and compensations carry **no** key (PDV-04) |
| Key namespace | The sparse-unique index is **global**, not per-user; a cross-user key collision maps to `IDEMPOTENCY_CONFLICT`. Accepted (PAV-01): RFC 4122 collision probability is negligible |

---

## 5. Pagination, Filtering & Sorting Contract

- **Request:** `?page=1&limit=20` — integers ≥ 1; default `limit=20`, hard max `limit=100` (values above cap → `VALIDATION_ERROR`).
- **Response envelope** (every list endpoint, FR-SRCH-03):

```json
{ "data": [ … ], "page": 1, "limit": 20, "totalItems": 137, "totalPages": 7 }
```

- **Sorting:** `?sort=<field>&order=asc|desc` (APD-01). Sortable fields are enumerated per endpoint in §7; default `sort=createdAt&order=desc`. Unknown sort field → `VALIDATION_ERROR`.
- **Filtering:** all filtering is server-side (NFR-05); filter parameters are enumerated per endpoint; unknown enum values → `VALIDATION_ERROR` (§15.9).
- **Date-range filters:** `from`/`to` are ISO-8601; `from ≤ to` (§15.9). Transaction History report: both **required**, span ≤ 366 days.

---

## 6. Error Contract

### 6.1 Envelope (SRS §16.2)

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

`details` is optional and code-specific; `VALIDATION_ERROR` uses `[{ "field", "message" }]`.

### 6.2 Code catalog

The full catalog is SRS §16.3, reproduced here — plus three documented API-phase extensions (†, APR-01) — as the closed set this API may emit:

| Code | HTTP | Emitted by |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Every endpoint (schema layer) |
| `UNAUTHORIZED` | 401 | Auth middleware; `/auth/login`; `/auth/refresh` |
| `ACCOUNT_DEACTIVATED` | 401 | Auth middleware; `/auth/login` |
| `FORBIDDEN` | 403 | Authorize middleware (role gate) |
| `NOT_FOUND` | 404 | Any `/:id` route; `/products/lookup` unknown code |
| `DUPLICATE_SKU` | 409 | `POST /products` |
| `DUPLICATE_BARCODE` | 409 | `POST /products`, `PATCH /products/:id` (conflicting product in `details`) |
| `DUPLICATE_EMAIL` † | 409 | `POST /users` (SRS §12.2 mandates 409; unique-index-backed, race-safe) |
| `INSUFFICIENT_STOCK` | 409 | `POST /inventory/movements` (available qty in `details`) |
| `STALE_WRITE` | 409 | `PATCH /products/:id` |
| `LAST_ADMIN` | 409 | `PATCH /users/:id` |
| `PRODUCT_ARCHIVED` | 409 | `POST /inventory/movements`; `POST /products/:id/archive` conflicts |
| `PRODUCT_NOT_EMPTY` † | 409 | `POST /products/:id/archive` when `quantity ≠ 0` (BR-22) |
| `PRODUCT_HAS_HISTORY` † | 409 | `DELETE /products/:id` when Transactions exist (BR-23) |
| `CATEGORY_IN_USE` | 409 | `DELETE /categories/:id` |
| `INVALID_BARCODE` | 422 | `GET /products/lookup` |
| `IDEMPOTENCY_CONFLICT` | 422 | `POST /inventory/movements` |
| `ACCOUNT_LOCKED` | 423 | `POST /auth/login` |
| `RATE_LIMITED` | 429 | Rate limiters (any route) |
| `INTERNAL_ERROR` | 500 | Terminal error middleware (opaque; correlation ID only, SEC-12) |
| `SERVICE_UNAVAILABLE` | 503 | DB down / not ready; carries `Retry-After` (NFR-20) |

**† Catalog extensions (APR-01):** SRS §16.3 provides no code for three conflict outcomes its own rules mandate (duplicate email — §12.2 explicitly requires 409; archive with stock — BR-22; hard delete with history — BR-23). A code-less 409 would violate the §6.1 envelope. Extended by the same documented-extension instrument as ERB-01/PDV-01; the SRS is unchanged. **Reported SRS-internal inconsistency:** §12.2 (409) vs UC-04 E1 ("validation error") for duplicate email — resolved in favor of the explicit status, which is also the only race-safe mapping for a unique-index violation.

Every endpoint's **Errors** row in §7 lists its domain-specific subset; `VALIDATION_ERROR`, `UNAUTHORIZED`/`ACCOUNT_DEACTIVATED` (authenticated routes), `FORBIDDEN` (role-gated routes), `RATE_LIMITED`, `INTERNAL_ERROR`, and `SERVICE_UNAVAILABLE` apply universally and are not repeated.

---

## 7. Endpoint Reference

Legend per endpoint: **Role** (§3.4) · **Traces** (SRS requirement served) · **DB binding** (DBD §3 index / §4 transaction boundary) · **Errors** (domain subset of §6.2).

### 7.1 Auth — `/auth`

#### POST `/auth/login` — Public

Authenticate; set refresh cookie; return access token + profile. Failure counter and lockout per BR-33; success resets the counter, stamps `lastLoginAt`, records a security event.

| | |
|---|---|
| Traces | FR-AUTH-01/04, UC-01 |
| Request | `{ "email", "password" }` (§15.1 — errors stay generic; policy never revealed) |
| 200 | `{ "accessToken", "user": { "id", "name", "email", "role", "mustChangePassword" } }` + `Set-Cookie` refresh (path `/api/v1/auth`) |
| Errors | `UNAUTHORIZED` (bad credentials — generic), `ACCOUNT_LOCKED` (423), `ACCOUNT_DEACTIVATED` |
| DB binding | `users {email}` unique IXSCAN point · security event insert → `auditLogs` |

#### POST `/auth/refresh` — Public (cookie)

Rotate the refresh token; issue a new access token. Reuse of a rotated token revokes the entire session family and records a security event (BR-35, FR-AUTH-06). Clients single-flight this call (ARB-03).

| | |
|---|---|
| Traces | FR-AUTH-02/06 |
| Request | No body; refresh cookie only |
| 200 | `{ "accessToken", "user": { … } }` + rotated `Set-Cookie` |
| Errors | `UNAUTHORIZED` (missing/expired/revoked/reused token) |
| DB binding | `refreshTokens {tokenHash}` unique point · `{familyId}` on family revocation |

#### POST `/auth/logout` — Any

Revoke the current refresh token; clear the cookie (FR-AUTH-03).

| | |
|---|---|
| 204 | No body; expired `Set-Cookie` |
| DB binding | `refreshTokens {tokenHash}` point update (`revokedAt`) |

#### POST `/auth/reset-password` — Public (token)

Complete an Admin-initiated reset (UC-03). Token is single-use, 30-min expiry, hashed at rest; success revokes all prior sessions and clears `mustChangePassword` flow into first login.

| | |
|---|---|
| Traces | FR-AUTH-05, §15.7 |
| Request | `{ "token", "newPassword" }` — policy BR-32 |
| 204 | — |
| Errors | `UNAUTHORIZED` (invalid/expired/used token), `VALIDATION_ERROR` (policy) |
| DB binding | `users {resetTokenHash}` sparse IXSCAN point (DBR-04) · `refreshTokens {userId}` revoke-all |

#### POST `/auth/change-password` — Any

Change own password; current password required and verified; revokes **other** sessions (§15.7, FR-USER-05).

| | |
|---|---|
| Request | `{ "currentPassword", "newPassword" }` — new ≠ current, policy BR-32 |
| 204 | — |
| Errors | `UNAUTHORIZED` (wrong current password) |
| DB binding | `users {_id}` point · `refreshTokens {userId}` selective revoke · security event |

### 7.2 Users — `/users`

#### GET `/users` — Admin

| | |
|---|---|
| Traces | FR-USER-02, §9.12 |
| Query | `page`, `limit`, `role=ADMIN\|STAFF`, `isActive=true\|false`, `search` (name/email); sortable: `name`, `email`, `createdAt`, `lastLoginAt` |
| 200 | List envelope of `{ "id", "name", "email", "role", "isActive", "lastLoginAt", "createdAt" }` |

#### POST `/users` — Admin

Create a user with a temporary password (`mustChangePassword: true`). Self-registration does not exist (BR-31).

| | |
|---|---|
| Traces | FR-USER-01, §15.6 |
| Request | `{ "name", "email", "role", "temporaryPassword" }` |
| 201 | User (no credential fields) |
| Errors | `DUPLICATE_EMAIL` (409 — SRS §12.2; unique-index-backed, race-safe) |
| DB binding | `users {email}` unique index guard · audit entry |

#### GET `/users/me` — Any · PATCH `/users/me` — Any

Own profile (§9.14). PATCH accepts `{ "name" }` only — role/status/email changes are not possible on this route.

| | |
|---|---|
| 200 | `{ "id", "name", "email", "role", "mustChangePassword", "lastLoginAt" }` |
| DB binding | `users {_id}` point · audit entry on change |

#### GET `/users/:id` — Admin

| 200 | Single user (no credential fields) · Errors: `NOT_FOUND` |
|---|---|

#### PATCH `/users/:id` — Admin

Update `name` / `role` / `isActive`. Last-admin guard is atomic (BR-30); deactivation or demotion revokes all target-user sessions immediately (FR-USER-04). Self-demotion/deactivation permitted only when not the last active Admin.

| | |
|---|---|
| Traces | FR-USER-02/03/04, §15.6 |
| Request | Any of `{ "name", "role", "isActive" }` |
| 200 | Updated user |
| Errors | `NOT_FOUND`, `LAST_ADMIN` (409) |
| DB binding | **Boundary T6**: count active admins (`users {role, isActive}` covered count) + apply change + revoke sessions (`refreshTokens {userId}`) + audit entry — one transaction |

#### POST `/users/:id/reset-password` — Admin

Issue a single-use reset token; revokes the target's sessions; returns the reset link for out-of-band delivery (AS-6).

| | |
|---|---|
| Traces | FR-AUTH-05, UC-03 |
| 200 | `{ "resetLink", "expiresAt" }` |
| Errors | `NOT_FOUND` |
| DB binding | `users {_id}` point · `refreshTokens {userId}` revoke-all · audit + security events |

### 7.3 Products — `/products`

#### GET `/products` — Any

| | |
|---|---|
| Traces | FR-PROD-07, FR-SRCH-02/04, §9.4 |
| Query | `page`, `limit`, `search` (name/SKU/barcode, case-insensitive partial), `categoryId`, `stockStatus=in\|low\|out`, `archived=true\|false` (**Admin-only filter** — Staff supplying it → `403 FORBIDDEN`, APD-02; omitted → active products only), sortable: `name`, `sku`, `quantity`, `createdAt`, `costPrice` |
| 200 | List envelope of projections: `{ "id", "name", "sku", "barcode?", "thumbnailUrl?", "categoryName", "quantity", "lowStockThreshold", "stockStatus", "costPrice", "sellingPrice", "isArchived" }` |
| DB binding | `search` → Atlas Search edge-gram index (D-1) · `categoryId` → `{categoryId, isArchived, createdAt}` · `stockStatus` → `{isArchived, quantity}` · default sort → `{isArchived, createdAt}` — no COLLSCAN (SCA-02) |

#### POST `/products` — Admin

Create a product (FR-PROD-01). Blank/omitted SKU → auto-generated `<PREFIX>-<00000>` (BR-04, PDV-02). Non-zero `initialQuantity` atomically creates an `INITIAL` Transaction (BR-17). `lowStockThreshold` defaults from Settings (DN-3).

| | |
|---|---|
| Traces | FR-PROD-01/02, UC-05, §15.2 |
| Request | `{ "name", "sku?", "barcode?", "categoryId", "description?", "costPrice", "sellingPrice", "initialQuantity", "lowStockThreshold?", "supplier?", "images?" }` (money as strings; images `[{publicId, url, isPrimary}]` ≤ 5, exactly one primary when non-empty) |
| 201 | Full product (`id`, `quantity`, `version: 0`, `createdAt`…) |
| Errors | `DUPLICATE_SKU`, `DUPLICATE_BARCODE` (conflicting product in `details`) |
| DB binding | **Boundary T2**: insert product + insert `INITIAL` Transaction · `{sku}` / `{barcode}` unique index guards · `counters` atomic `$inc` on auto-SKU · audit entry |

#### GET `/products/lookup?code=` — Any

Scanner resolution: exact `barcode` match, then exact SKU match (BR-06). Archived products are reported **as archived**, never as not found (BR-07, FR-SCAN-05). Payload is untrusted: printable, ≤ 64 chars (BR-16).

| | |
|---|---|
| Traces | FR-SCAN-02/04/05, UC-10 |
| 200 | `{ "id", "name", "sku", "barcode?", "primaryImageUrl?", "quantity", "stockStatus", "isArchived" }` |
| Errors | `INVALID_BARCODE` (422, malformed payload), `NOT_FOUND` (unknown code — client maps to the role-dependent outcome per FR-SCAN-04) |
| DB binding | `{barcode}` unique sparse point → `{sku}` unique point (the scanner hot path — collation-free by SKU normalization, DBD §1) |

#### GET `/products/:id` — Any

| 200 | Full product incl. `supplier?`, `images`, `version`, `isArchived`, `stockStatus` · Errors: `NOT_FOUND` |
|---|---|

#### PATCH `/products/:id` — Admin

Update non-SKU catalog fields under optimistic concurrency: request MUST carry `version`; mismatch → `409 STALE_WRITE` (BR-24). Quantity is **not** an accepted field on any code path (BR-17 — adjustments only). Changes audited with before/after values. **Side effect (APR-05):** replacing or removing an image destroys the prior Cloudinary asset (BR-38).

| | |
|---|---|
| Traces | FR-PROD-03, UC-06, §15.2 |
| Request | `{ "version", …any of: "name", "barcode", "categoryId", "description", "costPrice", "sellingPrice", "lowStockThreshold", "supplier", "images" }` |
| 200 | Updated product (`version` incremented) |
| Errors | `NOT_FOUND`, `STALE_WRITE`, `DUPLICATE_BARCODE` |
| DB binding | `{_id}` conditional update on `version` · `{barcode}` unique sparse guard · audit entry |

#### POST `/products/:id/archive` — Admin

Atomic archive with `quantity == 0` predicate inside the write (BR-22); a concurrent movement aborts one of the two operations. SKU/barcode remain reserved.

| | |
|---|---|
| Traces | FR-PROD-04, UC-07 |
| 200 | Archived product |
| Errors | `NOT_FOUND`, `PRODUCT_ARCHIVED` (already archived), `PRODUCT_NOT_EMPTY` (409, quantity ≠ 0 — "perform a final Adjustment first", BR-22) |
| DB binding | **Boundary T3**: conditional update (`quantity == 0`) + audit entry |

#### POST `/products/:id/restore` — Admin

| 200 | Restored product (lossless, FR-PROD-04) · Errors: `NOT_FOUND` · DB binding: `{_id}` point update + audit entry |
|---|---|

#### DELETE `/products/:id` — Admin

Hard delete: permitted only with **zero** Transactions, checked atomically with the delete (BR-23). Cloudinary assets destroyed after commit; sweep backstops (BR-38).

| | |
|---|---|
| Traces | FR-PROD-05, UC-07 |
| 204 | — |
| Errors | `NOT_FOUND`, `PRODUCT_HAS_HISTORY` (409 — Transactions exist; archive instead) |
| DB binding | **Boundary T4**: assert zero `transactions {productId, createdAt}` + delete + audit entry; Cloudinary destroy post-commit |

### 7.4 Categories — `/categories`

#### GET `/categories` — Any

| | |
|---|---|
| Query | `page`, `limit`, `withCounts=true` (adds per-category product count, §9.9); sortable: `name`, `createdAt` |
| 200 | List envelope (§5) of `{ "id", "name", "description?", "isSystem", "productCount?" }` — paginated per FR-SRCH-01's absolute rule (APR-02) |

#### POST `/categories` — Admin · PATCH `/categories/:id` — Admin

Name unique case-insensitive via collation index; CategoryService applies the collation on every name query (DBD §2.2).

| | |
|---|---|
| Request | `{ "name", "description?" }` (§15.3) |
| 201 / 200 | Category |
| Errors | `VALIDATION_ERROR` (duplicate name), `NOT_FOUND` (PATCH) |
| DB binding | `{name}` unique + collation `{locale: en, strength: 2}`; a concurrent-create race that bypasses the pre-check hits the unique index and maps to the same `VALIDATION_ERROR` (APR-08 — no SRS 409 mandate exists here, unlike SKU/email) |

#### DELETE `/categories/:id` — Admin

Blocked while any product — active **or archived** — references it; `?reassignTo=<categoryId>` performs atomic bulk reassignment first (default target: Uncategorized). System category undeletable (BR-28).

| | |
|---|---|
| Traces | FR-CAT-02, BR-27/28, §15.3 |
| 204 | — |
| Errors | `NOT_FOUND`, `CATEGORY_IN_USE` (409), `VALIDATION_ERROR` (`reassignTo` missing/identical/nonexistent; system category) |
| DB binding | **Boundary T5**: assert/reassign references (`products {categoryId, isArchived, createdAt}` prefix) + delete + audit entry |

### 7.5 Inventory — `/inventory`

#### POST `/inventory/movements` — Any (STOCK_IN / STOCK_OUT) · Admin (ADJUSTMENT)

The load-bearing endpoint (ARC §3.2). Executes a Stock Movement as **Boundary T1**: conditional `findOneAndUpdate` (`isArchived: false`; `quantity ≥ requested` for negatives) + Transaction insert, one MongoDB transaction, `w: "majority"` (A-1), bounded transient-conflict retry. `Idempotency-Key` header required (§4). A Staff-submitted `ADJUSTMENT` → `403 FORBIDDEN`.

**Request — Stock In/Out** (§15.4):

```json
{ "productId": "665f2b…", "type": "STOCK_OUT", "quantity": 25, "note": "Order #1042" }
```

**Request — Adjustment** (§15.5, Admin): `delta` XOR `countedQuantity`:

```json
{ "productId": "…", "type": "ADJUSTMENT", "delta": -3, "reason": "DAMAGED", "note": "Crushed box" }
{ "productId": "…", "type": "ADJUSTMENT", "countedQuantity": 122, "reason": "COUNT_CORRECTION" }
```

| Field | Rules |
|---|---|
| `type` | `STOCK_IN` \| `STOCK_OUT` \| `ADJUSTMENT` (`INITIAL` is system-only — never accepted here) |
| `quantity` | In/Out: integer 1–100,000 (BR-12) |
| `delta` | Adjustment: signed integer ≠ 0, \|delta\| ≤ 100,000 |
| `countedQuantity` | Adjustment: integer 0–10,000,000; system computes the delta (cannot go negative by construction, BR-13) |
| `reason` | Required iff `ADJUSTMENT`: `DAMAGED, LOST, FOUND, COUNT_CORRECTION, RETURN, OTHER` |
| `note` | ≤ 500 chars; **required** when `reason = OTHER` |
| `refTransactionId?` | Optional on compensating Adjustments (BR-17, R7) |

**200:**

```json
{
  "transaction": { "id", "productId", "type", "quantityChange", "quantityAfter",
                   "userId", "reason?", "note?", "createdAt" },
  "product": { "id", "quantity", "lowStockThreshold", "stockStatus" }
}
```

| | |
|---|---|
| Traces | FR-INV-01…07, UC-08/09, BR-11/12/13/15/17/19/20 |
| Errors | `INSUFFICIENT_STOCK` (409, `details: {available, requested}`), `PRODUCT_ARCHIVED` (409), `IDEMPOTENCY_CONFLICT` (422), `NOT_FOUND` |
| DB binding | **Boundary T1** · replay fast path + backstop: `transactions {idempotencyKey}` unique sparse · conditional update on `products {_id}` |

*(The large-movement warning threshold (BR-15) is a UI confirmation; the API accepts any valid quantity ≤ 100,000 — the server does not reject above-threshold movements.)*

### 7.6 Transactions & Audit

#### GET `/transactions` — Any

Paginated append-only ledger (FR-TXN-03). No update/delete route exists for this collection (FR-TXN-02, DES-1).

| | |
|---|---|
| Query | `page`, `limit`, `from`, `to`, `type`, `productId`, `userId`, `includeArchived=true\|false` (default false); sort fixed `createdAt desc` |
| 200 | List envelope of `{ "id", "productId", "productName", "productSku", "productIsArchived", "type", "quantityChange", "quantityAfter", "userId", "userName", "reason?", "note?", "refTransactionId?", "createdAt" }` |
| DB binding | `{createdAt}` range · `{productId, createdAt}` · `{type, createdAt}` · `{userId, createdAt}` — filter-matched IXSCAN |

#### GET `/transactions/:id` — Any

| 200 | Single Transaction · Errors: `NOT_FOUND` |
|---|---|

#### GET `/audit-logs` — Admin

Paginated audit trail: entity diffs + security events (FR-TXN-04/05). `entityLabel` (DN-4) renders entries after hard deletes. Append-only; no mutation route exists.

| | |
|---|---|
| Query | `page`, `limit`, `entityType`, `entityId`, `actorId`, `from`, `to` |
| 200 | List envelope of `{ "id", "actorId", "actorName", "entityType", "entityId?", "entityLabel", "action", "changes?": [{ "field", "before", "after" }], "ip?", "createdAt" }` |
| DB binding | `{entityType, createdAt}` · `{actorId, createdAt}` · `{entityId, createdAt}` (R-5 compounds) |

### 7.7 Dashboard — `/dashboard`

#### GET `/dashboard/summary?range=7|30|90` — Any

All metrics + chart series in **one** cached call (NFR-11); per-instance cache 30–60 s (A-2); staleness surfaced via `asOf` (BR-25). Archived products excluded from totals.

| | |
|---|---|
| Traces | FR-DASH-01…04, UC-11 |
| 200 | `{ "asOf", "totals": { "activeProducts", "inventoryValue", "unitsInStock" }, "lowStock": { "count", "items" }, "outOfStock": { "count", "items" }, "recentTransactions": [ … 10 ], "charts": { "movementTrend": [{ "date", "in", "out" }], "transactionVolume": [{ "date", "count" }] } }` — `inventoryValue` as money string |
| Errors | `VALIDATION_ERROR` (range ∉ {7, 30, 90}) |
| DB binding | Aggregation pipeline: `products {isArchived, quantity}` + `transactions {createdAt}` / `{type, createdAt}`; active-product value scan is the deliberate accepted cost behind the cache (DBD §3) |

### 7.8 Reports — `/reports`

All reports render paginated on-screen tables for both roles; historical reports derive exclusively from the ledger (BR-40) and state timezone + current-cost valuation (FR-RPT-06).

| Method / Route | Role | Query | Traces / DB binding |
|---|---|---|---|
| GET `/reports/inventory` | Any | `page`, `limit`, `categoryId`, `stockStatus` | FR-RPT-01 · `products` compounds; totals row included |
| GET `/reports/low-stock` | Any | `page`, `limit` | FR-RPT-02 · `{isArchived, quantity}`; returns threshold, quantity, shortage |
| GET `/reports/transactions` | Any | `from`, `to` (**both required**, span ≤ 366 d), `type`, `productId`, `userId`, `page`, `limit` | FR-RPT-03, BR-40 · `transactions {createdAt}` range |
| GET `/reports/product-performance` | Any | `from`, `to`, `page`, `limit` | FR-RPT-04 · in/out/net totals per product from the ledger |
| GET `/reports/consistency` | **Admin** | `page`, `limit` | FR-RPT-05, BR-18 · reconciliation results: per-product ledger sum vs `quantity`, drift flagged (snapshot-consistent, ARB-05) |
| GET `/reports/:name/export` | **Admin** | Same filters as the named report; `page`/`limit` **ignored** (APR-06) | FR-RPT-06 · `name ∈ {inventory, low-stock, transactions, product-performance, consistency}` (APD-04); streams `text/csv` of the **full filtered dataset** — the stream-CSV branch of FR-SRCH-01 exists precisely to bypass pagination; Staff → `403` enforced at API |

Errors (all): `VALIDATION_ERROR` (missing/oversized range, unknown `name`); export additionally `FORBIDDEN`.

### 7.9 Uploads — `/upload`

#### POST `/upload/signature` — Admin

Backend-signed Cloudinary upload parameters (SEC-08); the browser uploads directly — image bytes never transit the API. Constraints signed in: JPEG/PNG/WebP, ≤ 5 MB (BR-36).

| | |
|---|---|
| 200 | `{ "signature", "timestamp", "apiKey", "cloudName", "folder" }` |

#### DELETE `/upload/:publicId` — Admin

Destroy an asset (failed-save cleanup, image replace/remove — BR-38; nightly sweep backstops). **Encoding (APR-03):** `publicId` contains `/` (e.g., `ims/prod/abc123`) and MUST be percent-encoded in the path; the server decodes it. **Scope control (APR-03):** a decoded value outside the app's signed upload folder prefix → `403 FORBIDDEN` — this endpoint can never destroy assets beyond the app's own uploads (SEC-08 posture).

| | |
|---|---|
| 204 | — · Errors: `NOT_FOUND`, `FORBIDDEN` (outside upload folder) |

### 7.10 Settings — `/settings`

#### GET `/settings` — Admin · PUT `/settings` — Admin

The seeded singleton (BR-41); changes audited (FR-TXN-04). Defaults are copied at product creation (DN-3) — updates never rewrite existing products.

| | |
|---|---|
| Request (PUT) | `{ "currency", "defaultLowStockThreshold", "movementWarningThreshold" }` (§15.8: ISO 4217; int ≥ 0; int ≥ 1) |
| 200 | Settings document |
| DB binding | Singleton `_id` point · audit entry with before/after |

### 7.11 Health — server root, Public

| Method / Route | Purpose |
|---|---|
| GET `/health` | Liveness — process up; no auth, no rate limit, no business data (NFR-14, ARB-04) |
| GET `/ready` | Readiness — includes DB connectivity; deploy gates and LB checks target this (NFR-15); failure → `503` |

---

## 8. API Design Decisions (APD-01…06)

Formalizations within the latitude the SRS leaves; none alters scope or contradicts a source document.

| ID | Decision | Rationale |
|---|---|---|
| APD-01 | Sort direction via `order=asc\|desc` companion to `sort` | FR-SRCH-03 enumerates sortable fields and a default direction but no direction mechanism; a separate parameter keeps enum validation of `sort` trivial |
| APD-02 | Staff supplying the `archived` filter on `GET /products` receives `403 FORBIDDEN` (not silent ignoring) | SRS marks the filter Admin-only; silent ignoring would misrepresent the result set; explicit 403 matches §5.3 enforcement posture and feeds the repeated-403 security signal |
| APD-03 *(superseded by APR-01)* | Originally: archive with `quantity ≠ 0` returns a code-less `409`. Review found this violates the §6.1 envelope (`code` is mandatory); replaced by the `PRODUCT_NOT_EMPTY` catalog extension | BR-22 defines the conflict; the envelope contract wins |
| APD-04 | Export route parameter `name` is a closed enum matching the five report routes | Prevents an open-ended `:name` surface; unknown → `VALIDATION_ERROR` |
| APD-05 | `204 No Content` for logout, password mutations, hard delete, category delete, asset destroy | These return nothing meaningful; 204 makes "no body" contractual rather than incidental |
| APD-06 | Movement success is `200` (not `201`) | SRS §12.3 fixes 200; semantically the response is a composite outcome (transaction + product), and replays return the identical status/body (§4) |

### Review corrections incorporated (APR-01…08 · PAV-01)

| ID | Finding | Resolution (in this document) |
|---|---|---|
| APR-01 | Three source-mandated conflicts had no emittable code (duplicate email — SRS §12.2 requires 409; BR-22 archive; BR-23 hard delete); code-less 409s violated the §6.1 envelope | `DUPLICATE_EMAIL`, `PRODUCT_NOT_EMPTY`, `PRODUCT_HAS_HISTORY` added as documented catalog extensions (§6.2 †); APD-03 superseded; SRS §12.2-vs-UC-04 tension reported, not silently fixed |
| APR-02 | `GET /categories` returned an unbounded array — FR-SRCH-01/NFR-10 violation | Standard §5 pagination applied (§7.4) |
| APR-03 | `publicId` path segment unroutable (contains `/`); no asset-scope control | Percent-encoding rule + folder-prefix check → `403` (§7.9) |
| APR-04 | Verification statement miscounted the surface (40) | Corrected to 41 (§9.3) |
| APR-05 | BR-38 asset-destroy side effect absent from `PATCH /products/:id` | Side effect stated (§7.3) |
| APR-06 | Export vs pagination ambiguous | `page`/`limit` ignored on export; full filtered dataset streams (§7.8) |
| APR-07 | Idempotency key over-constrained to UUID v4 vs §15.4 "UUID format" | Any RFC 4122 UUID (§4) |
| APR-08 | Category duplicate-name unique-index race path undocumented | Race mapping stated (§7.4) |
| PAV-01 | Global (not per-user) idempotency-key namespace was implicit | Accepted and documented (§4): RFC 4122 collision probability negligible |

---

## 9. Traceability & Coverage

### 9.1 Feature → endpoint coverage

| SRS module | Endpoints |
|---|---|
| AUTH (§3.1) | §7.1 (5 endpoints) |
| USER (§3.2) | §7.2 (7 endpoints) |
| PROD (§3.3) | §7.3 (8 endpoints) — QR labels are client-rendered (FR-PROD-08): deliberately **no** endpoint |
| CAT (§3.4) | §7.4 (4 endpoints) |
| INV (§3.5) | §7.5 (1 endpoint — all three movement types) |
| SCAN (§3.6) | `GET /products/lookup` (§7.3) — decode is client-side ZXing: no scan endpoint exists |
| DASH (§3.7) | §7.7 (1 aggregate endpoint — FR-DASH-03's single-call mandate) |
| TXN (§3.8) | §7.6 (3 endpoints; zero mutation routes — DES-1 verified) |
| SRCH (§3.9) | Realized as the §5 contract on every list endpoint |
| RPT (§3.10) | §7.8 (6 endpoints) |
| SET (§3.11) | §7.10 (2 endpoints) |
| NFR-14/15 | §7.11 (2 endpoints) |

### 9.2 MongoDB design alignment

- Every endpoint's query maps to a named DBD §3 index — the SCA-02 no-COLLSCAN criterion carries into this contract unchanged; the two deliberate accepted costs (dashboard value aggregation behind cache; bounded skip/limit) are inherited as stated.
- Every multi-document write executes inside its DBD §4 boundary (T1–T6) at `w: "majority"` (A-1); no endpoint performs a multi-document write outside a named boundary.
- Serialization (§2) is the DBD §7 normalization table verbatim: money strings (DBR-05), UTC ISO dates (BR-39), sparse-absent fields (PDV-04), SKU/email normalization.
- Append-only enforcement (DES-1): `/transactions` and `/audit-logs` expose **GET only** — confirmed against the full §7 surface.

### 9.3 Verification statement

Checked at authoring and re-verified at technical validation: all **41** routes in SRS §12.2 are specified above (the SRS health row contains two endpoints — APR-04) with role, validation source, error subset, index, and boundary; no route was added; the error catalog is emitted-code-closed (18 SRS codes + 3 documented extensions, APR-01); roles derive verbatim from the §5 matrix. **No inconsistency with SRS-IMS-001, ARC-IMS-002, ERD-IMS-003, or DBD-IMS-004 exists.**

---

*End of document — API-IMS-005 v1.0 · Approved for Implementation · 2026-07-23*
