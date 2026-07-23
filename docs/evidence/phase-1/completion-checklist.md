# Phase 1 (Auth & Users) — Completion Checklist

| | |
|---|---|
| **Phase** | Phase 1 — Auth & Users · Milestone **M1 — Secure Shell** |
| **Features** | F1 Authentication & Sessions · F2 User Management · F11 (store slice) |
| **Source** | `docs/phases/phase-1-auth-users.md` · IMP-020 §2/§4 |
| **PRs** | #11 (1.1) · #12 (1.2) · #13 (1.3) · #14 (1.4) · #15 (1.5) · #16 (1.6) — all squash-merged through the 8-gate CI |
| **Tags** | `f1-auth-backend` · `f1-auth-frontend` · `f2-users` · `m1-secure-shell` |
| **Operator** | Ali Raza (AS-19) |
| **Status** | ⬜ **CODE-COMPLETE — one DoD item (staging acceptance) pending the 0.12 deploy session** |

---

## Per-feature completion checklist (IMP §4)

### F1 — Authentication & Sessions

| □ | Item | Status | Evidence |
|---|---|---|---|
| T-a | Validation schemas (VAL §5 Auth) green vs Appendix-A vectors | ✅ | `validation/schemas/auth.ts` + client mirror; twin vector suites |
| T-b | Models / indexes / validators tested | ✅ | RefreshToken/AuditLog + DBD §5 JSON validators; index + rejection tests |
| T-c | Every BR (32–35) → named passing test | ✅ | `auth-service.test.ts` (`BR-32/33/35__…`), lockout w/ injected clock, rotation replay |
| T-d | All binding rows green in the integration matrix | ✅ | `auth-routes.test.ts` — success shapes, cookie contract, generic-401 parity, 423, family revocation, limiter 429, sanitization |
| T-e | OpenAPI drift check green; types regenerated | ✅ | 5 `/auth` paths + SessionResponse; client types committed |
| T-f/g | Component states per WIR/UCA rendered | ✅ | Login/Reset/ForcePasswordChange, ToastRegion, guard spine |
| T-h | Routes, guards, URL params round-trip | ✅ | `auth-flow.test.tsx` (RequireAuth, gate, return-to) |
| T-i | Each declared error code renders its designed state | ✅ | errorMap behavior table; generic 401, 423 lockout, dead-link reset |
| T-j | Owned E2E flow green | ✅ | `secure-shell.e2e.test.ts` (login + forced-change) |
| — | Security placement vs SEC-016 §2 · A11y assertions | ✅ | pinned-JWT, dummy-hash, mustChangePassword fence; FormField aria, focus rings |
| **Acceptance** | Both roles authenticate on staging via the real domain; DEP §2 refresh survives token expiry | ⏳ **PENDING** | Blocked on 0.12 deploy (domain purchase). All flows verified locally + on ephemeral replica set |

**AAD §11 adversarial suite (all seven classes):** ✅ green — tampered-`alg`/`none` rejection, mustChangePassword probing, timing parity, lockout sequence, rotation replay → family revocation, revocation matrix, payload-dependent-authz (deferred to F6's route, documented).

### F2 — User Management

| □ | Item | Status | Evidence |
|---|---|---|---|
| T-a | Validation schemas (VAL §5 Users) | ✅ | `validation/schemas/users.ts` + client mirror |
| T-b | Models / lifecycle fields | ✅ | reuses `users` (PR 1.1); guard collection `appguards` (BEV-05 instrument) |
| T-c | Every BR (29–31, T6) → named test | ✅ | `user-service.test.ts` incl. **`BR-30__T6_concurrent_demotion_race`** |
| T-d | Binding rows green (all 7 `/users`) | ✅ | `users-routes.test.ts` — role matrix, DUPLICATE_EMAIL, LAST_ADMIN, param 400/404, reset-link path |
| T-e | OpenAPI + types | ✅ | 7 `/users` paths; types regenerated |
| T-f/g | DataTable core + SearchInput + Pagination + modals | ✅ | `datatable.test.tsx`, `users-page.test.tsx`, `search-pagination.test.tsx` |
| T-h | Users/Profile routes + Admin guard (outside lazy) | ✅ | separate `users` build chunk confirms Staff never downloads it |
| T-i | Error codes render designed states | ✅ | DUPLICATE_EMAIL / LAST_ADMIN inline echo, input preserved |
| T-j | Owned E2E (reset-link path) | ✅ | secure-shell E2E: out-of-band reset → complete → login |
| **Acceptance** | Admin provisions Staff that works immediately; last-admin unviolable under race; role changes in audit data | ✅ | All three asserted (routes + service tests) |

### F11 — Settings (store slice only, this phase)

| □ | Item | Status | Evidence |
|---|---|---|---|
| — | `settingsStore` hydration from session payload (FCM-01) | ✅ | `stores.test.ts`; both roles, zero extra requests |
| — | Formatter symbol-less fallback (SMA §5) | ✅ | `formatters.test.ts` (one-time warning) |
| *(Settings page + `PUT /settings` are Phase-2/F11 UI — out of Phase-1 scope)* | | | |

---

## Definition of Done (gate to Phase 2)

- [x] AAD §11 adversarial suite green (all seven test classes)
- [x] Permission matrix verified generated-not-hand-written on both tiers (canonical `permissionMatrix.ts` → generator → client copy; CI drift step + unit tests)
- [ ] **Both roles live on staging; DEP §2 refresh verification passed** — ⏳ pending 0.12 deploy session (domain purchase outstanding)
- [x] FCM-01 tripwire enabled and green (`FCM-01__staff_currency_display`)
- [x] Login + reset E2E flows green (`secure-shell.e2e.test.ts`); per-feature checklists (above) satisfied for F1/F2

## Cross-cutting decisions recorded this phase

- **FCM-01 ratified 2026-07-23** — session payload carries `settings { systemCurrency, movementWarningThreshold }`. Doc deltas: AAD §12, 05 §7.1, SMA §5, openapi.yaml. Closed the doc series' one open decision.
- **`REPEATED_FORBIDDEN`** added to the auditLogs action enum (documented extension — AAD §7's BEV-03 event; DBD §2.6 had omitted it).
- **T6 race guard** — MongoDB snapshot isolation does not serialize demotions of *different* admin documents; a shared `appguards.$inc` forces the write-conflict that makes BR-30 hold. Recorded in `services/UserService.ts`.
- **react-router pinned to v6.30** (FEA mandate); its data router is jsdom-incompatible → component routing tested via MemoryRouter.

## Remaining before phase exit is fully signed

The single open DoD item is **staging acceptance**, which shares the blocker with Phase-0 task 0.12: a purchased domain + Render/Vercel deploy. Once that deploy session runs, verify on staging:
1. Both roles authenticate through the real `app.` / `api.` domain topology.
2. **DEP §2 refresh verification** — an expired access token is silently refreshed via the httpOnly cookie across the two-origin boundary (the SameSite=Strict cookie scoped to `/api/v1/auth`).
3. Re-sign this checklist with the staging evidence.

**Sign-off (code-complete):** _______________ (operator) · date: ________
**Sign-off (staging acceptance):** _______________ (operator) · date: ________
