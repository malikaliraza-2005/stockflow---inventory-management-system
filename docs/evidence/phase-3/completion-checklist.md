# Phase 3 (Inventory Core) — Completion Checklist ⚠ Change-Controlled

| | |
|---|---|
| **Phase** | Phase 3 — Inventory Core · Milestone **M3 — The Ledger (hard gate)** |
| **Features** | **F6** Stock Movements & Adjustments · **F7** Stock Ledger tab (P3 slice) |
| **Source** | `docs/phases/phase-3-inventory-core.md` · IMP-020 §2-F6/F7 · DBD §4 · ARB-02/A-1/A-4/A-8 |
| **Commits** | `655323e` (3.1 T1) · `f3bf775` (3.2 endpoint) · `4cf39cd` (3.3 ledger read) · `a5f4377` (3.4 jobs) · `9d03593` (3.5 frontend) · (3.6 this checklist + E2E) — branch `feat/f6-movement-service` |
| **Tags (on merge)** | `f6-movement-service` · `f6-dialogs` · `f6-jobs` · `m3-the-ledger` — pending PR/merge |
| **Operator** | Ali Raza (AS-19) |
| **Status** | ⬜ **CODE-COMPLETE — the staging-dependent DoD items (E2E on staging, sweep closing the orphan window on staging, staging reconcile) are pending the 0.12 deploy** |
| **Test totals** | **319 server** (unit + integration) + **2 e2e** · **151 client** — all green |

---

## Per-feature completion checklist (IMP §4)

### F6 — Stock Movements & Adjustments (the change-controlled core)

| □ | Item | Status | Evidence |
|---|---|---|---|
| T-a | Movement schema (VAL §3.4) + client mirror | ✅ | `validation/schemas/movements.ts` (discriminated union; INITIAL excluded; delta XOR counted; note-for-OTHER) + client mirror |
| T-b | `{idempotencyKey}` unique-sparse index + `transactions` DES-1 validator | ✅ | `Transaction.ts` index; `jsonValidators.ts`; `models-transactions.test.ts` (dup key, sparse coexistence, updatedAt/enum/negative/empty-key rejection) |
| T-b | `jobLocks` infra collection (BEV-05) | ✅ | `models/JobLock.ts` — outside the business model, TTL GC |
| lib | Idempotency helper **before** the service (BEA §6) | ✅ | `lib/idempotency.ts` — fast-path replay → duplicate-key-as-replay → conflict, in one place |
| T-c | **T1** (DBD §4) + BR-11…20 → named tests | ✅ | `movement-service.test.ts` — parallel-T1 invariant, oversell-never-negative, concurrent-same-key-commits-once, replay/conflict, no-partial-state, INSUFFICIENT_STOCK with `available` |
| T-c | Jobs group (TST §4) | ✅ | `jobs.test.ts` — lease single-execution/takeover/release, reconciliation drift (ARB-05), orphan sweep cross-reference |
| T-d | `POST /inventory/movements` binding rows | ✅ | `movements-routes.test.ts` — validate-before-authorize (Staff ADJUSTMENT 403), key 400, INSUFFICIENT_STOCK 409 `{available,requested}`, PRODUCT_ARCHIVED 409, replay 200 / conflict 422 |
| T-e | OpenAPI + types | ✅ | `/inventory/movements` path + Movement* schemas; client types regenerated |
| T-f/g | StockMovementDialog · AdjustmentDialog · ProductPicker · useIdempotencyKey | ✅ | `stock-movement-dialog.test.tsx`, `useIdempotencyKey.test.tsx` — happy path, inline `available`, same-key retry |
| T-h | Wired into ProductDetail (In/Out both roles, Adjust Admin) | ✅ | movement actions + View-ledger deep-link |
| T-i | INSUFFICIENT_STOCK · IDEMPOTENCY_CONFLICT · PRODUCT_ARCHIVED states | ✅ | inline `available`; errorMap dialog behavior |
| T-j | **E2E smoke to the ledger-sum assertion** | ✅ (dev) | `ledger-smoke.e2e.test.ts` — login → add → stock in → stock out → `quantity == Σ ledger` |
| **Acceptance** | **M3 hard gate:** invariant holds under the concurrency suite; architecture-review label on every MovementService diff | ✅ (staging items below) | parallel-T1 + oversell suites green; MovementService diff (3.1) carries the label |

### F7 — Stock Ledger tab (this phase's slice)

| □ | Item | Status | Evidence |
|---|---|---|---|
| T-a | Ledger query schema (filters) | ✅ | `validation/schemas/transactions.ts` |
| T-c | Read-only `TransactionService.list` (filters + labels) | ✅ | archived-hide rule (explicit productId wins), product/user label resolution |
| T-d | `GET /transactions` binding rows | ✅ | `transactions-routes.test.ts` — role, labels, type filter, archived hide/show + badge, pagination |
| T-e | OpenAPI + types | ✅ | `/transactions` + TransactionRow schema |
| T-f/g/h | Transactions page — Stock Ledger tab | ✅ | `transactions-page.test.tsx` — rows, EC-16 badge, disabled Audit tab (P5), productId deep-link |
| **Acceptance** | Any quantity explainable from the ledger UI | ✅ | ledger lists INITIAL + movements; smoke asserts sum |

---

## Definition of Done (M3 hard gate — gate to Phases 4 & 5)

- [x] **Invariant holds under the full concurrency suite** — parallel-T1 on one product; oversell pressure never drives quantity negative; `quantity == Σ ledger` after every race (`movement-service.test.ts`)
- [x] **Replay semantics verified** — same payload → original result; different payload → 422; concurrent duplicate-key → one commit, both replay (ARB-02)
- [x] Jobs group green (lease single-execution, drift detection, sweep cross-reference)
- [ ] **Sweep has closed the P2 orphan window on staging** — ⏳ pending 0.12 (sweep logic + cross-reference proven on mocked Cloudinary; real folder-listing runs on the deployed tier)
- [ ] **E2E smoke green on staging incl. ledger-sum assertion** — ⏳ pending 0.12 (green on the ephemeral replica set)
- [ ] **Every product on staging reconciles** — ⏳ pending 0.12 (reconciliation job proven locally; carries the same blocker as P2)
- [x] **Every MovementService diff carried the architecture-review label** — the T1 diff (3.1) is the only change to the change-controlled module; endpoint/read/jobs/frontend slices do not touch it
- [x] Per-feature checklists (IMP §4) signed for F6 + F7-slice (above)

---

## Cross-cutting decisions recorded this phase

- **Idempotency "same payload" reconstructed from the stored row** — no payload-hash field added (keeps the closed `transactions` schema, PDV-01). Every movement is fully determined by `{productId, type, reason, note}` + the signed `quantityChange` (or, for counted mode, `quantityAfter` == the counted value), so the stored Transaction alone distinguishes a genuine replay from a key-reuse bug.
- **Counted adjustment equal to current stock (delta 0) → `VALIDATION_ERROR`**, not a silent no-op — BR-12 forbids a zero-change ledger row; the specs did not state this case.
- **`refTransactionId` excluded from the request body** — VAL §3.4 lists it server-derived/ignored; compensations are a system-originated R7 concern, not this public endpoint (REST §7.5's "optional" mention superseded by the schema authority).
- **Movements are NOT audited into `auditLogs`** — the ledger row IS the record of a stock change; auditLogs covers non-stock state (DBD §2.6).
- **`transactions` JSON validator landed here** (F6, its first-consumer per `jsonValidators.ts` ownership) — DES-1 append-only: rejects `updatedAt`, enforces the closed enums and `quantityAfter ≥ 0`.
- **Cloudinary `listFolder` added to the client interface** — the orphan sweep is its first consumer (BEV-04), paginated; existing fakes extended.
- **Bounded transient retry via `session.withTransaction`** — same primitive as `recordInitial`; a duplicate-key on `idempotencyKey` is NON-transient, so it aborts and surfaces to the helper as the replay signal (ARB-02). Tight R-2 bounding is a P6 load-test concern.
- **`useIdempotencyKey` returns a memoized object** — a fresh object each render caused an infinite effect loop in the dialog (caught by the component test); the hook now returns a stable reference.

## Known intermittent

- The replica-set memory-server suite occasionally reports a single transient failure under parallel load; it does not reproduce on re-run and passed on every full run. Not a defect — noted for visibility (carried from P2).

## Remaining before phase exit is fully signed

The open DoD items (staging E2E, sweep closing the orphan window on staging, staging reconcile) share the blocker with Phase-0 task 0.12 / P1 / P2 staging acceptance: a purchased domain + Render/Vercel deploy. Once that deploy runs, on staging: run the smoke to its ledger-sum assertion, let the orphan sweep close the accepted window, reconcile every product, then create the tags (`f6-movement-service`, `f6-dialogs`, `f6-jobs`, `m3-the-ledger`) and re-sign.

**Sign-off (code-complete):** _______________ (operator) · date: ________
**Sign-off (M3 staging acceptance):** _______________ (operator) · date: ________
