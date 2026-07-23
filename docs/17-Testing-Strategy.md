# Testing Strategy

## Web-Based Inventory Management System

| | |
|---|---|
| **Document ID** | TST-IMS-017 |
| **Version** | 1.0 (Approved) |
| **Date** | 2026-07-23 |
| **Status** | **APPROVED — READY FOR PRODUCTION** (QA review rating 9/10) |
| **Source of truth** | All sixteen approved artifacts — load-bearing for testing: SRS NFR-26/08/30 · AAD-IMS-009 §11 · VAL-IMS-014 §5 + Appendix A · ERR-IMS-015 §11 · BEA-IMS-006 §9 · FEA-IMS-007 §11 · SRS AUD-04 |
| **Review record** | Principal QA Architect audit — Issues 1–3 + FCM-01 tripwire incorporated (§10) |
| **Role** | The single source of truth for testing throughout development |

---

## Table of Contents

1. [Testing Philosophy](#1-testing-philosophy)
2. [Test Pyramid & Levels](#2-test-pyramid--levels)
3. [Frontend, Backend & API Specifics](#3-frontend-backend--api-specifics)
4. [Scheduled Jobs Testing](#4-scheduled-jobs-testing)
5. [Test Data Management](#5-test-data-management)
6. [Automation & CI](#6-automation--ci)
7. [Coverage Goals](#7-coverage-goals)
8. [Traceability](#8-traceability)
9. [Defect Management](#9-defect-management)
10. [Review Findings Incorporated](#10-review-findings-incorporated)
11. [Environments & Implementation Guidelines](#11-environments--implementation-guidelines)

---

## 1. Testing Philosophy

| Principle | Meaning |
|---|---|
| **Tests are generated from specs, not invented** | The binding tables ARE the test inventories: VAL §5 failure columns → API error tests · VAL Appendix A → boundary tests · SRS §16.3 catalog → envelope tests · SRS §5 matrix → authorization tests · WIR states → component tests. Coverage is mechanical |
| **The invariant is the north star** | `quantity == Σ ledger` (BR-17) asserted at four altitudes: unit property tests · integration atomicity · the E2E smoke's final ledger-sum check · production reconciliation (BR-18) |
| **Risk-based depth** | MovementService (change-controlled), auth, and the scanner get adversarial/concurrency depth; CRUD gets matrix coverage; cosmetics get smoke |
| **Shift-left** | Schemas, the error catalog, and the permission matrix exist before code — their tests are written against the spec and fail until implementation satisfies them |
| **Definition of Done (per PR)** | New BR → traceable test (NFR-26) · every declared error path reachable · lint/type/tests green · no coverage regression on business-rule code |
| **Ownership** | Developers own all automated tiers; the named operator (AS-19) owns release smoke sign-off and the manual device pass |
| **Mock boundary** | Mock only trust boundaries you don't own (Cloudinary, camera). **Never mock your own services to test your own services. MongoDB is never mocked** — in-memory replica-set instances always |

### Test Pyramid

```text
                    ▲  Manual: exploratory + R-1 device matrix (scanner)
                   ─┼─ E2E (Playwright): 1 smoke suite + 4 critical flows
                  ──┼── Integration: API matrix (every endpoint × auth ×
                 ───┼───  validation × error) + jobs, on ephemeral
                ────┼───   replica-set Mongo
               ─────┼──── Component/hook (Testing Library): domain contracts,
              ──────┼─────  machine states, interceptors, stores
             ───────┼────── Unit: services (every BR), primitives, selectors,
                    │        serializers, error classes
```

---

## 2. Test Pyramid & Levels

| Level | Scope | Gate |
|---|---|---|
| **Unit (backend)** | Services (all BR-01…41 traceable — NFR-26) · validation primitives (Appendix A vectors) · `AppError` serialization · serializers · SKU generation | ≥ 80% coverage of business-rule code; every BR ↔ ≥ 1 test; merge-blocking |
| **Unit (frontend)** | Stores (transitions, queue policies, `endSession`) · `usePermission` (full matrix, table-driven) · formatters incl. null-currency fallback · `useIdempotencyKey` · `errorMap` table | Merge-blocking |
| **Component** | Domain components vs UCA contracts: scanner machine transitions · movement dialog states (Step 0, warning, `INSUFFICIENT_STOCK`) · `ImageUploader` failure paths · role-conditional rendering · `DataTable` (sort/expansion/mobileCard) · boundaries incl. reset-on-navigation · focus trap/return | Merge-blocking |
| **Integration / API** | Every `05` §7 endpoint × {auth, role gate, VAL §5 validation failures, declared error codes, success shape} on **in-memory MongoDB in replica-set mode** (T1–T6 real) · + the security suite and jobs group below | Generated matrix complete; merge-blocking |
| **Database** | Unique/sparse/TTL/collation index behavior · JSON-schema validator rejections · transaction boundaries (injected failure → no partial state) · seed idempotency · archive/hard-delete predicates · PDV-04 blank-vs-absent | Part of integration tier |
| **E2E (Playwright)** | **Smoke:** login → add product → stock in → stock out → **ledger-sum check**. Critical flows: **scan-driven movement via manual code entry** (review Issue 1 — real path, zero mocks) · password reset + forced change · category delete with reassignment · report generate + Admin CSV export | Release gate (staging) |
| **Security** | The AAD §11 suite: Staff-adjustment 403 · flagged-session probing · login timing delta · tampered-`alg` JWTs · lockout sequence · rotation reuse → family revocation · revocation matrix — plus ERR scrub test, VITE grep, idempotency replay/conflict, **limiter 429 + `Retry-After` under injected clock** | Merge-blocking (integration tier) |
| **Accessibility** | Automated axe pass **per page state** (review Issue 3): each page load + each shared dialog open + scanner `permission-denied`/`not-found` states + a form with visible errors + an expanded audit row (WCAG 2.1 AA, NFR-30) · keyboard-only walkthrough of the 5 E2E flows | Release gate |
| **Performance** | NFR-08 load test at reference volume (10k products / 500k transactions, 50 concurrent): p95 budgets (NFR-01/02) · hot-product movement contention (R-2) · query-plan verification — no COLLSCAN per DBD §3 · LCP < 2.5 s on the login path. Tooling: open implementation choice (k6/artillery-class), recorded in the Phase 6 plan | Phase 6 gate |
| **Regression** | The entire automated stack; every fixed defect adds a pinning test before close | CI on every merge |
| **Smoke / Sanity** | The E2E smoke on every deploy (staging + post-production) | Deploy gate (NFR-15) |

---

## 3. Frontend, Backend & API Specifics

**Frontend (beyond §2):** route guards — guard-outside-lazy asserted by **zero `admin`-chunk requests in a Staff session** (SMP §6) · URL-state round-trips (filters/tabs/range survive refresh) · responsive assertions at 360/768/1280 (`DataTable` collapse, dialog full-screen) · `useUnsavedChanges` · toast/confirm queue policies (SMA §4).

**Backend:** middleware-order snapshot vs SEC-016 §2 · movements-route validate-before-authorize exception · per-request revocation (deactivate mid-session → next call 401) · the translation table (E11000 → duplicates · transient exhaustion → 503 · **duplicate idempotency key → replay, not error**) · streaming abort behavior (ERR §7) · graceful-shutdown drain.

**API contract:** OpenAPI drift check in CI (NFR-27) · serialization contract assertions (money strings, ISO dates, envelope shapes) on every integration response.

---

## 4. Scheduled Jobs Testing (review Issue 2 — integration tier)

| Job concern | Tests |
|---|---|
| **Lease guard (A-8)** | Two simulated instances → exactly one executes · expired-lease takeover · lease released on completion |
| **Reconciliation (BR-18)** | Seeded drift → detected and reported · clean state → passes · ARB-05 re-check suppresses in-flight false positives (concurrent movement during the run) |
| **Orphan sweep (BEV-04)** | Mocked Cloudinary folder listing × factory products: unreferenced-and-old → destroyed · referenced or < 24 h → preserved |

Rationale: reconciliation is the production monitor for the core invariant, and the sweep deletes assets — neither may ship unverified.

---

## 5. Test Data Management

- **Factories** per entity with valid defaults + overrides (`makeProduct({quantity: 0})`); invalid variants generated from Appendix A vectors.
- **Seed parity:** tests reuse the production seed module (Admin, settings, Uncategorized); seed idempotency is itself a test (DBD §8).
- **Isolation:** fresh ephemeral DB per integration suite · truncation between tests · no shared mutable fixtures · stores reset via `setState` in `beforeEach` (SMA §10).
- **Mocks:** Cloudinary SDK and camera/ZXing only; scanner component tests drive `onDecoded` directly.
- **Time:** injected clock for lockout/TTL/reset-expiry/limiter tests — no sleeps.

---

## 6. Automation & CI (extends the approved SRS §18.3 pipeline)

```text
PR:      lint → typecheck → unit (FE+BE) → component → integration/API
         (incl. security + DB + jobs tiers) → OpenAPI drift → CVE scan → build
                                       all merge-blocking (NFR-26)
merge:   deploy staging → E2E smoke + critical flows → axe state-pass → manual gate
release: rolling prod deploy (health-gated) → post-deploy smoke
phase 6: load test (NFR-08) + full a11y + restore-drill verification
Manual scope: R-1 scanner device matrix (real phones) + exploratory passes —
              everything else is automated.
```

Execution order is fixed; a red tier stops the pipeline. **Flaky tests are defects with owners — no skip culture.**

---

## 7. Coverage Goals (meaningful, per NFR-26)

| Area | Goal |
|---|---|
| Business-rule code (services) | ≥ 80% line **and** every BR traceable to ≥ 1 named test |
| API surface | 100% of endpoints in the generated matrix; 100% of declared error codes reachable |
| Domain components | Every UCA-specified state/variant rendered in a test |
| Critical workflows | The 5 E2E flows green on every release |
| UI primitives / chrome | Smoke-level only — deliberately thin (low risk, high churn) |

---

## 8. Traceability (fulfills AUD-04)

**Generated, not maintained:** test names embed source IDs — `BR-17__ledger_invariant__concurrent_T1`, `VAL-A__sku_normalization`, `AAD11-4__tampered_alg` — and a CI script asserts every BR/SEC/EC/§16.3-code ID appears in ≥ 1 test name. The SRS Appendix A matrix becomes an executable check. Spot rows:

| Requirement | Verifying tests |
|---|---|
| BR-17/19 (invariant, atomicity) | Unit property tests · integration injected-failure · E2E ledger check |
| BR-20/ARB-02 (idempotency) | Replay-same · conflict-different · duplicate-key-as-replay |
| BR-30 (last admin) | Concurrent demotion race |
| AAD §11 (security) | §2 security row |
| NFR-01/02/08 (performance) | Load-test assertions + plan verification |
| WIR states | Component tier, per named state |
| **FCM-01 (tripwire)** | Pending test `FCM-01__staff_currency_display` — fails-when-enabled until the session payload carries display constants; keeps the series' one open decision visible in CI |

---

## 9. Defect Management

- **Severity:** **S1** data integrity / security (ledger drift, auth bypass) → stop-ship; fix + pinning test before any release · **S2** workflow-blocking → next release · **S3** degraded UX → scheduled · **S4** cosmetic → backlog.
- **Priority:** set independently by the operator (AS-19).
- **Workflow:** report with correlation ID + repro → **pinning test written first** → fix → regression suite green → close.
- **Release readiness:** zero S1/S2 open · smoke + a11y gates green · no coverage regression.

---

## 10. Review Findings Incorporated

| # | Finding (severity) | Resolution |
|---|---|---|
| 1 | E2E scan flow relied on a fragile `getUserMedia`/ZXing mock that tests the stub, not the flow (Minor) | E2E drives **manual code entry** — the real approved path (FR-SCAN-01); camera decode covered by component tier + R-1 device matrix (§2) |
| 2 | Scheduled jobs were an untested subsystem — the invariant monitor and an asset-deleter unverified (**Major**) | Jobs test group in the integration tier (§4) + limiter 429 test (§2 security row) |
| 3 | Axe pass covered page loads, not the interactive states where a11y regressions occur (Minor) | Per-**page-state** axe pass enumerated from WIR frames (§2) |
| + | FCM-01 tracking (improvement) | CI tripwire test (§8) |

---

## 11. Environments & Implementation Guidelines

- **Environments:** unit/component — no services · integration — ephemeral replica-set Mongo per suite · E2E — staging (config-identical, NFR-28; seeded per-role accounts; also the pen-test target, SEC-016 §13) · load — staging at reference volume.
- **Folders (FST-008):** `server/tests/{unit,integration,e2e}` · `client/tests/{components,hooks,e2e}` · shared helpers per side: factories, ephemeral-DB harness, auth helper issuing role-scoped sessions, injected clock.
- **Naming:** `<sourceId>__<behavior>` (traceability-bearing) · one behavior per test · arrange-act-assert.
- **Open implementation choice:** load-test tooling (k6/artillery-class) — recorded in the Phase 6 plan when chosen; NFR-08 assertions are tool-agnostic.

---

*End of document — TST-IMS-017 v1.0 · Approved — Ready for Production · 2026-07-23*