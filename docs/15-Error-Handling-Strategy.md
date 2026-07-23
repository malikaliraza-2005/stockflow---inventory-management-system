# Error Handling Strategy

## Web-Based Inventory Management System

| | |
|---|---|
| **Document ID** | ERR-IMS-015 |
| **Version** | 1.0 (Approved) |
| **Date** | 2026-07-23 |
| **Status** | **APPROVED — READY FOR PRODUCTION** (review rating 9/10) |
| **Source of truth** | SRS-IMS-001 §16 · `05-REST-API-Specification.md` §6 · BEA-IMS-006 · FEA-IMS-007 §8 · SMA-IMS-013 §7 · VAL-IMS-014 §9 · AAD-IMS-009 — this document consolidates them and never overrides them |
| **Review record** | Principal Architect audit — Issues 1–3 incorporated; **E-1, E-2, P-1 ratified** (§12) |
| **Role** | The single source of truth for how errors are detected, propagated, transformed, logged, and presented |

---

## Table of Contents

1. [Principles](#1-principles)
2. [Error Taxonomy](#2-error-taxonomy)
3. [Backend Error Handling](#3-backend-error-handling)
4. [REST API Error Contract](#4-rest-api-error-contract)
5. [Frontend Error Handling](#5-frontend-error-handling)
6. [Async Error Flows](#6-async-error-flows)
7. [Streaming Failure Policy](#7-streaming-failure-policy)
8. [Logging & Observability](#8-logging--observability)
9. [Security Posture](#9-security-posture)
10. [Recovery Strategy](#10-recovery-strategy)
11. [Testing Requirements](#11-testing-requirements)
12. [Ratified Additions & Review Findings](#12-ratified-additions--review-findings)
13. [Implementation Guidelines](#13-implementation-guidelines)

---

## 1. Principles

| Principle | Meaning |
|---|---|
| **One envelope, one catalog** | Every failure crosses the wire as the §4 envelope with a code from the closed SRS §16.3 catalog — no endpoint-specific formats |
| **Typed at the source, rendered at the edge** | Services throw typed errors; exactly one backend middleware serializes; exactly one frontend interceptor maps to UX |
| **Fail closed, fail informative** | Security-ambiguous states end sessions (AAD §1); everything else tells the user what happened and what to do, with a correlation ID for support |
| **Input is never punished** | No failure discards user input (EC-28/30) — retry is always possible from where the user stood |
| **Opaque in production** | Stack traces, ODM internals, and paths never leave the server (SEC-12) |

---

## 2. Error Taxonomy

| Category | Typical causes | HTTP | Codes | Retry? | User-facing behavior |
|---|---|---|---|---|---|
| Validation | Schema violation, bad enum, range breach | 400 | `VALIDATION_ERROR` (+`details[]`) | After correction | Inline field errors via `FormField`; first error focused |
| Authentication | Bad credentials, expired/invalid token, lockout, deactivation | 401 / 423 | `UNAUTHORIZED` · `ACCOUNT_LOCKED` · `ACCOUNT_DEACTIVATED` | 401 → silent refresh once; else re-login | Generic login errors; lockout wording; `endSession` on terminal cases |
| Authorization | Role denied, flagged-session probing | 403 | `FORBIDDEN` | No | Redirect `/` + notice (EC-19); repeated denials → security event (BEV-03) |
| Business rule / conflict | Stock shortfall, duplicates, stale write, last admin, archived target, category in use | 409 | `INSUFFICIENT_STOCK` · `DUPLICATE_SKU/BARCODE` · `STALE_WRITE` · `LAST_ADMIN` · `PRODUCT_ARCHIVED` · `CATEGORY_IN_USE` | After user decision | Contextual WIR states: available qty inline, conflicting product named, reload banner, reassignment picker |
| Semantic | Unreadable scan payload, idempotency payload mismatch | 422 | `INVALID_BARCODE` · `IDEMPOTENCY_CONFLICT` | Scan again / never | Scanner error state; conflict toast (client bug — logged) |
| Not found | Unknown id, unknown scan code, dead URL | 404 | `NOT_FOUND` | No | Scanner not-found card; 404 page for routes; list-refresh hint for stale rows |
| Rate limiting | Limiter thresholds (SEC-04) | 429 | `RATE_LIMITED` | After delay | "Try again shortly" toast |
| Database / internal | Bugs, integrity failures, exhausted transaction retries | 500 | `INTERNAL_ERROR` | No (client) | Opaque message + correlation ID; error tracking fires |
| Service unavailable | DB down/not ready, startup, drain | 503 + `Retry-After` | `SERVICE_UNAVAILABLE` | Yes, honoring header | Maintenance banner; movements guaranteed non-partial (BR-19) |
| External service | Cloudinary signature/destroy failure | typed → 500-class, logged distinctly | — | Upload: whole-file retry | Failed tile `[Retry][Remove]`; product save never blocked (BR-37) |
| Network (client-only, **E-1**) | Offline, 30 s timeout, DNS | — (no response) | `NETWORK_ERROR` — synthesized, **never on the wire** | GETs auto-retry ×1; mutations via idempotency key | Distinct connection message; draft preserved; manual retry |
| Chunk load (client-only, **E-2**) | Lazy route fetch fails post-deploy | — | `CHUNK_LOAD_ERROR` — synthesized | One automatic reload | Route fallback with `[Reload]` if the retry also fails |

---

## 3. Backend Error Handling

```text
Middleware (auth/validate/limiters) ─┐
Service (business rules) ────────────┼─ throw AppError(code, status, details?)
Model/driver (dup key, txn) ─────────┘        │
        Controllers NEVER catch* ─────────────▼
        (*except translating 3rd-party    Terminal errorHandler middleware
         errors into typed AppErrors)       1. known AppError → envelope
                                            2. unknown → log stack + track
                                               → opaque INTERNAL_ERROR
                                            3. attach correlationId
                                            4. status + JSON — the ONLY
                                               failure response writer
```

- **`AppError` hierarchy** (`server/src/errors/`): one subclass per catalog code, constructor-locked to its status; `details` typed per code (e.g., `InsufficientStockError(available, requested)`).
- **Async safety:** all handlers wrapped so rejected promises always reach the terminal middleware; `unhandledRejection` / `uncaughtException` → log + track + exit (host restarts; NFR-21 drain applies).
- **Translations:** Mongo `E11000` → the matching `DUPLICATE_*` · `TransientTransactionError` → bounded retry, then 503 · Cloudinary SDK errors → typed upload error. **Duplicate key on `idempotencyKey` is not an error** — it is the ARB-02 replay signal, handled inside MovementService before the error path.
- **Serialization:** the terminal middleware is the only place an error becomes JSON; no stack, no internal fields, correlation ID always present.

---

## 4. REST API Error Contract (restated from `05` §6 — unchanged)

```json
{ "error": { "code": "INSUFFICIENT_STOCK", "message": "Only 12 units available.",
             "details": { "available": 12, "requested": 25 },
             "correlationId": "c1f4b7e2-…" } }
```

Envelope on **every** non-2xx response, all endpoints, no exceptions; codes from the closed catalog; `details` code-specific (`VALIDATION_ERROR` → `[{field, message}]`); correlation ID always echoed. `/health` and `/ready` return plain status bodies (monitoring consumers, not the app).

---

## 5. Frontend Error Handling

### 5.1 The interceptor — single entry point for API failures

```text
response error
 ├─ no response → synthesize NETWORK_ERROR (E-1)
 ├─ 401 → single-flight refresh → replay once → still failing → endSession('expired')
 ├─ envelope → typed ApiError{code, message, details, correlationId}
 └─ ApiError → ONE code→behavior table (lib/errorMap):
      inline-field | dialog-state | banner | toast | redirect | endSession
```

### 5.2 Behavior by failure class

| Failure | Renders | Navigation |
|---|---|---|
| `VALIDATION_ERROR` | `FormField` inline via `details[]`; first error focused | none |
| 409 conflicts | Owning dialog/page's designed WIR state | none — user decides |
| `FORBIDDEN` | Notice toast | redirect `/` (EC-19) |
| Auth terminal | Persistent toast | `endSession(reason)` (SMA §7) |
| `NETWORK_ERROR` / 503 | Connection toast + in-place `[Retry]`; drafts intact | none |
| `RATE_LIMITED` | Wait-hint toast | none |
| `INTERNAL_ERROR` / unknown | Toast with correlation ID ("reference: c1f4…") | none |
| Render crash | Route-level boundary per chunk group: message + `[Retry]` — never a blank screen. **Boundaries key on location and reset on navigation** (review Issue 3) | stays |
| `CHUNK_LOAD_ERROR` | One silent reload → else boundary fallback with `[Reload]` | stays |

**Global rules:** input never discarded · error toasts persist until dismissed (SMA §4) · error states carry stable `data-testid`s.

---

## 6. Async Error Flows

| Flow | Handling |
|---|---|
| Standard requests | §5.1 pipeline; GETs auto-retry once on network error; mutations retry only via the idempotency key (NFR-19) |
| Image upload | Per-file isolation: failed tile `[Retry][Remove]`; signature failure = upload error, not form error; save proceeds without the image (BR-37); abandoned assets → backend sweep (BEV-04) |
| Scanning | Errors are **machine states**, not toasts: `INVALID_BARCODE` → error state with rescan; permission/hardware states per FEA §6.1; lookup network failure → card-level retry |
| Authentication | Login errors generic in-form (AAD §2); refresh failures → `endSession('expired')` with form preservation (EC-30); rotation-reuse is invisible to the UI (fail-closed re-login) |
| Background jobs (backend) | Errors log at `error` with job name + lease id; reconciliation drift is `warn` + report row, never an exception; job failures never surface to users — the Consistency report is the UI |
| Lazy routes | E-2 policy (§2) |

---

## 7. Streaming Failure Policy (review Issue 1)

CSV export streams with headers already sent — the terminal middleware cannot envelope a mid-stream failure. Policy:

1. The export stream writes rows **only after a successful first batch** — most failures occur before headers and receive the normal envelope.
2. On a stream error after headers: log at `error` with correlation ID and **destroy the connection** — the client sees an aborted download, never a plausible-but-truncated file.
3. The frontend export action detects the abort and shows a "download failed — retry" toast.

---

## 8. Logging & Observability

- **Log:** `timestamp, level, correlationId, userId?, method, path, status, durationMs, code?`; full stack for 5xx; security events per SEC-09 (separate audit path).
- **Never log — and (review Issue 2) this list applies verbatim to error-tracking payloads and breadcrumbs on both tiers:** passwords, tokens/hashes, raw scan payloads, credential-bearing request bodies, PII beyond user IDs (SEC-12). Tracker request-body capture disabled; scrubbing verified by a test inspecting a captured event.
- **Levels:** `error` = 5xx + integrity + job failures · `warn` = 409/422/423/429, lockouts, reconciliation drift, reuse events · `info` = lifecycle · `debug` = dev only.
- **Tracking:** unknown errors → error-tracking on both tiers, correlated by ID; boundaries report component context (stack in dev only).
- **Dev vs prod:** dev responses may include a `debug` stack field behind a `NODE_ENV` check defaulting off; production never.

---

## 9. Security Posture

Opaque 500s; the correlation ID is the only debugging handle exposed. Generic auth failures + timing defense (AAD §2). **P-1 (ratified):** no existence oracle — role-hidden resources behave as `403` identically whether or not the resource exists. Error messages contain no schema or internal names; field names in `details[]` are the API's public field names only.

---

## 10. Recovery Strategy

| Class | Recoverable? | Mechanism |
|---|---|---|
| Validation, business conflicts | ✔ user-driven | Corrected input / decision; input preserved |
| Network, 503, 429 | ✔ retry | GET auto-retry ×1; mutations via same idempotency key; `Retry-After` honored; drafts intact |
| Session expiry | ✔ | Silent refresh → replay; else `endSession` with best-effort form preservation |
| Stale write | ✔ | Reload-and-reapply banner (BR-24) |
| Chunk load | ✔ | One reload; then manual |
| Deactivation, family revocation, `INTERNAL_ERROR` | ✖ client-side | `endSession` / correlation-ID support path |
| Degradation | — | Cloudinary down: placeholders + movements unaffected (NFR-16); DB down: maintenance banner, zero partial writes (BR-19) |

---

## 11. Testing Requirements (extends NFR-26)

- **Backend unit:** every `AppError` subclass serializes to its exact envelope; the translation table (E11000, transient exhaustion → 503, Cloudinary); the replay-not-error idempotency path.
- **Backend integration:** per endpoint, every declared code is reachable and correctly shaped (**generated from VAL-IMS-014 §5's failure columns**); unknown route → 404 envelope; controller-thrown errors reach the terminal handler.
- **Frontend:** interceptor behavior-table tests (each code → declared behavior); single-flight refresh + replay-once; `NETWORK_ERROR` synthesis; boundary rendering + **reset-on-navigation**; chunk-load retry-once; form preservation on 401-mid-submit.
- **Failure simulations:** kill DB mid-movement (no partial state + 503) · Cloudinary failure mid-upload (save proceeds) · token expiry mid-form (input survives) · **kill the export stream mid-flight (connection aborts — never a complete-looking truncated file)**.

---

## 12. Ratified Additions & Review Findings

**Ratified with this document:**

| ID | Addition | Scope note |
|---|---|---|
| **E-1** | `NETWORK_ERROR` — client-synthesized code | Never on the wire; UI plumbing |
| **E-2** | `CHUNK_LOAD_ERROR` + retry-once policy | Never on the wire; UI plumbing |
| **P-1** | No-existence-oracle policy (uniform `403` for role-hidden resources) | Security clarification implied by SEC posture, now explicit |

**Review findings incorporated:**

| # | Finding (severity) | Resolution |
|---|---|---|
| 1 | Mid-stream export failures produced plausible-but-truncated files (**Major**) | §7 streaming policy: first-batch gate + connection destroy + client abort toast |
| 2 | Never-log list didn't cover error-tracking payloads (Minor) | §8 — list applies to tracker payloads/breadcrumbs; body capture off; scrub test |
| 3 | Error boundaries could trap users after navigation (Minor) | §5.2 — boundaries key on location, reset on route change |

---

## 13. Implementation Guidelines

- **Backend:** `errors/` (AppError hierarchy + catalog constants — SRS §16.3 as code) · `middleware/errorHandler` · translations live beside their sources (model layer for Mongo, UploadService for Cloudinary).
- **Frontend:** `lib/errorMap` (code→behavior + code→message — the only place messages live) · `api/` interceptor pair · `ui` error primitives (`AlertBanner`, `ErrorFallback`) · boundaries per SMP chunk group.
- **Naming:** `XxxError` classes; codes SCREAMING_SNAKE; client-only codes documented as never-on-the-wire.
- **Evolution rule:** a new error code enters the SRS §16.3 catalog first (change-controlled), then `errors/` constants, then `errorMap` — the same single-source discipline as validation.

---

*End of document — ERR-IMS-015 v1.0 · Approved — Ready for Production · 2026-07-23*