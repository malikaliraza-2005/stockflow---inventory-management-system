# Phase 1 — Auth & Users

| | |
|---|---|
| **Effort** | ≈ 1.5 weeks |
| **Features** | **F1** Authentication & Sessions · **F2** User Management · F11 (store slice) — per IMP-020 §2 |
| **Milestone** | **M1 — Secure Shell** |
| **Sources** | IMP-IMS-020 §2-F1/F2 · RDM-IMS-019 §2-P1 · AAD-IMS-009 · SMA-IMS-013 |

## Phase Overview

The full authentication surface plus user lifecycle — and the frontend dependency root (config → interceptors → types → ui primitives → shell → guards). Ends with both roles live on staging through the real domain topology.

## Objectives

1. AAD-IMS-009 implemented in full, adversarially verified (§11 suite).
2. The generated §5 permission matrix live on both tiers from one definition.
3. Frontend dependency root complete; the three stores operational.
4. **FCM-01 ratified and implemented** (session payload display constants).

## Prerequisites

Phase 0 DoD complete. **FCM-01 decision made before F1's T-d task** (routes) — the tripwire test `FCM-01__staff_currency_display` flips from pending in this phase or the gap ships.

## Scope & Tasks

Both features run the standard pipeline (IMP-020 §1, T-a…T-k). Phase-specific content:

### F1 — Authentication & Sessions

- Endpoints: all five `/auth` routes (`05` §7.1) · DB: `users` credential fields + `refreshTokens` (DBD §2.1/2.5).
- Feature tasks: rotation + family revocation · **AuditService core + security-event path (first consumer — IMP Issue 2)** · dummy-hash timing defense · lockout with injected clock · single-flight interceptor · guard spine incl. `ForcePasswordChange` · `authStore` full · `settingsStore` hydration (FCM-01).
- Pages: Login · ResetPassword · ForcePasswordChange screen.
- Tests: AAD §11 complete · interceptor hooks · login + reset/forced-change E2E (lands here with its feature).
- **Acceptance:** both roles authenticate on staging via the real domain topology; all adversarial tests green; refresh survives access-token expiry (DEP §2 verification).

### F2 — User Management

- Endpoints: all seven `/users` routes (`05` §7.2).
- Feature tasks: **`DataTable` core + `SearchInput` + `Pagination` (first consumers — RDM Issue 1)** · **AuditService entity-diff path (`changes[]`, `entityLabel`/DN-4) — user updates are its first consumer** · T6 atomic last-admin guard · `UserFormModal`, `ResetLinkModal` (out-of-band link display, AS-6).
- Page: Users.
- Tests: T6 concurrent-demotion race · matrix rows · reset-link path.
- **Acceptance:** Admin provisions a Staff account that works immediately; last-admin unviolable under the race test; role changes appear in audit data.

## Deliverables

Working login/refresh/logout/reset/change flows · Users/Profile pages · guard spine + AppShell · three stores · AuditService (core + diff path) · security-event stream · `DataTable` core.

## Definition of Done (gate to Phase 2)

- [ ] AAD §11 adversarial suite green (all seven test classes)
- [ ] Permission matrix verified generated-not-hand-written on both tiers
- [ ] Both roles live on staging; DEP §2 refresh verification passed
- [ ] FCM-01 tripwire enabled and green
- [ ] Login + reset E2E flows green · per-feature completion checklists (IMP §4) signed for F1/F2

## Git Milestones

| Tag / checkpoint | Content |
|---|---|
| `f1-auth-backend` | Auth service + routes + security events, matrix rows green |
| `f1-auth-frontend` | Interceptors, guards, Login/Reset, stores |
| `f2-users` | Users lifecycle + DataTable core + audit diffs |
| **`m1-secure-shell`** | Phase exit — security-suite review + FCM-01 closed |

## Risks

None novel — the design absorbed them (BEV-02/03, ASR-01…04). Watch item: FCM-01 slippage blocks T-d, not the phase end — decide early.
