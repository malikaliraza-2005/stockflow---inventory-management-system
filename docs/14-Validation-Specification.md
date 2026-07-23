# Validation Specification

## Web-Based Inventory Management System

| | |
|---|---|
| **Document ID** | VAL-IMS-014 |
| **Version** | 1.0 (Approved) |
| **Date** | 2026-07-23 |
| **Status** | **APPROVED — READY FOR PRODUCTION** (validation review rating 9/10) |
| **Source of truth** | SRS-IMS-001 (§6, §15, §16) · DBD-IMS-004 (§2, §5, §7) · `05-REST-API-Specification.md` (§6, §7) · AAD-IMS-009 — this document conforms to all and never overrides them |
| **Review record** | Principal Backend/API/Database audit — Issues 1–4 + boundary-vector appendix incorporated (§12) |
| **Role** | **The single source of truth for validation.** Frontend zod schemas, backend zod schemas, and MongoDB JSON-schema validators all derive from this document |

---

## Table of Contents

1. [Strategy — One Vocabulary, Three Layers](#1-strategy--one-vocabulary-three-layers)
2. [Global Primitives & Normalization](#2-global-primitives--normalization)
3. [Entity Field Validation](#3-entity-field-validation)
4. [Entity Lifecycle & Cross-Field Rules](#4-entity-lifecycle--cross-field-rules)
5. [Endpoint Validation Matrix (complete)](#5-endpoint-validation-matrix-complete)
6. [Business-Rule Enforcement Layers](#6-business-rule-enforcement-layers)
7. [Frontend Validation Behavior](#7-frontend-validation-behavior)
8. [Backend Always-Enforced Rules](#8-backend-always-enforced-rules)
9. [Validation Error Format](#9-validation-error-format)
10. [Security Validation](#10-security-validation)
11. [Implementation Guidelines](#11-implementation-guidelines)
12. [Review Findings Incorporated](#12-review-findings-incorporated)
- [Appendix A — Boundary-Value Test Vectors](#appendix-a--boundary-value-test-vectors)

---

## 1. Strategy — One Vocabulary, Three Layers

```text
Layer 1  CLIENT   (zod, mirrors this spec)  → UX feedback; never trusted
Layer 2  API      (zod, per endpoint)       → AUTHORITATIVE (SRS §12.4) — nothing
                                              invalid reaches a controller
Layer 3  DATABASE (JSON-schema validators + → defense-in-depth (BR-10); catches
          unique indexes)                     buggy code paths
```

Shared **primitive modules** (§2) are composed into every schema — parity is structural, not disciplined. The server is always authoritative; the client may be narrower for UX, never wider. Every failure returns the §9 format.

---

## 2. Global Primitives & Normalization

| Primitive | Rule | Normalization | Message |
|---|---|---|---|
| `email` | RFC-shape, ≤ 254 | trim → lowercase | "Enter a valid email address" |
| `password` | **10–64 chars** (review Issue 2 — bcrypt truncates at 72 bytes; 64-char cap keeps any UTF-8 input safely inside it), ≥ 1 letter, ≥ 1 digit, not in common-password deny-list (BR-32) | none — never trimmed | "Password must be 10–64 characters with a letter and a number" |
| `sku` | `^[A-Z0-9-]{3,32}$` after normalization (BR-02) | trim → uppercase | "SKU: 3–32 letters, numbers, hyphens" |
| `barcode` | printable, ≤ 64 (BR-05/16) | trim; **blank → absent** (PDV-04) | "Code can't be read" / "Barcode too long" |
| `money` | decimal string, ≥ 0, ≤ 2 dp, **≤ 9,999,999.99** (defensive bound — review Issue 3, logged assumption VA-1) | trim | "Enter a valid amount" |
| `quantityInt` | integer 0…10,000,000 (BR-10) | — | "Enter a whole number" |
| `movementQty` | integer 1…100,000 (BR-12) | — | "Quantity must be 1–100,000" |
| `objectId` | 24-hex | — | "Invalid reference" |
| `isoDate` | ISO-8601, valid calendar date | — | "Enter a valid date" |
| `uuid` | RFC 4122 (idempotency keys, BR-20) | — | (server-only failure) |
| `noteText` | ≤ 500 | trim | "Note is too long (500 max)" |
| `cloudinaryPublicId` | `^ims/prod/[A-Za-z0-9_/-]+$` (review Issue 4) | — | "Invalid image reference" |
| `cloudinaryUrl` | HTTPS; **host must equal the configured Cloudinary delivery host** (Issue 4) | — | "Invalid image URL" |
| `sparseOptional(x)` | wraps `barcode` / reset-token / idempotency-key class fields | **empty string → field absent** — never `""` into a sparse-unique index (PDV-04) | — |

**Normalization order (global):** trim → case rule → blank-to-absent → boundary type-coercion (dates/numbers from strings at the API layer only) → validation. `$`-prefixed keys stripped before any schema runs (SEC-06). Unknown body fields are **stripped**, never stored.

---

## 3. Entity Field Validation

### 3.1 User (`users` — DBD §2.1)

| Field | Type | Req | Default | Rules | Unique | Message |
|---|---|---|---|---|---|---|
| `name` | string | ✔ | — | 2–80, trim | — | "Name: 2–80 characters" |
| `email` | string | ✔ | — | `email` | **✔** (index) | "Email already in use" |
| `password` (input) | string | ✔ create | — | `password` | — | policy message |
| `role` | enum | ✔ | — | `ADMIN \| STAFF` | — | "Invalid role" |
| `isActive` | boolean | ✔ | `true` | boolean | — | — |
| `mustChangePassword` | boolean | ✔ | `true` on provision/reset | **server-set — rejected if client-supplied** | — | — |
| `failedLoginCount` · `lockedUntil` · `resetTokenHash` · `resetTokenExpiresAt` · `lastLoginAt` | — | server | — | **server-managed — rejected if present in any request body** | reset hash sparse | — |

### 3.2 Category (`categories` — DBD §2.2)

| Field | Type | Req | Default | Rules | Unique | Message |
|---|---|---|---|---|---|---|
| `name` | string | ✔ | — | 2–60, trim | **✔ case-insensitive** (collation index) | "Category name already exists" |
| `description` | string | — | — | ≤ 300, trim | — | "Description too long (300 max)" |
| `isSystem` | boolean | ✔ | `false` | **server-set; never client-writable** (BR-28) | — | — |

### 3.3 Product (`products` — DBD §2.3)

| Field | Type | Req | Default | Rules | Unique | Message |
|---|---|---|---|---|---|---|
| `name` | string | ✔ | — | 2–120, trim | — | "Name: 2–120 characters" |
| `sku` | string | create-optional | auto (BR-04) | `sku`; **immutable — present in an update body → rejected** (BR-03) | **✔** | "SKU already exists" |
| `barcode` | string | — | absent | `sparseOptional(barcode)` | ✔ sparse | "Barcode already assigned to {product}" |
| `description` | string | — | — | ≤ 2,000, trim | — | length message |
| `categoryId` | objectId | ✔ | — | must reference an existing category (in-transaction where racy, BR-27) | — | "Choose a category" |
| `costPrice` / `sellingPrice` | money | ✔ | — | `money` (BR-08) | — | amount message |
| `initialQuantity` (create only) | int | — | 0 | `quantityInt` | — | whole-number message |
| `quantity` | int | server | — | **never client-writable — MovementService only** (BR-17) | — | — |
| `lowStockThreshold` | int | ✔ | settings copy (DN-3) | integer 0…10,000,000 | — | "Threshold must be 0 or more" |
| `supplier.name` | string | req if supplier present | — | ≤ 120, trim | — | length message |
| `supplier.contactName` / `.phone` / `.email` | string | — | — | ≤ 80 / ≤ 30 / `email` | — | per primitive |
| `images[]` | array | — | `[]` | ≤ 5; each `{publicId: cloudinaryPublicId, url: cloudinaryUrl, isPrimary: boolean}`; **exactly one primary when non-empty — service-enforced** (DBR-03) | — | "Up to 5 images" / "Pick one primary image" |
| `isArchived` | boolean | server | `false` | via archive/restore endpoints only | — | — |
| `version` | int | ✔ update | 0 | integer ≥ 0; mismatch → `STALE_WRITE` (BR-24) | — | "Changed by someone else — reload" |

### 3.4 Stock Movement input (writes `transactions` — DBD §2.4; the record itself is server-written)

| Field | Type | Req | Rules | Message |
|---|---|---|---|---|
| `productId` | objectId | ✔ | exists, `isArchived: false` → else `PRODUCT_ARCHIVED` | "Product unavailable" |
| `type` | enum | ✔ | `STOCK_IN \| STOCK_OUT \| ADJUSTMENT` (`INITIAL` is server-only — rejected from clients) | "Invalid movement type" |
| `quantity` (IN/OUT) | int | ✔ for IN/OUT | `movementQty`; OUT additionally `≤ available` at execution (BR-11 → `INSUFFICIENT_STOCK`) | "Only {available} available" |
| `delta` XOR `countedQuantity` (ADJUSTMENT) | int | exactly one | delta: signed ≠ 0, \|delta\| ≤ 100,000 · counted: `quantityInt` (0 allowed — count-to-zero) | "Enter an adjustment amount" |
| `reason` | enum | ✔ iff ADJUSTMENT | `DAMAGED, LOST, FOUND, COUNT_CORRECTION, RETURN, OTHER` (BR-13) | "Choose a reason" |
| `note` | string | ✔ iff `reason=OTHER` | `noteText` | "A note is required for Other" |
| `Idempotency-Key` (header) | uuid | ✔ | `uuid`; same key + different payload → `IDEMPOTENCY_CONFLICT` (BR-20) | server-only |
| `userId` · `createdAt` · `quantityAfter` · `refTransactionId` | — | server | **server-derived; client values ignored** (BR-39) | — |

### 3.5 Settings (`settings` — DBD §2.7)

| Field | Type | Req | Rules | Message |
|---|---|---|---|---|
| `currency` | string | ✔ | valid ISO 4217 code | "Choose a valid currency" |
| `defaultLowStockThreshold` | int | ✔ | 0…10,000,000 | threshold message |
| `movementWarningThreshold` | int | ✔ | 1…100,000 | "Must be at least 1" |

*`refreshTokens`, `auditLogs`, `counters` are entirely server-written — no client-facing validation surface (DES-1; DBD §2.5/2.6/2.8).*

---

## 4. Entity Lifecycle & Cross-Field Rules

| Entity | Create | Update | Archive/Delete | Cross-field |
|---|---|---|---|---|
| User | Admin-only; temp password sets `mustChangePassword` | name/role/isActive only; **last-admin guard atomic** (BR-30 → `LAST_ADMIN`) | Deactivate only — no delete path (BR-29) | role change → session revocation (FR-USER-04) |
| Product | non-zero `initialQuantity` → `INITIAL` Transaction (T2) | SKU immutable; `version` required (BR-24) | Archive: `quantity == 0` atomic predicate (BR-22) · Hard delete: zero Transactions, atomic (BR-23) | supplier valid-if-present; exactly-one-primary image |
| Category | unique name (collation) | same | Delete: zero references (incl. archived) or valid `reassignTo` ≠ self (BR-27); `isSystem` undeletable (BR-28) | — |
| Movement | §3.4; T1 atomicity + idempotency | **none — append-only** (FR-TXN-02) | — | type ↔ quantity-field XOR; reason ↔ note conditional |
| Settings | seeded (BR-41) | full-object PUT, audited | none | — |

**Auth forms:** login — email format + non-empty password; failures stay **generic** (AAD §2). Change-password — current required + verified server-side; new per `password`; **confirmation match is client-UX only** (the server strips unknown `confirm` and validates `newPassword` alone); new ≠ current. Reset — token required/valid/unused/unexpired + new per `password`.

---

## 5. Endpoint Validation Matrix (complete)

**Universal preamble (applies to every row):** all `:id` params are `objectId` (else 400, not 404) · unknown body fields stripped · unknown enum values → 400 · list endpoints enforce `page ≥ 1`, `limit 1–100` (FR-SRCH-01) · authenticated endpoints require Bearer; role per the §5 matrix; the movements route alone orders validate before type-aware authorize (AAD §5.2).

### Auth

| Endpoint | Validation | Expected failures |
|---|---|---|
| `POST /auth/login` | body `{email, password: non-empty}` | 400 · 401 generic · 423 `ACCOUNT_LOCKED` · 401 `ACCOUNT_DEACTIVATED` |
| `POST /auth/refresh` | refresh cookie present | 401 (missing/invalid/rotated → family revocation) |
| `POST /auth/logout` | none (idempotent) | — |
| `POST /auth/reset-password` | `{token: non-empty string, newPassword: password}` | 400 · 401 invalid/expired/used token |
| `POST /auth/change-password` | `{currentPassword: non-empty, newPassword: password, ≠ current}` | 400 · 401 wrong current |

### Users

| Endpoint | Validation | Expected failures |
|---|---|---|
| `GET /users` | query: pagination · `role?` enum · `isActive?` bool · `search? ≤ 120` | 400 |
| `POST /users` | `{name, email, role, password}` per §3.1 | 400 · 409 duplicate email |
| `GET /users/me` | — | — |
| `PATCH /users/me` | `{name}` only | 400 |
| `GET /users/:id` | id | 404 |
| `PATCH /users/:id` | `{name?, role?, isActive?}` — nothing else | 400 · 404 · 409 `LAST_ADMIN` |
| `POST /users/:id/reset-password` | id; target active | 404 · 400 inactive target |

### Products

| Endpoint | Validation | Expected failures |
|---|---|---|
| `GET /products` | query: pagination · `search? ≤ 120` · `categoryId?` · `stockStatus? ∈ {in,low,out}` · `archived?` bool (Admin-only param) · `sort ∈ whitelist {name, sku, quantity, createdAt, costPrice}` | 400 |
| `POST /products` | §3.3 create shape | 400 · 409 `DUPLICATE_SKU` / `DUPLICATE_BARCODE` |
| `GET /products/lookup` | `code`: printable ≤ 64 (BR-16) | 422 `INVALID_BARCODE` · 404 |
| `GET /products/:id` | id | 404 |
| `PATCH /products/:id` | §3.3 update shape (**no `sku`, no `quantity`, no `isArchived`**) + `version` | 400 · 404 · 409 `STALE_WRITE` / `DUPLICATE_BARCODE` |
| `POST /products/:id/archive` | id | 404 · 409 quantity ≠ 0 |
| `POST /products/:id/restore` | id; is archived | 404 · 400 not archived |
| `DELETE /products/:id` | id | 404 · 409 has Transactions |

### Categories

| Endpoint | Validation | Expected failures |
|---|---|---|
| `GET /categories` | `withCounts?` bool | 400 |
| `POST /categories` | `{name, description?}` §3.2 | 400 · 409 duplicate name |
| `PATCH /categories/:id` | same shape; `isSystem` untouchable | 400 · 404 · 409 |
| `DELETE /categories/:id` | id · `reassignTo?: objectId, ≠ id, exists, not the deleted one` | 404 · 400 self-reassign · 409 `CATEGORY_IN_USE` |

### Inventory, Transactions & Audit

| Endpoint | Validation | Expected failures |
|---|---|---|
| `POST /inventory/movements` | §3.4 + `Idempotency-Key` header | 400 · 403 Staff + ADJUSTMENT · 409 `INSUFFICIENT_STOCK` / `PRODUCT_ARCHIVED` · 422 `IDEMPOTENCY_CONFLICT` |
| `GET /transactions` | pagination · `from?/to?: isoDate, from ≤ to` · `type?` enum · `productId?` · `userId?` · `includeArchived?` bool | 400 |
| `GET /transactions/:id` | id | 404 |
| `GET /audit-logs` (Admin) | pagination · `entityType?` enum · `entityId?` · `actorId?` · `from?/to?` ordered | 400 |

### Dashboard, Reports, Upload, Settings, Health

| Endpoint | Validation | Expected failures |
|---|---|---|
| `GET /dashboard/summary` | `range ∈ {7, 30, 90}` | 400 |
| `GET /reports/inventory` | `categoryId?` · `stockStatus?` · pagination | 400 |
| `GET /reports/low-stock` | pagination | — |
| `GET /reports/transactions` | `from`/`to` **required**, `isoDate`, `from ≤ to`, span ≤ 366 d · type/product filters | 400 range violations |
| `GET /reports/product-performance` | `from`/`to` required, same range rules | 400 |
| `GET /reports/consistency` (Admin) | pagination | — |
| `GET /reports/:name/export` (Admin) | `name ∈ report enum` + that report's filters | 400 · 403 Staff |
| `POST /upload/signature` (Admin) | `{contentType ∈ image/jpeg\|png\|webp, size ≤ 5,242,880}` | 400 |
| `DELETE /upload/:publicId` (Admin) | `cloudinaryPublicId` | 400 · 404 |
| `GET /settings` (Admin) / `PUT /settings` (Admin) | PUT: §3.5 full object | 400 |
| `GET /health` / `GET /ready` | none — public, unvalidated, no business data | — |

---

## 6. Business-Rule Enforcement Layers

| Rule | Client | API schema | Service/Tx | DB |
|---|:---:|:---:|:---:|:---:|
| No negative stock (BR-10/11) | shows available | `movementQty` | **conditional update — authoritative** | `min: 0` validator |
| SKU / barcode / email / category-name uniqueness | pre-check UX | format | conflict mapping | **unique indexes — authoritative** |
| SKU immutability (BR-03) | read-only field | update schema omits | reject-if-present | — |
| Quantity never client-set (BR-17) | no field exists | schema omits | single-writer | validator |
| Role restrictions (§5 matrix) | `usePermission` | — | **per-request authorize — authoritative** | — |
| Last admin (BR-30) | warning | — | **atomic count (T6)** | — |
| Referential integrity (BR-27) | — | `objectId` | **in-transaction assert** | — |
| Idempotency payload match (BR-20) | key reuse | uuid format | **hash compare** | unique sparse index |
| Price bounds (BR-08 + VA-1) | input mask | `money` | — | decimal validator |
| Image folder scoping (Issue 4) | — | `cloudinaryPublicId`/`cloudinaryUrl` | signature scoping | — |

---

## 7. Frontend Validation Behavior

- **Real-time:** character counts near limits; SKU/barcode format post-normalization preview; numeric masks on quantity/money.
- **On-blur:** email format · password policy checklist · confirmation match · date-range order.
- **On-submit:** full zod parse; first error focused; all errors via `FormField` (`aria-describedby`, live region).
- **Server-echo:** 400 `details[]` map onto the same fields; 409s render their WIR states (duplicates name the conflicting product; `STALE_WRITE` banner; `INSUFFICIENT_STOCK` shows available). Input is **never discarded** on any failure (EC-28/30).
- Messages are the user-natural strings from this spec; codes never shown; correlation IDs only on unexpected errors.

## 8. Backend Always-Enforced Rules

Schema parse on every endpoint (§12.4) · boundary-only type coercion · `$`-key sanitization (SEC-06) · 1 MB body cap · server-managed-field rejection (§3 "server" rows) · authorization per request (movements-route ordering exception) · every §6 authoritative-layer rule · upload MIME **and magic-byte** verification (BR-36) · blank→absent on sparse fields (PDV-04) · unknown-field stripping.

## 9. Validation Error Format

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Validation failed.",
             "details": [ { "field": "sellingPrice", "message": "Enter a valid amount" } ],
             "correlationId": "c1f4…" } }
```

**400** `VALIDATION_ERROR` with field `details[]` · **409/422/423** single-code domain errors per the §16.3 catalog (`details` optional and code-specific) · localization-ready: clients key off `code` + `field`; this spec's messages are the en-default table in `client/src/lib`.

## 10. Security Validation

Injection: sanitization + schema whitelisting + no raw-object query interpolation (SEC-06). XSS: scan payloads and user text validated, escaped, never executed or navigated (BR-16, SEC-07). Uploads: signed-only, MIME + magic bytes, size/count caps, folder-scoped `publicId`/host-pinned URL (SEC-08, BR-36, Issue 4). Auth: generic login errors + dummy-hash timing defense + pinned JWT algorithm + 10–64 password bounds (AAD §2–3, Issue 2). Authorization: server-side per request; §5 matrix authoritative.

## 11. Implementation Guidelines

- **Shared modules:** `server/src/validation/primitives` (the §2 table — one zod module per primitive) → composed by `validation/schemas/<resource>` per endpoint; mirrored client-side in `client/src/lib/validation`. One primitive changed = both layers change. DB validators are generated from the same table (DBD §5).
- **Naming:** `<resource><Action>Schema` (`productCreateSchema`, `movementSchema`); exported `validationMessages` table.
- **Rule of evolution:** a new rule enters **this spec first**, then primitives, then schemas — never ad-hoc in a controller or component.

## 12. Review Findings Incorporated

| # | Finding (severity) | Resolution |
|---|---|---|
| 1 | Endpoint matrix was representative, not exhaustive (Minor) | §5 now enumerates **every** `05` §7 endpoint incl. trivial rows |
| 2 | `password` had no maximum — bcrypt silently truncates at 72 bytes; unbounded slow-hash input (**Major**) | 10–64 char bounds + rationale note (§2) |
| 3 | Price upper bound introduced silently (Minor — process) | Retained and **logged as defensive assumption VA-1** (overridable) |
| 4 | Image references accepted any HTTPS URL / free-form publicId (Minor — security) | `cloudinaryPublicId` pattern + delivery-host-pinned `cloudinaryUrl` (§2, §3.3) |
| + | Boundary-vector appendix (improvement) | Appendix A |

---

## Appendix A — Boundary-Value Test Vectors

Derived mechanically from §2 — NFR-26 boundary tests become a copy-down exercise.

| Primitive | Invalid low | Valid min | Valid max | Invalid high | Normalization pairs |
|---|---|---|---|---|---|
| `password` | 9 chars / no digit / no letter / deny-list entry | 10 chars w/ letter+digit | 64 chars | 65 chars | — (never trimmed) |
| `sku` | `AB` (2) · `ab#1` | `ABC` | 32 chars | 33 chars | `" abc-1 "` → `ABC-1` |
| `barcode` | — | 1 char | 64 chars | 65 chars · non-printable | `""` → **absent** · `" 8412… "` → trimmed |
| `money` | `-0.01` · `1.234` (3 dp) · `abc` | `0` / `0.00` | `9999999.99` | `10000000.00` | `" 5.99 "` → `5.99` |
| `quantityInt` | `-1` · `1.5` | `0` | `10000000` | `10000001` | string `"5"` → 5 (boundary only) |
| `movementQty` | `0` | `1` | `100000` | `100001` | — |
| adjustment `delta` | `0` | `±1` | `±100000` | `±100001` | — |
| name (user) | 1 char | 2 | 80 | 81 | `" Sara "` → `Sara` |
| category name | 1 char | 2 | 60 | 61 | case-insensitive dup: `electronics` vs `Electronics` → 409 |
| date range (transactions report) | `from > to` · span 367 d | same-day | 366 d span | missing `from` | — |
| `limit` | `0` | `1` | `100` | `101` | — |
| `range` | — | `7` | `90` | `14` (not in enum) | — |
| `cloudinaryPublicId` | `evil/x` · `../ims/prod/x` | `ims/prod/a` | — | — | — |

---

*End of document — VAL-IMS-014 v1.0 · Approved — Ready for Production · 2026-07-23*