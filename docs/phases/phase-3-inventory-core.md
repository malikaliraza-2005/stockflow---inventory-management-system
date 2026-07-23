# Phase 3 — Inventory Core ⚠ Change-Controlled

| | |
|---|---|
| **Effort** | ≈ 2 weeks |
| **Features** | **F6** Stock Movements & Adjustments · F7 (ledger tab UI) — per IMP-020 §2 |
| **Milestone** | **M3 — The Ledger** (hard gate) |
| **Sources** | IMP-IMS-020 §2-F6/F7 · RDM-IMS-019 §2-P3 · DBD-IMS-004 §4 · ARB-02/A-1/A-4/A-8 |

## Phase Overview

The system's core: MovementService extended from `recordInitial` to the full T1 path — atomic conditional movements, idempotent replay, the reason-coded adjustment model — plus the three scheduled jobs and the ledger view. **Nothing builds past this phase until the invariant is proven under concurrency.**

## Objectives

1. T1 implemented exactly as specified: conditional update + Transaction insert, majority concerns (A-1), bounded transient retries.
2. Idempotency end-to-end: helper → fast path → duplicate-key-as-replay (ARB-02) → A-4 reconstruction.
3. The three jobs live and leader-guarded (A-8): reconciliation (BR-18/ARB-05), orphan sweep (BEV-04 — closes the P2 window), lease guard.
4. E2E smoke completed to its ledger-sum assertion.

## Prerequisites

Phase 2 DoD complete (products exist; `recordInitial` already inside MovementService — this phase **extends that module**, it does not create it). Architecture-review label workflow active.

## Scope & Tasks

Standard pipeline (IMP-020 §1) with the deepest test tier. Phase-specific content:

### F6 — Stock Movements & Adjustments

- Endpoint: `POST /inventory/movements` — **the validate-before-authorize exception** (AAD §5.2, the only such route).
- Order of work: idempotency helper in `lib/` **before** the service → T1 in MovementService → routes → dialogs.
- DB: `transactions` full (append-only, sparse idempotency index) · `jobLocks` (infra, BEV-05) · DES-1 verification: no mutation surface exists.
- UI: `StockMovementDialog` incl. Step 0 `ProductPicker` (context-free entry) · `AdjustmentDialog` (delta ⇄ counted, reason codes, note-for-OTHER) · `useIdempotencyKey` lifecycle · warning-threshold confirmation (BR-15).
- Jobs (T-c siblings): lease guard · reconciliation with snapshot reads + one re-check (ARB-05) · orphan sweep (Cloudinary listing × publicIds).
- Codes: `INSUFFICIENT_STOCK` (with server `available`), `IDEMPOTENCY_CONFLICT`, `PRODUCT_ARCHIVED`.

### F7 — Ledger View (this phase's slice)

Transactions page, **Stock Ledger tab**: filters (date/type/product/user/include-archived), archived badges (EC-16), pagination. (Audit Trail tab lands in Phase 5.)

### Tests (the deepest set — TST tiers)

Parallel-T1 concurrency on one product · replay-same / conflict-different / duplicate-key-as-replay · injected-failure atomicity (no partial state) · jobs group (TST §4: lease single-execution, drift detection, sweep cross-reference) · **E2E smoke completed: login → add product → stock in → stock out → ledger-sum check**.

## Deliverables

Full MovementService + movement endpoint · both dialogs · ledger tab · three jobs · completed smoke suite.

## Definition of Done (**M3 hard gate** — gate to Phases 4 & 5)

- [ ] Invariant holds under the full concurrency suite
- [ ] Replay semantics verified (same payload → original result; different → 422)
- [ ] Jobs group green; sweep has closed the P2 orphan window on staging
- [ ] E2E smoke green on staging incl. ledger-sum assertion
- [ ] **Every MovementService diff carried the architecture-review label** — deviations went through review, not around it
- [ ] Per-feature checklist (IMP §4) signed for F6 + F7-slice

## Git Milestones

| Tag / checkpoint | Content |
|---|---|
| `f6-movement-service` | T1 + idempotency, unit/concurrency green |
| `f6-dialogs` | Movement/adjustment UI wired |
| `f6-jobs` | Lease + reconciliation + sweep |
| **`m3-the-ledger`** | Phase exit — architecture review of the change-controlled core |

## Risks

**R-2** (hot-product contention) — first real measurements land here; formally gated at P6's load test. Any temptation to "simplify" T1 semantics is a change-control violation by definition.
