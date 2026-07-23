# Authentication & Authorization Design

## Web-Based Inventory Management System

| | |
|---|---|
| **Document ID** | AAD-IMS-009 |
| **Version** | 1.0 (Approved) |
| **Date** | 2026-07-23 |
| **Status** | **APPROVED — READY FOR PRODUCTION** (security review rating 9/10) |
| **Source of truth** | SRS-IMS-001 (§3.1, §14, BR-29…35, SEC-01…12) · ARC-IMS-002 (A-6/A-7, ARB-03) · `05-REST-API-Specification.md` §3 · BEA-IMS-006 — this document conforms to all and never overrides them |
| **Review record** | Principal Security Architect audit — Issues 1–4 incorporated (§10) |

---

## Table of Contents

1. [Design Principles](#1-design-principles)
2. [Credentials & Password Management](#2-credentials--password-management)
3. [Token Architecture](#3-token-architecture)
4. [Session Lifecycle Flows](#4-session-lifecycle-flows)
5. [Authorization Model](#5-authorization-model)
6. [Lockout & Rate Limiting](#6-lockout--rate-limiting)
7. [Security Events](#7-security-events)
8. [Edge-Case Semantics](#8-edge-case-semantics)
9. [Data & Endpoint Binding](#9-data--endpoint-binding)
10. [Security Review Findings Incorporated](#10-security-review-findings-incorporated)
11. [Security Test Requirements](#11-security-test-requirements)
12. [Open Items](#12-open-items)

---

## 1. Design Principles

| Principle | Meaning | Source |
|---|---|---|
| **Fail closed** | Every ambiguous state resolves to "re-authenticate": rotation crash, reuse detection, refresh failure, deactivation | BEV-02, BR-35 |
| **Server is the only authority** | Token claims are informational; authorization uses the live DB record on every request | FR-AUTH-07, EC-17 |
| **Sessions are revocable facts** | Refresh tokens live server-side (hashed); logout, demotion, deactivation, and password change revoke immediately | A-6, SEC-11 |
| **UX guards ≠ security** | Client route guards and hidden buttons are courtesy; the middleware chain is the boundary | §5.3 |

---

## 2. Credentials & Password Management

- **Storage:** bcrypt cost 12; `passwordHash` excluded from all queries by default (`select: false`) and structurally excluded by serializers (BR-32, SEC-02).
- **Policy (BR-32):** ≥ 10 chars, ≥ 1 letter + 1 digit, common-password deny-list — enforced at the §15.6/15.7 schemas, **never revealed on the login form** (login errors stay generic).
- **Enumeration defense (Review Issue 3):** unknown-email logins compare against a static dummy bcrypt hash so both paths cost one bcrypt verification — no timing side-channel.
- **Provisioning (BR-31):** Admin-created accounts only; temporary passwords set `mustChangePassword: true`. The client's `ForcePasswordChange` gate (FEV-02) blocks every route; **server enforcement (Review Issue 2):** a flagged session may call exactly `POST /auth/change-password`, `POST /auth/logout`, and `POST /auth/refresh` — everything else returns `403` with a distinct reason, enforced inside `authenticate` (the user record is already loaded — zero extra cost).
- **Reset (UC-03):** Admin triggers → single-use token (≥ 256-bit CSPRNG, 30-min expiry, stored **hashed**, sparse-indexed per DBR-04) → all target sessions revoked at issue → link delivered out-of-band (AS-6) → completion enforces policy and emits `PASSWORD_RESET_COMPLETED`. Lookup is by hash via the index — timing-safe by construction.
- **Change (own):** requires current password; success revokes **all other** sessions and emits `PASSWORD_CHANGED`.

---

## 3. Token Architecture

### 3.1 Access token — the 15-minute claim

- JWT **HS256, algorithm pinned at verification** (Review Issue 4 — any other `alg`, including `none`, is rejected); secret ≥ 256-bit from environment (SEC-01), distinct per environment.
- Payload exactly `{sub, role, iat, exp}` — no PII; the `role` claim is a display hint only (§1).
- Carried as `Authorization: Bearer`; held **in client memory only** (A-7) — never localStorage/sessionStorage.
- Validation: signature + `exp` with ≤ 30 s clock-skew leeway (EC-32), server-authoritative.

### 3.2 Refresh token — the 7-day revocable session

- Opaque **≥ 256-bit CSPRNG** value (not a JWT); travels only in an `httpOnly · Secure · SameSite=Strict` cookie scoped to `/api/v1/auth` (Strict scoping also neutralizes CSRF on the refresh route).
- Server stores the **hash** plus `familyId`, `expiresAt`, `rotatedAt`, `revokedAt`, `ip`, `userAgent` (`refreshTokens`, DBD §2.5).
- **Rotation on every use:** old row marked `rotatedAt`, new row issued in the same family. Rotated rows are retained until TTL — that retention is what makes reuse detectable.
- **Reuse detection (BR-35):** presenting a rotated/revoked token → revoke the **entire family** → `TOKEN_REUSE_DETECTED` security event → 401. Covers both theft and crash-mid-rotation (BEV-02: fail-closed re-login).
- **Expiry is checked by value; the TTL index is garbage collection only** (PDV-03).
- No idle timeout beyond the two TTLs (AS-5/EC-33 — recorded assumption).

### 3.3 Revocation matrix

| Event | Revokes |
|---|---|
| Logout (idempotent — revoking an already-revoked/unknown token still succeeds) | Current session token |
| Password change (own) | All *other* sessions |
| Password reset issued (Admin) | All target-user sessions |
| Deactivation / role change (FR-USER-04) | All target-user sessions |
| Rotation reuse detected | Entire token family |

---

## 4. Session Lifecycle Flows

**Login (UC-01):** validate → lockout check (§6) → bcrypt verify (dummy-hash path for unknown emails) → failure: increment counter, generic error, `LOGIN_FAILED` event → success: reset counter, stamp `lastLoginAt`, `LOGIN_SUCCESS` event, issue access token + refresh cookie, return user profile. `mustChangePassword: true` → client gate engages, server co-enforces (§2).

**Silent refresh (ARB-03):** any 401 → **single-flight** `POST /auth/refresh` (one in-flight promise; all 401'd requests await it) → rotate → replay each original request **once** → refresh failure: preserve form state (EC-30), clear `authStore`, route to login. App bootstrap uses the same call to hydrate the session (A-7 refresh-on-load).

**Logout:** `POST /auth/logout` revokes the presented token and clears the cookie; client clears all stores.

---

## 5. Authorization Model

### 5.1 Enforcement chain (every authenticated request)

```text
verify JWT (pinned HS256, sig + exp, ≤ 30 s skew)
  → load user by _id (indexed point-read — inside the NFR-01 budget, NFR-04)
      → isActive false?          → 401 ACCOUNT_DEACTIVATED  (effective immediately)
      → mustChangePassword set?  → only change-password / logout / refresh allowed (§2)
      → role from DB record      → authorize(...roles) per the SRS §5 matrix
      → denied                   → 403 FORBIDDEN; ≥ 5 denials/user/15 min
                                   → one security event (BEV-03, fire-and-forget)
```

The **SRS §5 permission matrix is the single authority**: backend route annotations and the frontend's generated `usePermission` matrix (FD-3) both derive from it — never hand-maintained in two places.

### 5.2 Special authorization rules

- **Payload-dependent authorization — one route only (Review Issue 1):** `POST /inventory/movements` is Any-role for `STOCK_IN`/`STOCK_OUT` and Admin-only for `ADJUSTMENT`. Because `authorize` needs the validated body's `type`, **this route orders `validate` before the type-aware `authorize`** — an explicit, documented exception to the standard chain, permitted because routes own their middleware chains (BEA §2). No other route may adopt payload-dependent authorization without architecture review.
- **Last-admin invariant (BR-30):** Admin demotion/deactivation runs inside transaction **T6** — atomic active-admin count; violation → `409 LAST_ADMIN`. Applies to self-demotion; self-deactivation additionally requires explicit confirmation and revokes own sessions.
- **Public surface:** login, refresh (cookie), reset-password (token), `/health`, `/ready` — everything else authenticated.

---

## 6. Lockout & Rate Limiting (layered, distinct jobs)

| Layer | Scope | Rule |
|---|---|---|
| Account lockout (BR-33) | Per account — **global authority** (DB-backed) | 5 consecutive failures → 15-min lock (`423 ACCOUNT_LOCKED`); `LOCKOUT` event; counter resets on success |
| Strict limiter (SEC-04) | Per IP, per instance | 10 attempts / 15 min on `/auth/login` + `/auth/reset-password` |
| Global limiter | Per IP, per instance | 300 req / 15 min |

IP correctness depends on exact trust-proxy configuration (ARB-01 — Phase 0 verification, R-4). Per-instance limiter counts (≈ N× nominal at N instances) are accepted because the lockout layer is global.

---

## 7. Security Events (SEC-09 → `auditLogs`)

Closed action set (PDV-01): `LOGIN_SUCCESS · LOGIN_FAILED · LOCKOUT · PASSWORD_RESET_ISSUED · PASSWORD_RESET_COMPLETED · PASSWORD_CHANGED · ROLE_CHANGE · DEACTIVATE · REACTIVATE · TOKEN_REUSE_DETECTED` + the BEV-03 repeated-403 pattern event. Each records actor, target, IP, outcome, server timestamp; Admin-visible in the Audit Trail tab; written fire-and-forget — never blocks the request path.

---

## 8. Edge-Case Semantics

| Case | Behavior |
|---|---|
| Crash mid-rotation | Fail-closed: next refresh trips reuse detection → family revoked → re-login (BEV-02) |
| Multi-tab refresh race | Single-flight prevents same-tab races; cross-tab collisions accepted — affected tab re-authenticates (EC-31) |
| Deactivated mid-session | Next request 401s (per-request load); refresh tokens already revoked (FR-USER-04) |
| Demoted mid-session | Privileged calls 403 immediately; the token's stale role claim is irrelevant (EC-17) |
| Expiry mid-form | Silent refresh + single replay; input never discarded; failed refresh preserves form state through the redirect (EC-30) |
| Expired/used reset token | Specific error + "request a new reset"; tokens are single-use regardless of outcome |

---

## 9. Data & Endpoint Binding

- **Collections:** `users` (credential/lockout/reset state) + `refreshTokens` (session store), exactly per DBD-IMS-004 §2.1/§2.5, with indexes `{email}` unique, `{role, isActive}`, `{resetTokenHash}` sparse, `{tokenHash}` unique, `{userId}`, `{familyId}`, TTL `{expiresAt}`.
- **Endpoints:** the five `/auth` routes + `POST /users/:id/reset-password` per `05-REST-API-Specification.md` §7.1/§7.2, with error subsets as bound in BEA-IMS-006 §5.
- **Layering:** all logic in `AuthService`/`UserService`; `authenticate`/`authorize` middleware; schemas in `validation/`; token utilities in `lib/` — per the BEA folder contract.

---

## 10. Security Review Findings Incorporated

| # | Finding (severity) | Resolution |
|---|---|---|
| 1 | Payload-dependent authorization vs middleware order — adjustments could ship under-protected (**Major**) | Movements route orders `validate` → type-aware `authorize`; documented single exception (§5.2) |
| 2 | `mustChangePassword` server enforcement scope implicit (Minor) | Exact allowed set defined: change-password, logout, refresh (§2, §5.1) |
| 3 | Login timing side-channel enables user enumeration (Minor) | Dummy bcrypt compare on unknown email (§2) |
| 4 | Token parameters under-specified — entropy + algorithm confusion (Minor) | ≥ 256-bit CSPRNG tokens; JWT verification pins HS256; idempotent logout (§3) |

---

## 11. Security Test Requirements

Added to the NFR-26 integration matrix — these pin the review fixes permanently:

1. Staff submitting `type: ADJUSTMENT` to `/inventory/movements` → `403` (Issue 1).
2. `mustChangePassword` session probing every endpoint → only the three allowed succeed (Issue 2).
3. Timing delta between unknown-email and wrong-password logins within noise (Issue 3).
4. Tampered-`alg` JWTs (incl. `none`) rejected (Issue 4).
5. Lockout sequence (5 failures → 423 → expiry); rotation replay (same token twice → family revoked + `TOKEN_REUSE_DETECTED`); revocation matrix (each §3.3 row unusable within one request).

---

## 12. Open Items

**FCM-01 (awaiting ratification):** include `systemCurrency` and `movementWarningThreshold` as read-only display constants in the login/refresh response payload — Staff has no other approved endpoint for them (the §5 matrix keeps `GET /settings` Admin-only). Additive and EXT-01-compliant; exposes no settings management. Ratifying closes the session-payload contract; auth mechanics are implementable regardless.

---

*End of document — AAD-IMS-009 v1.0 · Approved — Ready for Production · 2026-07-23*