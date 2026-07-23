# Implementation Phases — Execution Guide

**Derived from:** IMP-IMS-020 (execution layer) · RDM-IMS-019 (sequencing) — content preserved, reorganized per phase. These documents add no work; every task points into the approved series in `docs/`.
**Governing law (IMP-020):** no shared component, service, or job may be scheduled later than its first consumer — violations are sequencing defects to fix here, never local workarounds.

---

## Execution Order & Dependencies

```text
P0 Foundations ──▶ P1 Auth & Users ──▶ P2 Catalog ──▶ P3 Inventory Core ⚠
                                                          │ (M3 hard gate)
                          ┌───────────────────────────────┤
                          ▼                               ▼
                   P4 Scanning   ∥ (parallel) ∥    P5 Dashboard & Reports
                          └───────────────┬───────────────┘
                                          ▼
                                  P6 Hardening & Launch
```

| Phase | Document | Features | Effort | Milestone | Depends on |
|---|---|---|---|---|---|
| P0 | [phase-0-foundations.md](phase-0-foundations.md) | — (infra + risk kills) | ≈ 1 wk | **M0** Walking Skeleton | approved docs, accounts, **custom domains (DEP §2)** |
| P1 | [phase-1-auth-users.md](phase-1-auth-users.md) | F1 Auth · F2 Users (+F11 store) | ≈ 1.5 wk | **M1** Secure Shell | P0 · **FCM-01 ratified before F1 T-d** |
| P2 | [phase-2-catalog.md](phase-2-catalog.md) | F3 Categories · F4 Products · F5 Images · F11 Settings UI | ≈ 2 wk | **M2** Catalog Complete | P1 (attribution + audit paths) |
| P3 | [phase-3-inventory-core.md](phase-3-inventory-core.md) ⚠ | F6 Movements · F7 ledger tab | ≈ 2 wk | **M3** The Ledger (**hard gate**) | P2 (`recordInitial` exists) |
| P4 | [phase-4-scanning.md](phase-4-scanning.md) | F8 Scanning | ≈ 1 wk | M4 (shared) | **P3 hard gate** |
| P5 | [phase-5-dashboard-reports.md](phase-5-dashboard-reports.md) | F9 Dashboard · F10 Reports · F7 audit tab | ≈ 1.5 wk | **M4** Operations-Ready UX | **P3 hard gate** |
| P6 | [phase-6-hardening-launch.md](phase-6-hardening-launch.md) | — (verification + launch) | ≈ 1.5 wk | **M5** Production Launch | P4 + P5 (M4) |

**Effort:** ≈ 10.5 developer-weeks total; read **~13–14 elapsed weeks** solo (RDM header note). P4 ∥ P5 is the only assumed parallelism.

**Why this order (RDM §1):** each phase produces the substrate the next consumes — sessions before catalog (every write attributed), catalog before movements (movements reference products), the ledger before scanning and analytics (both are views over movements). P3 is change-controlled; **nothing builds on an unproven ledger**.

---

## Progress Checklist

### P0 — Foundations → `m0-walking-skeleton`
- [ ] Repo + CI shell red-blocking on PR
- [ ] Both environment checklists signed (incl. DEP §2 domain + refresh verification)
- [ ] Seed release-phase proven; primitives/catalog/types packages in place
- [ ] R-1 spike filed · R-4 echo · R-6 tier decision · R-7 types generating

### P1 — Auth & Users → `m1-secure-shell`
- [ ] AAD §11 adversarial suite green
- [ ] Matrix generated-not-hand-written on both tiers
- [ ] Both roles live on staging; refresh survives token expiry
- [ ] **FCM-01 ratified; tripwire green**
- [ ] F1/F2 completion checklists (IMP §4) signed

### P2 — Catalog → `m2-catalog-complete`
- [ ] All F3/F4/F5/F11 binding rows green; lifecycle races green
- [ ] Every product reconciles (`quantity == Σ ledger` via `recordInitial`)
- [ ] Catalog plans COLLSCAN-free
- [ ] F3/F4/F5/F11 checklists signed

### P3 — Inventory Core ⚠ → `m3-the-ledger` (hard gate)
- [ ] Invariant holds under the concurrency suite; replay semantics verified
- [ ] Jobs group green; P2 orphan window closed
- [ ] E2E smoke green incl. ledger-sum assertion
- [ ] Architecture-review label on every MovementService diff
- [ ] F6 + F7-slice checklists signed

### P4 — Scanning (∥ P5)
- [ ] Every FR-SCAN state renders its named UI
- [ ] Device matrix executed: scan-to-movement ≤ 3 interactions
- [ ] Manual-entry E2E green; payload-hostility vectors green
- [ ] F8 checklist signed

### P5 — Dashboard & Reports (∥ P4) → `m4-operations-ready`
- [ ] Dashboard within NFR-02; `asOf` honest
- [ ] Five reports + truncation-proof export (abort simulation green)
- [ ] Audit Trail with expansion diffs + post-hard-delete labels
- [ ] F9/F10/F7-slice checklists signed · **M4 phone demo done**

### P6 — Hardening & Launch → `m5-production-launch` / `v1.0.0`
- [ ] NFR-08 load-test report within budgets (R-2/R-5 gated)
- [ ] Axe state-pass + keyboard walkthroughs green
- [ ] Security review + pen-test dispositioned · restore drill executed
- [ ] Production checklist signed · launch + non-mutating verification green
- [ ] Rollback rehearsed < 15 min · **operator sign-off (AS-19)**

---

## Standing Rules (apply to every phase)

1. Every feature runs the **standard task pipeline** (IMP-020 §1, T-a…T-k) and signs the **per-feature completion checklist** (IMP-020 §4).
2. Standing quality gates on every PR (RDM §1): lint/typecheck · BR-traceable tests · declared error paths reachable · review · no coverage regression · ADR/doc updates per NFR-29.
3. `MovementService` diffs require the **architecture-review label** from F4 (P2) onward.
4. Trunk-based branching; `main` always staging-deployable (RDM §9).
5. Open decisions and known windows: **FCM-01** (deadline M1, CI-tripwired) · F5→P3 orphan-sweep window (accepted, documented) · load-test tooling (chosen at P6, recorded).