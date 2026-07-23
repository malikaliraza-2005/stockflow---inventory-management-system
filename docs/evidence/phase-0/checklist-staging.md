# DEP §12 Phase-0 Checklist — STAGING environment

| | |
|---|---|
| **Environment** | `ims-staging` (host: TBD Render · SPA: TBD Vercel/CF-Pages · Atlas project `ims-staging` · Cloudinary folder `ims-staging/`) |
| **Operator** | Ali Raza (AS-19) |
| **Status** | ⬜ IN PROGRESS — deploy session pending (domain + host accounts) |

| # | DEP §12 item | Status | Evidence / plan |
|---|---|---|---|
| 1 | `app.<domain>` + `api.<domain>` live under one eTLD+1, TLS both (**§2 Critical**) | ⬜ | Domain purchase pending (Part D); DNS at deploy session |
| 2 | Refresh-cookie verification (login → expiry → silent refresh) | ⬜ **deferred to P1** | Auth endpoints don't exist in P0; the walking skeleton verifies domain topology + TLS; the cookie test runs the day F1 lands on staging (first possible moment) |
| 3 | Trust-proxy echo (ARB-01/**R-4**) | ⬜ | Echo endpoint plan: temporary route logs `req.ip` + `X-Forwarded-For` chain; set `TRUST_PROXY_HOPS` to measured hop count |
| 4 | Atlas: allowlist + least-privilege user | ✅ user / ⬜ allowlist | User `ims-staging-app` = `readWrite@ims` only (screenshot 2026-07-23). Allowlist: operator IP now; **add Render egress IPs, remove operator IP** at deploy |
| 5 | Cloudinary: folder scoping + unsigned presets disabled | ✅ presets / ➡ scoping | Same account as dev (single-env free plan, folder-scoped per DEP §12 wording); presets all Signed |
| 6 | Dual-origin headers (SEC §10) on both origins | ⬜ | SPA document headers staged in `client/vercel.json`; API headers (helmet) wired at deploy session |
| 7 | Console MFA, named operators | ✅ | Same consoles as dev: Atlas via Google 2SV ✅; Cloudinary ⬜ confirm |
| 8 | Secret namespace populated; boot config validation | ⬜ | Render env group `ims-staging` from `.env.example` inventory; staging SRV string + distinct JWT secrets ready in operator notes |
| 9 | Seed release phase executed; integrity green | ⬜ | `npm run seed` wired in `render.yaml`; runs at first deploy |
| 10 | Uptime monitor live; alert route test-fired | ⬜ | UptimeRobot (free) → `https://api.<domain>/ready`, alert to operator email; fire test alert |

**R-4 echo procedure (item 3):** deploy → `curl https://api.<domain>/__echo-ip` from two networks → response must show the real client IP as `req.ip` with the configured hop count → record value → remove echo route.

**Sign-off:** _______________ (operator) · date: ________
