# Phase 5 (Dashboard & Reports) — Completion Checklist

| | |
|---|---|
| **Phase** | Phase 5 — Dashboard & Reports · completes **M4 — Operations-Ready UX** (with Phase 4) |
| **Features** | **F9** Dashboard · **F10** Reports & Export · **F7** Audit Trail tab (P5 slice) |
| **Source** | `docs/phases/phase-5-dashboard-reports.md` · IMP-020 §2-F9/F10/F7 · 05 §7.6/7.7/7.8 · VAL §5 · ERR §7 · BR-40/BR-25/BR-18 |
| **Branch** | `feat/f9-dashboard-reports` (off `main` at the Phase-3 merge `2a5bece`) — Phase 5 depends only on Phase 3, independent of the unmerged F8 (PR #28) |
| **Tags (on merge)** | `f9-dashboard` · `f10-reports` · `f7-audit-tab` · `m4-operations-ready` — pending PR/merge |
| **Operator** | Ali Raza (AS-19) |
| **Status** | ⬜ **CODE-COMPLETE — the one staging-dependent DoD item (M4 full-flow phone demo) is pending the 0.12 deploy** |
| **Test totals** | **346 server** (215 unit + 129 integration + 2 e2e) · **168 client** (104 unit + 64 component) — all green; server + client typecheck + eslint + prettier clean; client build splits the Recharts chunk (401 kB) out of the login path |

---

## Per-feature completion checklist (IMP §4)

### F9 — Dashboard

| □ | Item | Status | Evidence |
|---|---|---|---|
| T-a | `range ∈ {7,30,90}` query schema (VAL §5) | ✅ | `validation/schemas/dashboard.ts` — coerce→enum, default 30 |
| T-c | `DashboardService` — one aggregate; per-instance TTL cache (A-2); `asOf` (BR-25); archived excluded from totals | ✅ | `DashboardService.ts` (products totals aggregation, low/out previews, 10 recent rows, gap-filled per-UTC-day charts, injected clock) |
| T-d | `GET /dashboard/summary` binding rows | ✅ | `dashboard-routes.test.ts` — 401, both-roles (dashboard.view), range 7/30/90 + default, 14→400, **aggregate correctness vs factory data**, **cache-staleness bound** (injected clock: frozen asOf within TTL, refreshed past it) |
| T-e | OpenAPI + types | ✅ | `/dashboard/summary` path + `DashboardSummary`/`DashboardAlertItem`/`MovementTrendPoint`/`TransactionVolumePoint`; client types regenerated |
| T-f/g | Dashboard page · `KpiCard` · `StockAlertList` · `RecentTransactions` · lazy `ChartPanel` (Recharts first consumer) · quick actions | ✅ | `dashboard-page.test.tsx` — KPIs, `asOf`, alerts w/ deep-links + `[+]`, recent→ledger, range re-query, `[New movement]`/alert-`[+]` open F6 dialog |
| T-h | `/` route (already registered) · `?range=` URL state | ✅ | placeholder replaced; range in URL (SMP §4) |
| **Acceptance** | renders at dev-scale; every alert deep-links to its pre-filled action (FR-DASH-04) | ✅ | alert rows link to `/products/:id` + open pre-filled Stock In; ChartPanel lazy (NFR-06 chunk verified split) |

### F10 — Reports & Export

| □ | Item | Status | Evidence |
|---|---|---|---|
| T-a | Report query schemas incl. mandatory ≤366d range (VAL §5) | ✅ | `validation/schemas/reports.ts` — inventory (category/status), low-stock, transactions/performance (superRefine: both bounds, ordered, span ≤366), consistency; export `name` closed enum (APD-04) |
| lib | CSV streaming primitive (ERR §7) | ✅ | `lib/csvStream.ts` — first-batch gate → destroy-on-mid-stream-failure; `csv-stream.test.ts` (escaping, happy path, pre-header throw, post-header destroy) |
| T-c | `ReportService` — 5 reports (paginated + full-dataset cursors); ledger-derived (BR-40); current-cost (AS-17) | ✅ | `ReportService.ts` — inventory totals aggregation, low-stock shortage, ledger transactions, performance in/out/net, consistency drift; cursor generators for export |
| T-d | `/reports/*` binding rows | ✅ | `reports-routes.test.ts` — role gates (view both-roles; consistency + export Admin → Staff 403), stockStatus/category filters, **date-span vectors** (missing bound, 367d → 400), **BR-40 byte-reproducibility**, totals rows, **drift rendering**, **CSV export** (text/csv + header + rows), unknown name → 400 |
| T-e | OpenAPI + types | ✅ | six `/reports/*` paths + `InventoryReport`/`LowStockReportRow`/`ProductPerformanceReport`/`ConsistencyRow` schemas; client types regenerated |
| T-f/g/h | Reports page — `?type=` selector · per-report filters (dates pre-filled last 30d) · totals · timezone/current-cost footnote · Admin consistency section · CSV export w/ abort toast | ✅ | `reports-page.test.tsx` — inventory totals + footnote, Admin export + Consistency tab (hidden for Staff), pre-filled mandatory range, **export-abort → retry toast** (ERR §7) |
| **Acceptance** | re-running a past-period report is byte-identical (BR-40); a truncated-but-complete-looking export is impossible | ✅ | byte-repro asserted; first-batch-gate + connection-destroy proven at unit tier |

### F7 — Audit Trail tab (this phase's slice)

| □ | Item | Status | Evidence |
|---|---|---|---|
| T-a | `/audit-logs` query schema (entity/entityId/actor/ordered date range) | ✅ | `validation/schemas/auditLogs.ts` |
| T-c | Read path preserving AuditService's insert-only invariant | ✅ | **separate** `AuditQueryService.ts` (DES-1 — the writer stays insert-only); actor-name resolution |
| T-d | `GET /audit-logs` binding rows | ✅ | `audit-logs-routes.test.ts` — 401, **Staff 403 / Admin 200** (audit.view), entity-diff `changes[]` + actorName, **security events visible + entityType filter**, **DN-4 entityLabel survives hard delete**, actor filter |
| T-e | OpenAPI + types | ✅ | `/audit-logs` path + `AuditLogRow` schema; client types regenerated |
| ui | **DataTable row expansion** (expansion's first consumer) | ✅ | `DataTable.tsx` `renderExpandedRow` prop + accessible toggle (aria-expanded), desktop + mobile |
| T-f/g/h | Transactions page Audit Trail tab (Admin-gated) · entity/date filters · diff expansion · `?tab=` URL | ✅ | `audit-trail-tab.test.tsx` — rows (actor/action/entityLabel/security), **expansion a11y (aria-expanded)** revealing before→after diffs, "No field changes" for security events, entity-type filter matrix, **tab gating** (Admin enabled / Staff disabled) |
| **Acceptance** | any price/role change attributable; audit tab renders diffs, labels, and security events; expansion accessible | ✅ | above |

---

## Definition of Done (completes M4, with Phase 4)

- [x] Dashboard within NFR-02 budget; `asOf` honest under cache — single aggregate; cache-staleness bound proven with an injected clock (BR-25)
- [x] All five reports + export green incl. **abort simulation** — `reports-routes.test.ts` + `csv-stream.test.ts` (first-batch gate + destroy)
- [x] Audit Trail renders diffs, labels, and security events; expansion accessible — `audit-logs-routes.test.ts` + `audit-trail-tab.test.tsx`
- [x] A11y state-pass rows added for all new surfaces — aria-expanded toggles, aria-pressed range group, role=tablist/tab, region labels
- [x] Per-feature checklists (IMP §4) signed for F9/F10/F7-slice (above)
- [ ] **M4 review: full-flow demo on a phone** (with Phase 4) — ⏳ pending the 0.12 domain/deploy blocker (same as P0–P4 staging acceptance); flows proven at component + integration tier

---

## Cross-cutting decisions recorded this phase

- **Dashboard alert lists are a capped preview (5 each); `count` is the true total** — the full low/out lists are the F10 low-stock report; keeps the single aggregate bounded (NFR-10 spirit).
- **`DashboardService` caches the fully-serialized payload** — a cache hit re-serves the frozen wire object *including its `asOf`*, which is exactly the honest-staleness contract (BR-25); serialization runs once per cache miss.
- **Inventory Summary report is active-only** (`isArchived:false`) — matches the dashboard's inventory-value semantics; the report exposes no archived filter (only category + status).
- **Low-Stock report is at-or-below threshold (includes out-of-stock)** — FR-RPT-02 "at or below"; shortage = `max(threshold − quantity, 0)`.
- **Consistency report lists ALL products with a per-row `drift` flag** (not only drifted) — matches WIR §12 "product | ledger sum | quantity | drift {badge}"; snapshot-consistent (ARB-05) without the job's re-check (that is the reconciliation job's alerting concern, F6).
- **CSV export streams via async-generator cursors**; the transactions/performance exports preload the (bounded) product/user label maps once, then stream — no per-row N+1 and no full-array materialization.
- **A separate `AuditQueryService`** owns the `/audit-logs` read — `AuditService` remains insert-only by architectural contract (DES-1, DBD §6.2); the read path never widens the writer's surface.
- **No server `action` filter on `/audit-logs`** — the API contract (05 §7.6, §9.3) defines entity/entity-id/actor/date only and adds no param; the Audit tab exposes entity + date filters (actor is API-ready for a future picker). The WIR §11 "Action" dropdown has no backing param and was intentionally not added out-of-contract.
- **`DataTable.renderExpandedRow` added** — the declared-but-unbuilt expansion surface, delivered here as its first consumer (audit before/after diffs); accessible toggle (aria-expanded) on both desktop rows and mobile cards.
- **Recharts added (3.10.1)** as the lazy `ChartPanel` chunk — the build confirms it splits into its own ~401 kB async bundle, out of the login/initial paint (NFR-06 / R-5 chart-bundle discipline; no login-path regression). `npm audit` flags pre-existing transitive-dep advisories (not introduced by Phase-5 code); left for a dedicated dependency pass, not force-fixed mid-phase.

---

## Remaining before phase exit is fully signed

The single open DoD item — the **M4 full-flow phone demo** — shares the blocker with Phase-0 task 0.12 / P1–P4 staging acceptance: a purchased domain + Render/Vercel deploy. All feature logic is proven at the component + integration tier; the demo runs once staging exists. On merge, cut the tags (`f9-dashboard`, `f10-reports`, `f7-audit-tab`, `m4-operations-ready`) and re-sign.

**Sign-off (code-complete):** _______________ (operator) · date: ________
**Sign-off (M4 phone-demo acceptance):** _______________ (operator) · date: ________
