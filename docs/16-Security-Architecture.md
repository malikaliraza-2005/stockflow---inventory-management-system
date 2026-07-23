# Security Architecture

## Web-Based Inventory Management System

| | |
|---|---|
| **Document ID** | SEC-IMS-016 |
| **Version** | 1.0 (Approved) |
| **Date** | 2026-07-23 |
| **Status** | **APPROVED — READY FOR PRODUCTION** (security review rating 9/10) |
| **Source of truth** | SRS-IMS-001 §14 (SEC-01…12) · AAD-IMS-009 (authentication — used as-is) · BEA-IMS-006 (pipeline, ARB-01…04) · `05-REST-API-Specification.md` · DBD-IMS-004 · VAL-IMS-014 · ERR-IMS-015 — this document consolidates them and never overrides them |
| **Review record** | Principal Security Architect audit — Issues 1–3 incorporated (§14) |
| **Traceability statement** | **Zero new mechanisms, endpoints, or patterns.** Every control cites its approving artifact; this document contributes the trust-boundary model, per-layer responsibility assignment, and the OWASP-aligned mitigation matrix |

---

## Table of Contents

1. [Security Model & Trust Boundaries](#1-security-model--trust-boundaries)
2. [Layered Responsibilities](#2-layered-responsibilities)
3. [Authentication Security](#3-authentication-security)
4. [Authorization Security](#4-authorization-security)
5. [API Security](#5-api-security)
6. [Input Security](#6-input-security)
7. [Data & Secret Security](#7-data--secret-security)
8. [Frontend Security](#8-frontend-security)
9. [Error & Logging Security](#9-error--logging-security)
10. [Security Headers](#10-security-headers)
11. [Threat Mitigation Matrix](#11-threat-mitigation-matrix)
12. [Monitoring & Auditing](#12-monitoring--auditing)
13. [Implementation Guidelines](#13-implementation-guidelines)
14. [Review Findings Incorporated](#14-review-findings-incorporated)

---

## 1. Security Model & Trust Boundaries

```text
        UNTRUSTED                    │                TRUSTED
                                     │
  Browser (SPA) ────────HTTPS/TLS────┤►  Platform LB (exact trust-proxy hop,
   · UX guards only (§5.3)           │      ARB-01 — verified per environment)
   · access token in memory (A-7)    │        │
   · refresh cookie httpOnly ────────┼────────▼
     (invisible to JS)               │   Express API  (stateless instances)
                                     │    middleware pipeline = THE boundary
  Physical barcodes ── camera ───────┤    (§2 — every request fully re-checked)
   · scan payloads = hostile input   │        │ least-privilege user, TLS,
     (BR-16)                         │        │ IP-restricted (SEC-11)
                                     │        ▼
  Cloudinary direct uploads ─────────┤   MongoDB Atlas (replica set)
   · signed-only (SEC-08)            │   Cloudinary (signature-scoped folder)
   · folder-scoped publicIds         │   Secret manager (SEC-10)
     (VAL Issue 4)                   │   Log sink / error tracking
                                     │     (scrubbed, ERR §8)
```

**Boundary rules:** nothing client-side is trusted — not token claims (BR-34), not client validation (VAL §1), not scan payloads (BR-16), not upload metadata (BR-36). The middleware pipeline is the single enforcement gate; there is no second path into services.

---

## 2. Layered Responsibilities (BEA pipeline order — order is normative)

| Layer | Security responsibility | Source |
|---|---|---|
| Platform / TLS | HTTPS everywhere, HSTS; exact proxy-hop trust for real client IPs | SEC-05, ARB-01 |
| `helmet` | API-response headers (§10) | SEC-05 |
| `cors` | Origin allow-list; credentials only on `/auth` routes | SEC-05 |
| Rate limiters | Global 300/15 min/IP + strict 10/15 min/IP on login & reset; per-instance, backstopped by the global DB lockout | SEC-04, BR-33 |
| Body parsing | 1 MB JSON cap; JSON endpoints reject non-JSON content types | SEC-06 |
| `mongoSanitize` | `$`-operator stripping before any schema | SEC-06 |
| `authenticate` | Pinned-HS256 JWT verify + **per-request user load**; deactivation and flagged-session enforcement | AAD §3/§5, EC-17 |
| `authorize` | §5 matrix per route; movements route validates-then-authorizes — the single documented exception | SEC-03, AAD §5.2 |
| `validate` | VAL-IMS-014 schemas — the authoritative input gate; unknown fields stripped; server-managed fields rejected | §12.4, VAL §8 |
| Controllers | Nothing security-relevant — by design | NFR-24 |
| Services | Business-rule authority: conditional updates, atomic guards (T1–T6), last-admin, idempotency hash-compare | BR catalog, DBD §4 |
| Models / DB | Defense-in-depth: unique indexes, JSON-schema validators, `min: 0` | BR-10, DBD §5 |
| Serializers | Structural exclusion of secrets from every response | SEC-12 |
| Terminal error handler | Opacity + correlation ID; the only failure writer | ERR §3 |

---

## 3. Authentication Security (per AAD-IMS-009 — summarized, not redefined)

Bcrypt-12 with dummy-hash timing defense · 10–64 char policy + deny-list (VAL §2) · 15-min pinned-HS256 access token in client memory with minimal claims · 7-day rotating refresh token: opaque ≥ 256-bit CSPRNG, `httpOnly/Secure/SameSite=Strict`, path-scoped, stored hashed with family IDs · reuse detection revokes families (fail-closed, BEV-02) · lockout 5×/15 min (global authority) · reset tokens single-use/30-min/hashed · idempotent logout · full revocation matrix (AAD §3.3) · session validity checked by value — TTL is cleanup only (PDV-03) · `mustChangePassword` sessions restricted to three endpoints (AAD §2).

---

## 4. Authorization Security

- **RBAC:** the SRS §5 matrix is the single authority, generated into backend route annotations **and** the frontend `usePermission` map (FD-3) from one definition — never hand-maintained twice.
- **Enforcement:** server-side on every request against the live user record; role claims informational (BR-34); privilege changes effective within one request (FR-USER-04); the last-admin invariant is transactional (T6).
- **Least privilege:** Staff has no catalog-write, admin, adjustment, export, or audit surface anywhere in the API · app DB user is `readWrite` on one database · Atlas network access IP-restricted, never `0.0.0.0/0` (SEC-11) · Cloudinary signatures scope uploads to one folder.
- **No existence oracle (P-1):** role-hidden resources return uniform `403` behavior regardless of existence (ERR §9).

---

## 5. API Security

HTTPS assumed end-to-end (camera APIs require it — NFR-35) · `Authorization: Bearer` on every protected call; the refresh cookie exists only on `/auth` · request caps: 1 MB bodies, `limit ≤ 100` lists, 366-day report spans · validation per VAL-IMS-014 with boundary-only coercion · output through serializers only (Decimal→string, secret exclusion) · safe errors per ERR-IMS-015 (closed catalog, no internals, correlation IDs) · idempotency keys prevent replay-amplified mutations (BR-20).

---

## 6. Input Security

| Vector | Control |
|---|---|
| NoSQL injection | `$`-key stripping + schema whitelisting + no raw-object query interpolation (SEC-06) |
| Malicious scan payloads | Opaque strings: printable ≤ 64, validated, escaped, never executed or navigated (BR-16, EC-20) |
| Mass assignment | Unknown-field stripping + server-managed-field rejection tables (VAL §3/§8) |
| Oversized / unexpected payloads | Body cap, closed enums, bounds on every numeric (VAL §2), sparse blank→absent (PDV-04) |
| Upload abuse | Signed-only uploads; MIME **and magic-byte** checks; 5 MB / 5-image caps; folder-scoped `publicId` + delivery-host-pinned URLs (SEC-08, BR-36, VAL Issue 4) |

---

## 7. Data & Secret Security

- Passwords and tokens exist only as hashes; `select: false` **plus** serializer exclusion (dual mechanism, SEC-12).
- Secrets exclusively in the platform secret manager, per-environment, ≥ 256-bit, never in repo/artifacts/logs; boot fails on absence (SEC-10, NFR-28). JWT payloads carry no PII.
- **Frontend env vars are public by definition (review Issue 2):** every `VITE_`-prefixed variable is inlined into the shipped bundle — **no secret may ever be `VITE_`-prefixed**; CI grep guard over `client/` for known secret-name patterns.
- Audit protection: `transactions` / `auditLogs` are append-only with no mutation surface (DES-1) — history is uneditable by anyone, including Admin; sensitive fields are never diffed into audit entries (DBD §2.6).
- Backups: Atlas encryption at rest; restore drills per NFR-22. **Control-plane hardening (review Issue 3):** Atlas and Cloudinary console access restricted to named operators (AS-19), **MFA required**, project-role least privilege, no shared logins.

---

## 8. Frontend Security (the client is UX, never enforcement)

Route guards + `usePermission` are courtesy (§5.3); Staff sessions never download admin chunks (SMP §6 guard-outside-lazy) — bandwidth courtesy, not a control · access token in memory only; no storage API ever holds a credential (A-7) · logout → `endSession` full teardown (SMA §7) · XSS: React escaping never bypassed for user data; no raw-HTML injection with user content; scan payloads rendered as text (SEC-07) · client validation is UX-narrowing only (VAL §1).

---

## 9. Error & Logging Security

**ERR-IMS-015 §8–9 is authoritative for this section** (nothing restated, to avoid divergence): opaque production errors, correlation-ID-only debugging, the never-log list extended to error-tracking payloads, generic auth messages, security events on the separate audit path, P-1.

---

## 10. Security Headers (review Issue 1 — split by serving origin)

**The SPA's documents are served by the static host, not Express** — document-level protections must be configured there; Helmet covers API responses only.

| Origin | Header | Value / purpose |
|---|---|---|
| **Static host (SPA documents)** | `Content-Security-Policy` | `default-src 'self'`; `img-src 'self' <cloudinary-delivery-host> data:`; `connect-src 'self' <api-origin>`; no inline script |
| | `Strict-Transport-Security` | HSTS |
| | `frame-ancestors 'none'` (CSP) / `X-Frame-Options: DENY` | Clickjacking |
| | `X-Content-Type-Options` | `nosniff` |
| | `Referrer-Policy` | `strict-origin-when-cross-origin` |
| **API (Helmet)** | `Strict-Transport-Security` | HSTS |
| | `X-Content-Type-Options` | `nosniff` |
| | `Cache-Control` | `no-store` on authenticated responses |
| | (Cookies) | `httpOnly; Secure; SameSite=Strict; Path=/api/v1/auth` |

Phase 0 verification checks headers on **both** origins.

---

## 11. Threat Mitigation Matrix (OWASP-aligned; only controls the architecture defines)

| Threat | Mitigation | Source |
|---|---|---|
| Broken authentication | Rotation + reuse detection, lockout + limiters, timing defense, pinned algorithm, value-checked expiry | AAD |
| Broken access control | Per-request live-record authorization, single-source matrix, T6 atomic guards, P-1 | AAD §5, ERR §9 |
| Injection | Sanitize + whitelist schemas + no raw interpolation | SEC-06, VAL |
| XSS | Escaped rendering, hostile-payload rule, CSP | SEC-07, BR-16, §10 |
| CSRF | The only cookie is `SameSite=Strict` + path-scoped; all other auth is header-borne — no CSRF surface remains | AAD §3.2 |
| Clickjacking | `frame-ancestors 'none'` on the document origin | §10 |
| Sensitive data exposure | Hash-only storage, serializer exclusion, `no-store`, scrubbed logs/trackers, VITE rule | §7, ERR §8 |
| Security misconfiguration | Fail-fast config schema, per-env secrets, CI CVE gates, lockfiles, ARB-01 + dual-origin header verification | NFR-28, SEC-12, R-4 |
| Request abuse / DoS | Dual limiters, body/list/span caps, bounded slow-hash input (VAL Issue 2), DB timeouts | SEC-04, NFR-20 |
| Supply chain | CI vulnerability scanning fails on critical CVEs; monthly patch cadence; lockfiles | SEC-12 |
| Insufficient monitoring | §12 | SEC-09, NFR-23 |

---

## 12. Monitoring & Auditing

Security events (closed enum, PDV-01): login success/failure, lockout, reset issued/completed, password changes, role changes, deactivation/reactivation, token reuse, repeated-403 patterns (≥ 5/user/15 min, BEV-03) — each with actor, target, IP (ARB-01-correct), outcome, server timestamp; Admin-visible in the Audit Trail; written fire-and-forget. Suspicious-activity detection in v1 = these events + alert-worthy `warn` logs (lockout spikes, reuse events, reconciliation drift — NFR-23); **no anomaly engine — correctly out of scope**. Entity changes audited with before/after diffs (FR-TXN-04); the ledger self-audits (BR-17).

---

## 13. Implementation Guidelines

- **Placement:** all security middleware in `server/src/middleware/` in the §2 order — deviations are defects; helmet/cors/limiter configs in `config/`; token utilities in `lib/`; the §5-matrix generator emits backend annotations and the frontend map from one definition file.
- **Secrets:** platform secret manager per environment; `.env.example` documents names only; rotation procedure documented (JWT rotation forces re-login — accepted, SEC-01). The `VITE_` public rule (§7) enforced by CI grep.
- **Conventions:** security events use the closed enum — no ad-hoc names; new controls enter SRS §14 first (change-controlled), then this document, then code.
- **Verification hooks:** Phase 0 — ARB-01 proxy check, Atlas network restriction, Cloudinary folder scoping, dual-origin headers (§10), console MFA (§7). CI — CVE gate, the AAD §11 adversarial suite (adjustment-via-Staff, flagged-session probing, timing delta, tampered-alg, lockout, reuse, revocation matrix), the ERR scrub test, the VITE grep.
- **Pen-test readiness:** staging (config-identical, NFR-28) is the designated target; seeded per-role test accounts + correlation IDs make findings reproducible.

---

## 14. Review Findings Incorporated

| # | Finding (severity) | Resolution |
|---|---|---|
| 1 | Document-level headers (CSP, frame-ancestors, HSTS) were assigned to Helmet, but the SPA is served by the static host — clickjacking/CSP protection would have shipped on JSON responses and not on the HTML (**Major**) | §10 split by serving origin; Phase 0 verifies both |
| 2 | No rule stated that `VITE_` env vars are public — a future "quick fix" could silently leak a secret into the bundle (Minor) | §7 rule + CI grep guard |
| 3 | Control-plane consoles (Atlas/Cloudinary) sat outside the model — the likeliest realistic compromise path for a small team (Minor) | §7 clause: named operators, MFA, role least-privilege, no shared logins |

---

*End of document — SEC-IMS-016 v1.0 · Approved — Ready for Production · 2026-07-23*