# Text-Based Wireframes

## Web-Based Inventory Management System

| | |
|---|---|
| **Document ID** | WIR-IMS-011 |
| **Version** | 1.0 (Approved) |
| **Date** | 2026-07-23 |
| **Status** | **APPROVED — READY FOR PRODUCTION** (UX review rating 8.5/10) |
| **Source of truth** | SMP-IMS-010 (sitemap) · FEA-IMS-007 (layouts, components, UX contracts) · SRS §9/§15 — this document conforms to all and never overrides them |
| **Review record** | Principal UX Architect audit — Issues 1–4 + reports-default improvement incorporated (§18) |
| **Scope** | Component placement only — no colors, typography, icons, branding, or animations |

**Legend:** `[Button]` action · `(input)` field · `{data}` dynamic · `▾` select · `⋮` row menu · `⇅` sortable column · `[A]` Admin-only element (hidden via `usePermission`; server-enforced regardless)

---

## 0. Shared Chrome (defined once — inherited by all protected pages)

### 0.1 AppShell — Desktop / Tablet (≥ 768 px)

```text
+------------------------------------------------------------------+
| TopBar:  [☰ (tablet)] App name          {user name} ▾            |
|                                          └ menu: Profile, Logout |
+----------+-------------------------------------------------------+
| Sidebar  |  <Breadcrumbs (product branch only)>                  |
|  Dash-   |                                                       |
|  board   |   ┌───────────────────────────────────────────┐       |
|  Products|   │            MAIN CONTENT (Outlet)          │       |
|  Scanner |   │                                           │       |
|  Categ.  |   └───────────────────────────────────────────┘       |
|  Trans.  |                                                       |
|  Reports |                                                       |
|  ······  |   Admin section [A]:                                  |
|  Users[A]|                                                       |
|  Sett.[A]|                                                       |
+----------+-------------------------------------------------------+
```

### 0.2 AppShell — Mobile (< 768 px)

```text
+----------------------------------+
| [☰]  App name        {user} ▾    |   ☰ opens Drawer: full nav list
+----------------------------------+     (Admin section [A] filtered)
|                                  |
|         MAIN CONTENT             |   Tables → stacked cards or
|         (full width)             |   own-container horiz. scroll
|                                  |   Dialogs → full-screen
+----------------------------------+
| [Scanner]  persistent quick entry|   thumb-zone (NFR-31)
+----------------------------------+
```

### 0.3 Universal states (every page inherits; page-specific variants noted in place)

| State | Rendering |
|---|---|
| Loading | Skeleton matching final layout — no layout shift |
| Error (page) | Route error boundary: message + `[Retry]` + correlation ID |
| Error (action) | Toast with mapped message + correlation ID; form input preserved |
| Success | Toast; dialogs show the result inline before closing |
| Empty | Plain panel: one line of text + role-appropriate CTA |
| Confirmation | Modal naming the target: `Archive "USB-C Cable 1m"?` → `[Cancel] [Confirm]` (destructive button last) |

**Toasts (review Issue 4):** single `aria-live` region — top-right desktop, top mobile; stack ≤ 3; success auto-dismisses with manual dismiss affordance; errors persist until dismissed.

**Accessibility (all pages):** landmark regions (`header/nav/main`); visible focus; dialogs trap focus, close on `Esc`, and **return focus to their trigger element** (Issue 4); form errors via `aria-describedby` + live-region announcement; tables with header scope; status badges carry text, never color alone; full keyboard operability (NFR-30).

---

## 1. Login — `/login` · Public · PublicLayout

```text
              +------------------------------+
              |          App name            |
              |------------------------------|
              |  (email)                     |
              |  (password)          [show]  |
              |                              |
              |  [ Sign in ]                 |
              |                              |
              |  {error line: generic /      |
              |   locked / deactivated}      |
              +------------------------------+
```

States: submitting (button spinner, fields disabled) · `ACCOUNT_LOCKED` shows retry-after wording · bad-credential error is **generic** (AAD §2). Mobile: same card, full width. A11y: autofocus email; error line is a live region; password toggle is a labeled button.

## 2. Reset Password — `/reset-password?token=` · Public · PublicLayout

```text
              +------------------------------+
              |     Set a new password       |
              |------------------------------|
              |  (new password)              |
              |  (confirm password)          |
              |  policy hint line            |
              |  [ Save password ]           |
              +------------------------------+
   Invalid/expired token variant:
              |  Token invalid or expired.   |
              |  Ask an administrator for a  |
              |  new reset link.  [→ Login]  |
```

## 3. Forced Password Change — gate screen (no URL) · Any flagged session

Same card as §2, plus `(current password)` when the user set the password themselves; TopBar shows only `[Logout]`. Renders for **every** route until cleared (FEV-02; server co-enforces per AAD §2).

## 4. Dashboard — `/` (`?range=`) · Any · AppShell

```text
+------------------------------------------------------------------+
| Range: [7d | 30d | 90d]                as of {timestamp}         |
+----------------+----------------+--------------------------------+
| Total products | Inventory value| Units in stock                 |
|    {n}         |   {amount}     |   {n}                          |
+----------------+----------------+--------------------------------+
| Low stock ({n})            | Out of stock ({n})                  |
|  {item} qty/threshold  [+] |  {item}                 [+]         |
|  … (rows link to product; [+] = pre-filled Stock In)             |
+----------------------------+-------------------------------------+
| Movement trend (in vs out) | Transaction volume                  |
|  {chart — lazy skeleton}   |  {chart — lazy skeleton}            |
+----------------------------+-------------------------------------+
| Recent transactions (10)                                         |
|  {time} {type} {product} {±qty} {user}   → rows link to ledger   |
+------------------------------------------------------------------+
| [Scan] [New movement]   quick actions                            |
+------------------------------------------------------------------+
```

`[New movement]` opens the movement dialog in **product-select mode** (§17, Issue 1). Charts hydrate after the shell. Empty (new system): cards show 0; panels show "No activity yet". Mobile: 1-column cards; charts full-width.

## 5. Products — `/products` (URL params per SMP §4) · Any · AppShell

```text
+------------------------------------------------------------------+
| (search name/SKU/barcode… 300 ms)  Category ▾  Status ▾          |
| Archived ▾[A]                          [+ Add product][A]        |
+------------------------------------------------------------------+
| img | Name ⇅ | SKU ⇅ | Category | Qty ⇅ | Status | Prices | ⋮    |
|-----|--------|-------|----------|-------|--------|--------|------|
| {…} | {name} | {sku} | {cat}    | {n}   | {badge}| {c}/{s}| ⋮    |
|  …    (virtualized rows; archived rows badged)                   |
+------------------------------------------------------------------+
| Showing {a}–{b} of {total}      [‹ Prev] {page}/{pages} [Next ›] |
+------------------------------------------------------------------+
 Row ⋮ menu: View · Stock In · Stock Out · [A] Edit · Adjust ·
             Archive/Restore · Delete (zero-transaction rows only)
```

Empty: "No products yet" + `[Add product]`[A] · "No matches" + `[Clear filters]`. Mobile: rows → cards (img, name, SKU, qty + badge, ⋮).

## 6. Product Detail — `/products/:id` · Any (read-only Staff) · AppShell

```text
 Breadcrumb: Products → {name}
+---------------------------+--------------------------------------+
| Image gallery             |  {name}            {status badge}    |
|  {main image/placeholder} |  SKU {sku}   Barcode {code|—}        |
|  [thumb][thumb]…          |  Category {cat}                      |
|                           |  Cost {c}  Selling {s}               |
|                           |  Quantity {n}  Threshold {t}         |
|                           |  Supplier: {name, phone…|—}          |
|                           |  Description {…}                     |
+---------------------------+--------------------------------------+
| Active:  [Stock In] [Stock Out] [Print QR label]                 |
|          [A]: [Edit] [Adjust] [Archive]                          |
| Archived variant (Issue 2b): "Archived" banner ·                 |
|          movement/adjust actions SUPPRESSED ·                    |
|          [Restore][A]  [View →]  [Print QR label]                |
+------------------------------------------------------------------+
| Recent transactions for this product        [View all →]         |
|  {time} {type} {±qty} {user} {reason?}                           |
+------------------------------------------------------------------+
```

Print QR: print-clean label view; everything else `print:hidden`. Mobile: single column, gallery first, sticky action row.

## 7. Add Product — `/products/new` · Admin · AppShell

```text
 Breadcrumb: Products → New
+------------------------------------------------------------------+
| Basics:   (name)            (SKU — blank = auto-generate)        |
|           (barcode {pre-filled from scanner route state})        |
|           Category ▾        (description, multiline)             |
| Pricing:  (cost price)      (selling price)                      |
| Stock:    (initial quantity)(low-stock threshold {default})      |
| Supplier: (name) (contact) (phone) (email)     — all optional    |
| Images:   [ + Upload ]  ≤ 5 · ≤ 5 MB · JPEG/PNG/WebP             |
|   [thumb ×][thumb ×][primary ◉]  {per-file progress bar}         |
|   failed tile: [Retry] [Remove]                                  |
|                                                                  |
| [Cancel]                                    [ Save product ]     |
+------------------------------------------------------------------+
```

Field errors inline; `DUPLICATE_SKU/BARCODE` names the conflicting product. Image failure never blocks save (BR-37). Unsaved-changes confirmation on navigate-away.

## 8. Edit Product — `/products/:id/edit` · Admin · AppShell

Same form as §7 minus initial quantity; SKU read-only; hidden `version` token. `STALE_WRITE` state: banner "Changed by someone else — `[Reload]` and reapply" (input preserved). Quantity absent by design — "Adjust stock" link opens the Adjustment dialog.

## 9. Scanner — `/scanner` · Any · AppShell (full-height)

```text
+------------------------------------------------------------------+
|            CAMERA VIEWPORT (state machine, FEA §6.1)             |
|   scanning: live preview + guide frame  [torch (if supported)]   |
|   permission-denied / no-camera / insecure-context:              |
|     guidance text + steps — viewport replaced, page still usable |
+------------------------------------------------------------------+
| Manual entry — ALWAYS visible:  (code…)          [Look up]       |
+------------------------------------------------------------------+
| Result card:                                                     |
|  found:    {img} {name}  qty {n} {badge}                         |
|            [Stock In] [Stock Out]  [Adjust][A]  [View →]         |
|            post-movement (Issue 2a): quantity updates with a     |
|            success flash; card stays ready for the next scan     |
|  not-found: "No product for {code}"                              |
|            [A]: [Create product with this code]                  |
|            Staff: "Notify an administrator"                      |
|  archived: "{name} is archived"   [Restore][A]  [View →]         |
+------------------------------------------------------------------+
```

Duplicate decodes < 2 s coalesce (no card flicker). Mobile-first: viewport ~60% height; actions in thumb zone.

## 10. Categories — `/categories` · Any (writes Admin) · AppShell

```text
+------------------------------------------------------------------+
| Categories                                  [+ Add category][A]  |
+------------------------------------------------------------------+
| Name ⇅        | Description        | Products | ⋮ [A]            |
| {name}        | {desc}             |  {n}     | Edit · Delete    |
| Uncategorized | System category    |  {n}     |  (undeletable)   |
+------------------------------------------------------------------+
| standard pagination row (Issue 3)                                |
+------------------------------------------------------------------+
 Add/Edit modal: (name) (description)  [Cancel] [Save]
 Delete flow (products > 0): "{n} products use {name}. Reassign
   to: Category ▾ (default Uncategorized)"
   [Cancel] [Reassign & delete]
```

## 11. Transactions — `/transactions?tab=` · Any (audit tab Admin) · AppShell

```text
+------------------------------------------------------------------+
| [ Stock Ledger ] [ Audit Trail ][A]      ← tabs (URL param)      |
+------------------------------------------------------------------+
 Ledger tab:
| (from)(to)  Type ▾  Product ▾  User ▾  ☐ include archived        |
|------------------------------------------------------------------|
| Time ⇅ | Product {badge if archived} | Type | ±Qty | After |     |
|        |                             |      |      |       User | Reason/note |
|------------------------------------------------------------------|
| standard pagination row                                          |
 Audit tab [A]:
| Entity ▾  Action ▾  Actor ▾  (from)(to)                          |
| Time | Actor | Action | Entity {label} | Changes {field: a → b}  |
|      |       |        |                |  expandable diff rows   |
| standard pagination row                                          |
```

## 12. Reports — `/reports?type=` · Any (export + consistency Admin) · AppShell

```text
+------------------------------------------------------------------+
| Report: [Inventory][Low stock][Transactions][Performance]        |
|         [Consistency][A]                  ← selector (URL param) |
+------------------------------------------------------------------+
| Filter panel (per report):                                       |
|  Transactions/Performance: (from)(to) — pre-filled last 30 days, |
|    required, ≤ 366 d (review improvement)                        |
|  Inventory: Category ▾  Status ▾                                 |
|                              [Generate]    [Export CSV][A]       |
+------------------------------------------------------------------+
| Result table (paginated) + totals row where defined              |
| footnote: timezone + "values use current cost"                   |
| Consistency[A]: product | ledger sum | quantity | drift {badge}  |
+------------------------------------------------------------------+
```

## 13. Users — `/users` · Admin · AppShell

```text
+------------------------------------------------------------------+
| (search name/email)                          [+ Add user]        |
+------------------------------------------------------------------+
| Name ⇅ | Email | Role | Status | Last login | ⋮                  |
| {name} | {…}   |{role}| {badge}| {time}     | Edit · Reset pw ·  |
|        |       |      |        |            | Deactivate/React.  |
+------------------------------------------------------------------+
| standard pagination row (Issue 3)                                |
+------------------------------------------------------------------+
 Add/Edit modal: (name)(email)(temp password) Role ▾ [Cancel][Save]
 Reset-password result modal: "Deliver this link to {name}:"
   {reset URL}  [Copy]          (out-of-band delivery, AS-6)
 LAST_ADMIN block: inline modal note "At least one active Admin
   is required" — action disabled
 Self-deactivation confirm: explicit "you will be signed out"
```

## 14. Settings — `/settings` · Admin · AppShell

```text
+------------------------------------------------------------------+
| System settings                                                  |
|  Currency ▾ (ISO 4217)                                           |
|  (default low-stock threshold)                                   |
|  (movement warning threshold)                                    |
|                                             [ Save changes ]     |
|  note: changes are audited                                       |
+------------------------------------------------------------------+
```

## 15. Profile — `/profile` · Any · AppShell

```text
+------------------------------------------------------------------+
| My profile                                                       |
|  (name)                      [Save name]                         |
|  Email {read-only}    Role {read-only}                           |
|------------------------------------------------------------------|
| Change password                                                  |
|  (current)(new)(confirm)  policy hint    [Change password]       |
|  note: other sessions will be signed out                         |
+------------------------------------------------------------------+
```

## 16. Not Found — `*` · Any · AppShell (ratified, SMP §9)

```text
|            Page not found                                        |
|            The address {path} doesn't exist.                     |
|            [ Go to Dashboard ]                                   |
```

---

## 17. Shared Dialogs (modals — never routes, FEA §6)

### 17.1 Stock Movement (In/Out) — from Products ⋮, Detail, Scanner card, Dashboard quick action

```text
 Step 0 — product-select mode (Issue 1: only when opened with NO
 product context, i.e., the Dashboard quick action):
+---------------------------------+
| New movement                    |
| (search product by name/SKU…)   |
|  {result} {result} {result}     |   ← debounced list; select →
+---------------------------------+     transitions to the frame below;
                                        entry WITH context skips this step
 Movement frame:
+---------------------------------+
| Stock {In|Out} — {product name} |
| Current quantity: {n}           |
| (quantity)   (note, optional)   |
| warning state: "Large movement  |
|  of {n} units — confirm" ☐      |
| error state: "Only {available}  |
|  available" (from server)       |
| [Cancel]            [Confirm]   |
+---------------------------------+
```

### 17.2 Adjustment [A]

Mode toggle `(± delta)` ⇄ `(counted quantity)` · Reason ▾ (`DAMAGED, LOST, FOUND, COUNT_CORRECTION, RETURN, OTHER` — note required for OTHER) · same warning/error states as 17.1.

### 17.3 Confirmations

Archive / restore / hard delete / deactivate / reassign-and-delete — target always named; destructive button last (NFR-32).

**Retry semantics (all mutation dialogs):** input preserved on network failure; retry reuses the **same idempotency key**; key regenerates only after confirmed success or explicit cancel (FEA §6.2).

---

## 18. Review Findings Incorporated

| # | Finding (severity) | Resolution |
|---|---|---|
| 1 | Dashboard `[New movement]` opened a dialog that assumed a product — dead-end workflow (**Major**) | Product-select step added to the movement dialog for context-free entry (§17.1 Step 0) |
| 2 | Scanner card post-movement state and archived-detail action suppression unspecified (Minor) | Card updates + success flash, ready for next scan (§9); archived variant suppresses movement/adjust actions (§6) |
| 3 | Pagination rows missing on Categories and Users tables (Minor) | Standard pagination row added to both (§10, §13) — FR-SRCH-01 consistency |
| 4 | Dialog focus-return and toast mechanics unstated (Minor) | Focus returns to trigger; toast region/stacking/dismissal specified (§0.3) |
| + | Reports mandatory date range started invalid (improvement) | Pre-filled last-30-days default (§12) |

**Coverage:** 14 sitemap pages + gate screen + 404 + shared dialogs · every SRS §8 flow traceable · all state categories defined globally with per-page variants · responsive behavior per NFR-36/31 on every page · role gating drawn at element level matching the §5 matrix.

---

*End of document — WIR-IMS-011 v1.0 · Approved — Ready for Production · 2026-07-23*