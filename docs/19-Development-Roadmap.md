# Development Roadmap

## Web-Based Inventory Management System

| | |
|---|---|
| **Document ID** | RDM-IMS-019 |
| **Version** | 1.0 (Approved) |
| **Date** | 2026-07-23 |
| **Status** | **APPROVED — READY FOR PRODUCTION** (delivery review rating 9/10) |
| **Source of truth** | All eighteen approved artifacts — sequencing spine SRS-IMS-001 §19; enriched by FEA §13, BEA §5, TST §6/§8, DEP §12, and the consolidated risk register R-1…R-7 |
| **Review record** | Principal Architect / TPM audit — Issues 1–3 + estimate note incorporated (§10) |
| **Role** | The single source of truth for development sequencing, milestones, and delivery |
| **Estimate** | ≈ 10.5 developer-weeks of **effort** (SRS §19 basis, 1–2 developers). Calendar ≠ effort: review cycles, the M1 FCM-01 decision, and device-matrix logistics land on the calendar — a solo developer should read **~13–14 elapsed weeks** |

---

## Table of Contents

1. [Phase Roadmap & Dependency Flow](#1-phase-roadmap--dependency-flow)
2. [Phase Details](#2-phase-details)
3. [Feature Delivery Matrix](#3-feature-delivery-matrix)
4. [Milestones](#4-milestones)
5. [Quality Gates](#5-quality-gates)
6. [Risk Matrix](#6-risk-matrix)
7. [Testing Integration](#7-testing-integration)
8. [Release Readiness Checklist](#8-release-readiness-checklist)
9. [Project Management](#9-project-management)
10. [Review Findings Incorporated](#10-review-findings-incorporated)

---

## 1. Phase Roadmap & Dependency Flow

```text
P0 Foundations ──▶ P1 Auth & Users ──▶ P2 Catalog ──▶ P3 Inventory Core ⚠
                                                          │
                          ┌───────────────────────────────┤
                          ▼                               ▼
                   P4 Scanning  (parallelizable with)  P5 Dashboard & Reports
                          └───────────────┬───────────────┘
                                          ▼
                                  P6 Hardening & Launch
```

**Rationale:** each phase produces the substrate the next consumes — sessions before catalog (every write is attributed), catalog before movements (movements reference products), the ledger before scanning and analytics (both are views over movements). **P3 is the change-controlled core** (SRS Phase-3 governance).

**Standing quality gates (every phase — TST §6):** lint/typecheck green · new BRs traceable to tests (NFR-26) · declared error paths reachable · code review on every PR · no business-rule coverage regression · ADR/doc updates when spec-relevant decisions land (NFR-29).

---

## 2. Phase Details

### Phase 0 — Foundations (≈ 1 week)

- **Objective:** everything the first feature PR needs, already working — plus every environmental risk killed.
- **Scope:** monorepo on the FST-008 skeleton · **scaffold reconciliation vs the final component architecture — named task (review Issue 3a)** · CI pipeline shell with all TST §6 PR gates wired · env schema validation both tiers · OpenAPI stub from `05` + type generation into `client/src/types` (R-7: generate from the contract, not a server) · Atlas + Cloudinary `ims-dev`/`ims-staging` (DEP §3) · seed module as release phase · `validation/primitives` from VAL §2 (the shared vocabulary — both tiers depend on it) · error catalog constants + `AppError` skeleton · pino + correlation IDs + health endpoints.
- **Front-loaded risk kills:** **ZXing device spike** (R-1 — the only architecture-threatening unknown) · DEP §12 Phase-0 checklists for dev/staging incl. the **shared-domain + refresh-cookie verification (DEP §2 — the Critical)** · trust-proxy echo (R-4) · Atlas Search tier check (R-6).
- **Exit criteria:** CI runs on PR · staging deploys on merge · seed + integrity check green on staging · spike report filed · both environment checklists signed.

### Phase 1 — Auth & Users (≈ 1.5 weeks)

- **Scope (backend):** the full AAD-IMS-009 surface — login/refresh/logout with rotation + reuse detection · lockout + limiters (trust-proxy from P0) · per-request authorization middleware + the generated §5 matrix (backend annotations **and** frontend map from one definition) · security events · user CRUD + reset flows.
- **Scope (frontend — the FEA §13 dependency root):** config → Axios interceptor pair (single-flight refresh) → generated types → ui primitives — **including `DataTable` core (columns, sort, pagination, `mobileCard`, empty/loading), `SearchInput`, and `Pagination`, pulled forward with the Users page as first consumer (review Issue 1)** → AppShell + guard spine (incl. `ForcePasswordChange`) · the three stores · Login / ResetPassword / Users / Profile pages.
- **Testing:** AAD §11 security suite complete · interceptor + store tests · integration matrix rows for all auth/user endpoints · **reset + forced-change E2E flow lands here, with its feature (review Issue 3b)**.
- **Exit:** Staff and Admin accounts log in on staging through the real domain topology · every AAD §11 adversarial test green · Playwright runs login + reset flows.
- **Deadline:** **FCM-01 ratified at the latest here** — the session payload is being implemented; the CI tripwire flips from pending in this phase or the gap ships.

### Phase 2 — Catalog (≈ 2 weeks)

- **Scope:** ProductService + CategoryService with the full BR set (SKU rules incl. counters/PDV-02, optimistic concurrency, archive/restore/hard-delete — T2/T3/T4/T5, collation queries) · AuditService + audit data · UploadService (signatures, destroy) · `ImageUploader` (FEV-01) · Products / Detail / Add / Edit / Categories pages · **Settings page (Admin form, audited PUT — review Issue 2)** · QR label printing · search per D-1 (Atlas Search, or the fallback per the P0 tier check) · `DataTable` gains what catalog needs beyond the P1 core.
- **Testing:** integration rows for all product/category/upload/settings endpoints · component tests for `ProductForm`, `ImageUploader`, `DataTable` states · lifecycle race tests (BR-22/23/27).
- **Exit:** full catalog CRUD on staging incl. images and archive lifecycle · audit entries visible · zero-COLLSCAN spot-checks on catalog queries.

### Phase 3 — Inventory Core (≈ 2 weeks) ⚠ change-controlled

- **Scope:** MovementService — T1 with majority concerns (A-1), idempotency fast-path + duplicate-key-as-replay (ARB-02/A-4), bounded transient retries · `INITIAL` wiring into product creation · movement/adjustment dialogs incl. product-select Step 0 and `useIdempotencyKey` · Transactions page (ledger tab, incl. `DataTable` expansion for later audit use) · reconciliation job + drift surfacing · jobs lease guard (A-8) + orphan sweep.
- **Testing (the deepest tier):** concurrency simulations (parallel T1s on one product) · replay/conflict · injected-failure atomicity · the jobs group (TST §4) · **E2E smoke completed to its ledger-sum assertion**.
- **Exit:** the invariant holds under the concurrency suite · smoke green on staging · any deviation from T1/ARB-02 semantics went **through** architecture review, not around it.

### Phase 4 — Scanning (≈ 1 week; parallel with P5 after P3)

- **Scope:** Scanner page — `ScannerViewport` state machine, always-visible manual entry, lookup endpoint (BR-06 precedence), unknown/archived flows, payload hardening (BR-16), scan-driven movements via the P3 dialogs, create-from-barcode route state.
- **Testing:** machine-transition component tests · lookup integration rows · E2E scan flow via manual entry (TST Issue 1) · **R-1 device matrix executed against staging**.
- **Exit:** scan-to-movement ≤ 3 interactions across the device matrix · every failure state renders its named UI.

### Phase 5 — Dashboard & Reports (≈ 1.5 weeks)

- **Scope:** dashboard aggregate endpoint + per-instance cache + `asOf` (A-2/NFR-11) · dashboard UI with lazy `ChartPanel`, alerts, quick actions (incl. product-select movement) · all five reports · CSV streaming with abort semantics (ERR §7) + Admin export gate · Audit Trail tab UI (expansion) · consistency-report surfacing.
- **Testing:** aggregate correctness against factory data · export abort simulation · a11y state-pass rows for new surfaces.
- **Exit:** dashboard within NFR-02 budget at dev-scale data · export verified truncation-proof.

### Phase 6 — Hardening & Launch (≈ 1.5 weeks)

- **Scope:** NFR-08 load test at reference volume (10k / 500k / 50 concurrent — gates R-2/R-5; query-plan verification) · full axe state-pass + keyboard walkthroughs (NFR-30) · security review vs SEC-016 + staging pen-test · restore drill · production Phase-0 checklist (DEP §12) incl. the domain mandate · production deploy + **non-mutating verification set** · rollback rehearsal.
- **Exit = the §8 release readiness checklist.**

---

## 3. Feature Delivery Matrix

| Feature (SRS §3) | Phase | Depends on (DB · API · FE) | Tests |
|---|---|---|---|
| Auth & sessions | P1 | `users` + `refreshTokens` · `/auth/*` · interceptors, guards | Security suite, hooks |
| User management | P1 | `users` · `/users/*` · Users page + `DataTable` core | T6 race, matrix rows |
| Products & categories | P2 | `products` + `categories` + `counters` · `/products`, `/categories` · catalog pages | Lifecycle races, component states |
| Images | P2 | `products.images` · `/upload/*` · `ImageUploader` | Failure paths; sweep job (P3) |
| Settings | P1 store / **P2 UI** | `settings` · `/settings` · Settings page | Audit-on-change |
| Stock movements & adjustments | P3 | `transactions` · `/inventory/movements` · dialogs | Concurrency, replay, E2E smoke |
| Ledger & audit views | P2 data / P3 + P5 UI | `transactions` + `auditLogs` · `/transactions`, `/audit-logs` · tables | Matrix rows, expansion |
| Scanning | P4 | (reads only) · `/products/lookup` · Scanner | Machine states, device matrix |
| Dashboard | P5 | aggregates · `/dashboard/summary` · `ChartPanel` | Aggregate correctness |
| Reports & export | P5 | ledger-derived · `/reports/*` · Reports page | Abort simulation, role gate |

---

## 4. Milestones

| M | Goal | Completion criteria | Review |
|---|---|---|---|
| M0 | Walking skeleton | P0 exit; pipeline proven end-to-end | Checklist sign-off |
| M1 | Secure shell | P1 exit; both roles live on staging | Security-suite review · **FCM-01 closed** |
| M2 | Catalog complete | P2 exit | Catalog demo + audit-trail walkthrough |
| M3 | **The ledger** | P3 exit; invariant proven under concurrency | **Architecture review of the change-controlled core** |
| M4 | Operations-ready UX | P4 + P5 exit; device matrix passed | Full-flow demo on a phone |
| M5 | **Production launch** | P6 exit; §8 checklist green | Operator go/no-go (AS-19) |

---

## 5. Quality Gates

Standing gates (§1) **plus per transition:**

| Transition | Gate |
|---|---|
| P0 → P1 | Both environment checklists signed |
| P1 → P2 | AAD §11 green · matrix generated-not-hand-written verified |
| P2 → P3 | Lifecycle races green · catalog query plans spot-checked |
| **P3 → P4/P5** | **Hard gate: invariant suite green + smoke complete — nothing builds on an unproven ledger** |
| P4/P5 → P6 | A11y state-pass · device matrix filed |
| P6 → launch | Full §8 checklist |

---

## 6. Risk Matrix

| Risk | Phase exposed | Mitigation / gate |
|---|---|---|
| R-1 scanner variance | **P0 spike**, P4 matrix | Manual-entry fallback is a full workflow; state machine contains variance |
| R-2 hot-product contention | P3 first data, **P6 gate** | Minimal T1 indexes; NFR-08 load test |
| R-4 proxy headers | **P0 checklist** | Echo verification per environment |
| R-5 audit plans at volume | P6 | Plan verification in the load test |
| R-6 Atlas Search tier | **P0 check** | Documented fallback (ERD §7) |
| R-7 type-generation ordering | **P0** | Generate from the contract document |
| Schedule (solo dev) | All | Independently shippable increments; P4∥P5 is the only assumed parallelism; effort-vs-calendar note in the header |
| Scope drift | All | Closed catalogs (components, stores, endpoints, error codes) — additions require the review path |

---

## 7. Testing Integration

Unit + component: with every PR from P0 onward — schema/catalog tests exist before implementations pass them (shift-left) · integration matrix: grows per endpoint as each lands, **never backfilled** · E2E: skeleton + login/reset flows in P1, smoke completed in P3, remaining critical flows with their features (scan P4, reassign-delete P2/P3, export P5) · regression: the whole stack on every merge · performance + full a11y: P6 gates with earlier spot checks.

---

## 8. Release Readiness Checklist (M5 go/no-go)

1. DEP §12 production Phase-0 checklist signed — incl. the §2 domain mandate + refresh verification
2. Pipeline green through all staging gates
3. NFR-08 load-test report within budgets; zero COLLSCAN on mapped queries
4. Axe state-pass + keyboard walkthroughs green
5. Security review vs SEC-016 complete; pen-test findings dispositioned
6. Restore drill executed this quarter
7. Zero S1/S2 defects open (TST §9)
8. Rollback artifact identified + rehearsal performed
9. Production verification set (non-mutating) green post-deploy
10. Operator sign-off (AS-19)

---

## 9. Project Management (process — scope-neutral)

- **Task breakdown:** phase → feature-matrix row → binding-table rows (BEA §5) / component contracts (UCA). A task = "implement + test one bound endpoint or component," rarely > 1 day.
- **Tracking:** milestone board per phase; the traceability CI script (TST §8) doubles as a progress metric — IDs covered / IDs total.
- **Branching:** trunk-based; short-lived branches → PR → squash to `main`; `main` always deployable to staging (DEP §11 assumes it).
- **Review:** every PR; MovementService/T1 diffs additionally require the architecture-review label (P3 change control).
- **Documentation:** ADRs due at P1 (session model), P2 (Archive lifecycle), P3 (ledger invariant) per NFR-29; spec changes follow each source-of-truth document's evolution rule — never code-first.

---

## 10. Review Findings Incorporated

| # | Finding (severity) | Resolution |
|---|---|---|
| 1 | Users page (P1) depended on `DataTable`, scheduled in P2 — P1 would stall or ship a throwaway table (**Major** — the one true sequencing defect) | `DataTable` core + `SearchInput` + `Pagination` pulled into P1 with Users as first consumer; expansion stays with its first consumer (P3/P5). Net estimate unchanged |
| 2 | Settings page in the feature matrix but absent from phase scope text (Minor) | Explicitly scoped into P2; P3 needs only the seeded values via `settingsStore` (P1) |
| 3 | (a) Scaffold-reconciliation task deferred-then-unowned; (b) reset E2E flow left until P5 despite being a P1 feature (Minor) | (a) Named P0 task; (b) reset + forced-change E2E lands in P1 with its feature |
| + | Effort-vs-calendar honesty (improvement) | Header note: ≈ 10.5 dev-weeks effort ≈ **13–14 elapsed weeks** solo |

---

*End of document — RDM-IMS-019 v1.0 · Approved — Ready for Production · 2026-07-23*