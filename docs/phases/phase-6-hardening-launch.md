# Phase 6 — Hardening & Launch

| | |
|---|---|
| **Effort** | ≈ 1.5 weeks |
| **Features** | None — verification, hardening, and production launch (no new feature code by rule) |
| **Milestone** | **M5 — Production Launch** |
| **Sources** | RDM-IMS-019 §2-P6/§8 · DEP-IMS-018 §11/§12 · TST-IMS-017 §2 (P6 gates) · SEC-IMS-016 §13 |

## Phase Overview

Production readiness proven, not assumed: the load test at reference volume, the full accessibility pass, the security review and pen-test, the restore drill, the production environment checklist, launch, and the rollback rehearsal. **A feature change in this phase is a defect in an earlier phase** — fix it there, under its own gates.

## Objectives

1. Every quantified NFR demonstrated at reference volume (NFR-01/02/08).
2. Security posture verified adversarially (SEC-016 review + staging pen-test).
3. WCAG 2.1 AA demonstrated across page **states**, not just page loads (NFR-30).
4. Production environment live per the DEP §12 checklist — including the §2 domain mandate.
5. Launch with a rehearsed rollback and a non-mutating verification set.

## Prerequisites

M4 complete (Phases 4 + 5 DoD) · zero S1/S2 defects open · restore-drill scheduling with the operator (AS-19) · load-test tooling chosen and recorded (the open implementation choice from TST §11).

## Scope & Tasks

| # | Task | Source | Exit evidence |
|---|---|---|---|
| 6.1 | **Load test** at 10k products / 500k transactions / 50 concurrent: p95 budgets, hot-product T1 contention (**R-2 gate**), audit-filter plans (**R-5 gate**), zero COLLSCAN on the DBD §3 map, LCP < 2.5 s on the login path | NFR-08, TST §2 | Report filed with budget table |
| 6.2 | **Full a11y pass:** axe per page state (dialogs open, scanner states, form errors, expanded rows) + keyboard-only walkthroughs of the 5 E2E flows | NFR-30, TST Issue 3 | State-pass report |
| 6.3 | **Security review** vs SEC-016 §2 placement + the AAD §11 suite re-run + **staging pen-test** (seeded per-role accounts, correlation-ID handles); findings dispositioned | SEC §13 | Disposition log |
| 6.4 | **Restore drill** to staging: snapshot → integrity check → reconciliation → orphan reconcile → verification set | DEP §10 | Drill record (failure = S1-class) |
| 6.5 | **Production environment:** full DEP §12 Phase-0 checklist — custom domains + refresh verification (§2 mandate), trust-proxy echo, Atlas/Cloudinary hardening, console MFA, secrets, monitor + alert test-fire | DEP §12 | Signed checklist |
| 6.6 | **Launch:** seed release-phase → rolling deploy gated on `/ready` → **non-mutating production verification set** (health, headers, smoke-account login, read-only fetches, logout — the mutating suite is banned from production) | DEP §11 | Verification green |
| 6.7 | **Rollback rehearsal:** redeploy previous artifact < 15 min, verification set green after | NFR-15 | Timed record |
| 6.8 | ADR sweep + docs closure: all NFR-29 ADRs filed (session model, Archive lifecycle, ledger invariant); traceability script final run | NFR-29, TST §8 | CI green, `docs/adr/` populated |

## Deliverables

Load-test report · a11y state-pass report · security disposition log · drill record · signed production checklist · launched system · rollback record.

## Definition of Done (= the RDM §8 Release Readiness Checklist, M5 go/no-go)

- [ ] DEP §12 production checklist signed (incl. §2 domain mandate + refresh verification)
- [ ] Pipeline green through all staging gates
- [ ] NFR-08 report within budgets; zero COLLSCAN on mapped queries
- [ ] Axe state-pass + keyboard walkthroughs green
- [ ] Security review complete; pen-test findings dispositioned
- [ ] Restore drill executed this quarter
- [ ] Zero S1/S2 open (TST §9)
- [ ] Rollback artifact identified + rehearsal performed
- [ ] Production verification set (non-mutating) green post-deploy
- [ ] **Operator sign-off (AS-19)**

## Git Milestones

| Tag / checkpoint | Content |
|---|---|
| `p6-load-verified` | NFR-08 report within budgets |
| `p6-security-verified` | Review + pen-test dispositioned |
| `rc-1` | Release candidate — all gates but launch |
| **`m5-production-launch` / `v1.0.0`** | Launched; verification set green; rollback rehearsed |

## Risks

R-2 and R-5 are **formally gated here** — a budget miss returns to the owning phase under its change-control rules, not to ad-hoc tuning. Launch-week discipline: the non-mutating rule for production verification is absolute (FR-TXN-02 makes ledger pollution permanent).