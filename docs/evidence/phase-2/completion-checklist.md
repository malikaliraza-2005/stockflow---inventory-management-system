# Phase 2 (Catalog) — Completion Checklist

| | |
|---|---|
| **Phase** | Phase 2 — Catalog · Milestone **M2 — Catalog Complete** |
| **Features** | F3 Categories · F4 Products · F5 Product Images · F11 Settings (UI) |
| **Source** | `docs/phases/phase-2-catalog.md` · IMP-020 §2/§4 |
| **PRs** | #19 (2.1 F3 be) · #20 (2.2 F4 be) · #21 (2.3 F11 be) · #22 (2.4 F5 be) · #23 (2.5 F3 ui) · #24 (2.6 F4 ui) · #25 (2.7 F5+F11 ui) — all squash-merged through the 8-gate CI |
| **Tags** | `f3-categories` · `f4-products` · `f5-images` · `f11-settings-ui` · `m2-catalog-complete` |
| **Operator** | Ali Raza (AS-19) |
| **Status** | ⬜ **CODE-COMPLETE — the one open DoD item (staging reconcile + COLLSCAN spot-check) is pending the 0.12 deploy** |
| **Test totals** | **273 server** (unit + integration) · **142 client** (102 unit + 40 component) — all green |

---

## Per-feature completion checklist (IMP §4)

### F3 — Categories

| □ | Item | Status | Evidence |
|---|---|---|---|
| T-a | Validation schemas (VAL §5) + client mirror | ✅ | `validation/schemas/categories.ts` + client mirror |
| T-b | Model / collation index tested | ✅ | `Category` `{name}` unique collation `{en, strength:2}` |
| T-c | Every BR (26–28) → named test | ✅ | `category-service.test.ts` (collation dup → VALIDATION_ERROR APR-08, T5 block+reassign, BR-28 undeletable/unmodifiable) |
| T-d | Binding rows green (5 `/categories`) | ✅ | `categories-routes.test.ts` — role matrix, dup→400, withCounts, DELETE 204/409/reassign |
| T-e | OpenAPI + types | ✅ | `/categories` paths + Category/CategoryWriteRequest; types regenerated |
| T-f/g | Categories page + CategoryFormModal + ReassignDeleteModal | ✅ | `categories-page.test.tsx` |
| T-h | Route (Any-role, writes gated) | ✅ | `/categories` core chunk; `usePermission('categories.manage')` |
| T-i | CATEGORY_IN_USE + duplicate-name states | ✅ | ReassignDeleteModal + inline name echo |
| **Acceptance** | Uncategorized undeletable; reassign-and-delete atomic under race | ✅ | T5 majority transaction; system-category guard (BR-28) |

### F4 — Products

| □ | Item | Status | Evidence |
|---|---|---|---|
| T-a | Schemas (VAL §3.3/§5) + client mirror | ✅ | `validation/schemas/products.ts` + client mirror |
| T-b | Product/Transaction/Counter models + indexes + products/counters validators | ✅ | `models/*`; `jsonValidators.ts` (transactions deferred to F6 per first-consumer) |
| T-c | Every BR (01–10, 21–25) → named test · **recordInitial atomicity** | ✅ | `product-service.test.ts` — `quantity == Σ ledger`, SKU counter, STALE_WRITE, T3/T4, lookup precedence |
| T-d | Binding rows green (8 `/products`) | ✅ | `products-routes.test.ts` — ledger invariant over the wire, lifecycle, lookup 404/422, APD-02 |
| T-e | OpenAPI + types | ✅ | 8 `/products` paths + Product/Row/Lookup schemas |
| T-f/g | Products/Detail/Add/Edit · ProductForm · StockStatusBadge · ProductRowCard · QRLabel | ✅ | `product-form.test.tsx`, `products-page.test.tsx` |
| T-h | Routes (Any list/detail; Admin new/edit, guard-outside-lazy) | ✅ | `router.tsx` |
| T-i | DUPLICATE_SKU/BARCODE · STALE_WRITE states | ✅ | ProductForm inline + reload banner |
| **Acceptance** | Full lifecycle; lookup precedence; **every product's ledger sums to its quantity** | ✅ (staging item below) | recordInitial (T2) — invariant holds from product #1 |

**`recordInitial` = MovementService slice 1 (IMP Issue 1):** ✅ — the T2 path (INITIAL insert + quantity set, one atomic majority transaction) ships inside `MovementService`; **architecture-review label applies from F4 onward**; nothing stubbed. The T1 movement path + jobs remain F6.

### F5 — Product Images

| □ | Item | Status | Evidence |
|---|---|---|---|
| T-a | Upload signature schema (BR-36) + product `images[]` | ✅ | `schemas/uploads.ts`; `images` on product create/update |
| T-b/c | UploadService (folder-scope APR-03) · ProductService image invariants | ✅ | `upload-service.test.ts`, `product-images.test.ts` — host-pin, DBR-03, BR-38 destroy post-commit, FEV-01 failed-save cleanup |
| T-d | `/upload/signature` + `/upload/:publicId` binding rows | ✅ | `upload-routes.test.ts` — signature/role/validation, folder-scope 403 |
| T-e | OpenAPI + types | ✅ | `/upload` paths + UploadSignature schemas; images on product schemas |
| T-f/g | ImageUploader (FEV-01) | ✅ | `image-uploader.test.tsx` — upload→attach-primary, failure Retry/Remove, invalid-type guard |
| **Acceptance** | Failed upload never blocks a save; no unswept orphan path (window accepted until F6) | ✅ | BR-37 failure isolation; sweep is F6/BEV-04 (documented accepted window) |

### F11 — Settings (UI)

| □ | Item | Status | Evidence |
|---|---|---|---|
| T-a | Schema (VAL §3.5) + client mirror | ✅ | `validation/schemas/settings.ts` + client mirror |
| T-b/c | Singleton (BR-41) · audit diff path (entityType SETTINGS) | ✅ | `settings-service.test.ts` — in-place update, no-op guard, audit diff |
| T-d | GET/PUT `/settings` binding rows | ✅ | `settings-routes.test.ts` — both Admin, validation, **DN-3 acceptance** |
| T-e | OpenAPI + types | ✅ | `/settings` + Settings/SettingsUpdateRequest |
| T-f/g/h | Settings page (Admin route) | ✅ | `settings-page.test.tsx` |
| **Acceptance** | Edits audited; existing products unaffected (DN-3) | ✅ | DN-3 proven end-to-end (existing keeps 10, new gets 50) |

---

## Definition of Done (gate to Phase 3)

- [x] All F3/F4/F5/F11 binding rows green in the integration matrix
- [x] Lifecycle race tests green (BR-22/23/27 — archive predicate, hard-delete history guard, T5 reassign/block)
- [ ] **Every product on staging reconciles (`quantity == Σ ledger`)** — ⏳ pending the 0.12 deploy (verified locally + on the ephemeral replica set for every seeded/test product)
- [ ] **Catalog query plans spot-checked COLLSCAN-free on staging** — ⏳ pending 0.12 (indexes defined per DBD §2.3; the D-1 search fallback is regex until Atlas Search is enabled on the tier)
- [x] Per-feature completion checklists (IMP §4) signed for F3/F4/F5/F11 (above)

## Cross-cutting decisions recorded this phase

- **APR-08 — category duplicate name → VALIDATION_ERROR, not 409** (no SRS §16.3 409 for category names, unlike SKU/email). CategoryService owns the mapping.
- **BR-28 hardened** — the system category is undeletable **and** unmodifiable (protects the seed's natural-key idempotency).
- **Doc reconciliation (BR-27 delete)** — 05 §7.4's "`reassignTo` missing → VALIDATION_ERROR" is superseded by BR-27 + §16.3 ("reassign them first"): references-present-without-reassignTo is `409 CATEGORY_IN_USE`.
- **SKU prefix PDV** — auto-SKU prefix = first 4 alphanumeric chars of the category name, uppercased (`Electronics → ELEC`); the `{sku}` unique index is the authority.
- **Search (D-1)** — ships the P0-blessed regex fallback; Atlas `$search` gated behind `ATLAS_SEARCH_ENABLED` (untestable on the in-memory/CI cluster; the staging index is the enhancement).
- **`transactions` validator deferred to F6** — F4 is the first writer (recordInitial) but the native JSON-schema validator lands with F6 per the `jsonValidators.ts` first-consumer ownership; the Mongoose schema covers F4's INITIAL writes. Under the MovementService architecture-review label.
- **`CLOUDINARY_DELIVERY_HOST`** env added (default `res.cloudinary.com`) — the image-URL host pin (VAL Issue 4), matching the CSP `img-src`.
- **F5 has no `/products/:id/images` sub-routes** — images ride the product body; dedicated endpoints are `/upload/signature` + `/upload/:publicId` (§7.9).

## Known intermittent

- The replica-set memory-server suite occasionally reports a single transient failure under parallel load (a concurrency/transaction timing test); it does not reproduce on re-run and passed on every PR's CI. Not a defect — noted for visibility.

## Remaining before phase exit is fully signed

The open DoD items (staging reconcile + COLLSCAN spot-check) share the blocker with Phase-0 task 0.12 and Phase-1 staging acceptance: a purchased domain + Render/Vercel deploy. Once that deploy session runs, on staging: reconcile every product (`quantity == Σ ledger`), spot-check catalog plans COLLSCAN-free (enable Atlas Search per D-1 or record the fallback), and re-sign this checklist.

**Sign-off (code-complete):** _______________ (operator) · date: ________
**Sign-off (staging acceptance):** _______________ (operator) · date: ________
