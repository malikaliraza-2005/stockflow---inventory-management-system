# Zustand State Management Architecture

## Web-Based Inventory Management System — React / TypeScript / Zustand

| | |
|---|---|
| **Document ID** | SMA-IMS-013 |
| **Version** | 1.0 (Approved) |
| **Date** | 2026-07-23 |
| **Status** | **APPROVED — READY FOR PRODUCTION** (state review rating 9/10) |
| **Source of truth** | FEA-IMS-007 (three-store decision, FD-1…5, NFR-25, A-7) · `05-REST-API-Specification.md` · UCA-IMS-012 §7 · SMP-IMS-010 §4 · AAD-IMS-009 — this document conforms to all and never overrides them |
| **Review record** | Principal Frontend Architect audit — Issues 1–2 + formatter-fallback improvement incorporated (§12) |
| **Governing rule** | **Exactly three stores.** A fourth store follows the same review path as a new feature |

---

## Table of Contents

1. [Governing Decisions](#1-governing-decisions)
2. [State Classification](#2-state-classification)
3. [authStore](#3-authstore)
4. [uiStore](#4-uistore)
5. [settingsStore](#5-settingsstore)
6. [Server-State Integration](#6-server-state-integration)
7. [Session Lifecycle Orchestration](#7-session-lifecycle-orchestration)
8. [Persistence & Security Boundaries](#8-persistence--security-boundaries)
9. [Selectors & Performance](#9-selectors--performance)
10. [Error Handling & Testing](#10-error-handling--testing)
11. [Implementation Guidelines](#11-implementation-guidelines)
12. [Review Findings & Exclusions](#12-review-findings--exclusions)

---

## 1. Governing Decisions

```text
┌──────────────────────────────────────────────────────────────────┐
│  Zustand holds ONLY cross-cutting client state: 3 stores.        │
│  Server data is never copied into Zustand.        (NFR-25, FD-1) │
│  View state that must survive refresh lives in the URL. (SMP §4) │
│  Workflow state lives in the component that owns the workflow.   │
└──────────────────────────────────────────────────────────────────┘
```

## 2. State Classification

| Category | Placement | Rationale |
|---|---|---|
| Authentication / user / session | **`authStore`** | Cross-cutting: guards, interceptors, permissions |
| Global UI (toasts, confirms, sidebar, drawer) | **`uiStore`** | Cross-cutting presentation coordination |
| Settings (currency, thresholds) | **`settingsStore`** | Read-mostly display constants feeding formatters |
| Product / inventory / transaction / category / dashboard data | **Server state** — page-scoped `useQueryState` | FD-1: fetched per page, refetched after mutations; never mirrored globally |
| Filters / search / sort / pagination / tabs / chart range | **URL search params** | SMP §4: shareable, refresh-safe, back-button-correct |
| Scanner (camera status, machine state, result, cooldown) | **Local** — `ScannerViewport` / Scanner page | Single-owner workflow (UCA §5.1); dies with the page by design |
| Dialog visibility, form drafts, upload progress, steps | **Local component state** | Single-owner, ephemeral (UCA §7) |
| Temporary UI (hover, focus, table expansion) | Local / page-owned URL state | Audit expansion keys page-owned per UCA `DataTable` |

## 3. `authStore`

| Aspect | Specification |
|---|---|
| Purpose | Session identity for guards, interceptors, and permission checks |
| State | `accessToken: string \| null` (**memory only — A-7/SEC-01, never persisted**) · `user: {id, name, email, role, mustChangePassword} \| null` · `status: 'initializing' \| 'authenticated' \| 'unauthenticated'` |
| Actions | `setSession(token, user)` (login/refresh success) · `updateUser(patch)` (profile edit, forced-change cleared) · `clearSession(reason?)` |
| Async | **None.** All API calls live in the api layer; the store is written *by* it, never calls it — single-flight refresh (ARB-03) has exactly one home |
| Selectors | `selectIsAuthenticated` · `selectRole` · `selectUser` · `selectMustChangePassword` · **`usePermission(capability)`** — role against the generated §5 matrix (FD-3), memoized per capability |
| Persistence | **None.** Cross-refresh continuity = `httpOnly` refresh cookie: bootstrap calls `/auth/refresh` → `setSession`; `status: 'initializing'` gates first paint (app-level skeleton — no login flash) |
| Reset | `clearSession` — called only via `endSession` (§7) |
| Consumers | `RequireAuth` / `RequireRole` / `ForcePasswordChange`, Axios request interceptor, `UserMenu`, `Sidebar` (admin section), all `usePermission` sites |

## 4. `uiStore`

| Aspect | Specification |
|---|---|
| Purpose | Global presentation coordination — the only store components write freely |
| State | `toasts: Toast[]` (`{id, tone, message, correlationId?}`) · `toastQueue` (overflow) · `confirm: ConfirmRequest \| null` · `confirmQueue` · `sidebarCollapsed: boolean` · `drawerOpen: boolean` |
| Actions | `pushToast` / `dismissToast` (facade `useToast`) · `requestConfirm(config): Promise<boolean>` / `resolveConfirm(result)` (facade `useConfirm`) · `toggleSidebar` · `setDrawerOpen` |
| **Edge policies (review Issue 1)** | **Confirm collisions queue FIFO** — a second `requestConfirm` awaits the first's resolution; never dropped, never nested. **Toast overflow queues** — visible stack ≤ 3, queued toasts surface as slots free; error toasts keep persist-until-dismissed while queued |
| Selectors | Slice-per-concern (`selectToasts`, `selectConfirm`, `selectSidebarCollapsed`) — `ToastRegion` never re-renders on sidebar changes |
| Persistence | `sidebarCollapsed` → `localStorage` (cosmetic; the only persisted byte in the app). Nothing else persists |
| Reset | On `endSession`: toasts cleared, pending confirms resolved-as-cancel, drawer closed; `sidebarCollapsed` survives (preference, not session data) |
| Consumers | `ToastRegion`, `ConfirmDialogHost`, `AppShell`, `TopBar`, `MobileDrawer` |

## 5. `settingsStore`

| Aspect | Specification |
|---|---|
| Purpose | System display constants for formatters and movement UX |
| State | `currency: string \| null` · `defaultLowStockThreshold: number \| null` · `movementWarningThreshold: number \| null` · `loaded: boolean` |
| Actions | `setSettings(payload)` · `clear()` |
| Hydration | **FCM-01 ratified (2026-07-23):** populated from the login/refresh session payload's `settings` block (both roles, zero extra requests — 05 §7.1). The formatter fallback below remains as a defensive path for the pre-hydration window only |
| **Formatter fallback (review improvement)** | `selectCurrency` returning `null` renders amounts **without a currency symbol** plus a one-time console warning — Staff sessions degrade visibly-but-gracefully, never throw in `lib/formatters` |
| Selectors | `selectCurrency` (→ `lib/formatters`) · `selectWarningThreshold` (movement dialogs, BR-15) |
| Persistence | None — re-hydrates with the session (stale-persist risks wrong currency rendering) |
| Reset | `clear()` via `endSession` |
| Consumers | `lib/formatters`, `StockMovementDialog` / `AdjustmentDialog`, `ProductForm` threshold default |

## 6. Server-State Integration

```text
page mounts / URL params change
  → useQueryState(key, () => apiClient.list(params))
       {data, loading, error, refetch}            ← per-page (FD-1)
mutation (domain component, ≤ 1 per component)
  → apiClient.mutate(...) ──success──▶ onCompleted → parent page refetch
                          ──error────▶ typed ApiError → dialog state / toast
```

- `loading` → skeletons; `error` → page error state + retry; all owned by the page hook — never a store.
- **Invalidation = refetch** (FD-2). No cache layer; no optimistic updates (server-authoritative quantity, BR-11) — movement dialogs apply the *response's* returned state to their parent row, then refetch.
- Dashboard staleness is the server's contract (`asOf`, BR-25) — the client renders what the last response said.
- 401s are invisible to `useQueryState`: the interceptor's single-flight refresh resolves them; refresh failure triggers `endSession` and protected pages unmount with their in-flight state.

## 7. Session Lifecycle Orchestration (review Issue 2)

One function owns every session teardown — **`endSession(reason)`** in the auth api client:

```text
endSession(reason: 'logout' | 'expired' | 'deactivated')
  1. authStore.clearSession(reason)
  2. settingsStore.clear()
  3. uiStore session reset (toasts cleared, confirms cancelled, drawer closed)
  4. navigate → /login  (reason-appropriate notice; form state preserved
                         best-effort for 'expired' — EC-30)
```

Callers: the logout action · the interceptor's refresh-failure path · the `ACCOUNT_DEACTIVATED` handler. **No other code path resets session state** — stores stay uncoupled; the orchestration lives in the layer that already owns session transitions.

## 8. Persistence & Security Boundaries

| Data | Persisted? | Mechanism |
|---|---|---|
| Access token | **Never** | Memory only (A-7/SEC-01); the `httpOnly` refresh cookie is the continuity — invisible to JS by design |
| User/session profile · settings | Never | Re-derived from bootstrap refresh |
| `sidebarCollapsed` | `localStorage` | Cosmetic — the only persisted byte |
| Filters / drafts / scanner | Never / URL / component | §2 placements |

No `zustand/persist` on `authStore` or `settingsStore` — **the absence is load-bearing and review-enforced.**

## 9. Selectors & Performance

1. **Atomic selectors only** — narrowest slice per subscription; object selectors use shallow equality.
2. **Store splitting is already maximal** — disjoint consumers mean a toast can never re-render a guard.
3. `usePermission` memoizes lookups against the build-time matrix constant (FD-3).
4. No normalization — stores hold no collections.
5. Stores are plain module singletons; `status: 'initializing'` gates first paint (no lazy-creation tricks). Devtools middleware in development only.

## 10. Error Handling & Testing

**Error-state mapping:**

| Failure | Effect |
|---|---|
| API failure (typed code) | Page-hook `error` / dialog inline state + `toast.error(msg, {correlationId})` — no store writes |
| Network loss mid-mutation | Component keeps draft (EC-28); retry reuses idempotency key |
| 401 → refresh fails | `endSession('expired')` → guards redirect (EC-30 form preservation) |
| `ACCOUNT_DEACTIVATED` | `endSession('deactivated')` + persistent error toast |
| Validation failures | Entirely local form state — never global |

**Testing:** stores are vanilla — actions tested as pure transitions without React (`setSession` flips status; toast cap + queue policy; confirm FIFO; `endSession` full-sequence assertion). Selector tests: `usePermission` table-driven over every capability × role from SRS §5. Mocking: `useXStore.setState` in `beforeEach` with reset — no provider wrappers. Interceptor integration tests assert store write-sequences around single-flight refresh (FEA §11).

## 11. Implementation Guidelines

- **Folder:** `client/src/stores/` — `authStore.ts` · `uiStore.ts` · `settingsStore.ts` · `selectors.ts` · `index.ts` (FST-008). No growth expected.
- **Naming:** `useXStore` hooks · actions imperative verbs (`setSession`, `pushToast`) · selectors `selectX` · facades (`useToast`, `useConfirm`, `usePermission`) are the public API — components import facades, not raw stores, wherever a facade exists.
- **Pattern:** `create<State & Actions>()` with in-store actions; the only middleware is the `persist` partial on `uiStore.sidebarCollapsed` (+ devtools in dev).
- **TypeScript:** `State` / `Actions` as separate interfaces, exported for tests; `user` and settings types come from the generated API types (NFR-27) — never hand-declared.

## 12. Review Findings & Exclusions

**Findings incorporated:**

| # | Finding (severity) | Resolution |
|---|---|---|
| 1 | `uiStore` edge policies undefined — confirm collisions (reachable via `useUnsavedChanges`) and toast overflow (Minor) | Confirm FIFO queue; toast overflow queue with persist-rule retention (§4) |
| 2 | Cross-store logout reset had no owner — scattered sequences guarantee a forgotten store (Minor) | Single `endSession(reason)` orchestration in the auth api client (§7) |
| + | Formatter behavior with unhydrated currency (improvement) | Symbol-less rendering + one-time warning (§5) — graceful degradation pending FCM-01 |

**Explicit exclusions (requested elements with no approved basis):**

| Rejected | Resolution |
|---|---|
| `filterStore` | Filters are URL search params (SMP §4) — a store would duplicate the source of truth |
| `scannerStore` | Single-owner local machine (UCA §5.1); globalizing adds stale-camera lifecycle bugs for zero consumers |
| `productStore` / `inventoryStore` / `transactionStore` / `categoryStore` / `dashboardStore` | Server state — FD-1/NFR-25 forbid mirroring |
| Theme state | FD-4 |
| Global loading overlay | Contradicts the WIR skeleton contract — loading is per-page-hook and per-button |
| Cross-tab session sync | Correctly absent: a revoked tab fails its next refresh and self-clears (EC-31 accepted behavior) |

**Component-to-store map:**

```text
authStore ──▶ guards · interceptors · UserMenu · Sidebar(admin) · usePermission sites
uiStore ────▶ ToastRegion · ConfirmDialogHost · AppShell · TopBar · MobileDrawer
settingsStore ▶ lib/formatters · movement/adjustment dialogs · ProductForm defaults
(everything else: pages ↔ useQueryState ↔ api clients — no store involvement)
```

---

*End of document — SMA-IMS-013 v1.0 · Approved — Ready for Production · 2026-07-23*
