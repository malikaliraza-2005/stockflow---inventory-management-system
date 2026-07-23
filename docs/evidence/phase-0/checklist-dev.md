# DEP §12 Phase-0 Checklist — DEVELOPMENT environment

| | |
|---|---|
| **Environment** | `ims-dev` (local machine + Atlas project `ims-dev` + Cloudinary `zb3guqm9`) |
| **Operator** | Ali Raza (AS-19) |
| **Status** | ⬜ SIGNED — pending items 5b/7b confirmation |

| # | DEP §12 item | Status | Evidence |
|---|---|---|---|
| 1 | Custom domains + TLS (§2 mandate) | **N/A (dev)** | Dev is localhost — same-site by nature (DEP §2) |
| 2 | Refresh-cookie verification | **N/A (dev)** | Cookie flow lands P1; localhost is same-origin |
| 3 | Trust-proxy echo (ARB-01/R-4) | **N/A (dev)** | `TRUST_PROXY_HOPS=0`, no proxy locally |
| 4 | Atlas: allowlist + least-privilege user | ✅ **2026-07-23** | Allowlist = single `/32` (no 0.0.0.0/0). User `ims-dev-app`: cross-database write DENIED (AtlasError), `listDatabases` returns only `ims` — probe transcript in session log |
| 5 | Cloudinary: folder scoping + unsigned presets disabled | ✅ presets / ➡ scoping | 5a: presets all Signed (operator action 2026-07-23). 5b: folder scoping is enforced by upload signatures — arrives with F5 (P2); nothing uploads before then |
| 6 | Dual-origin headers (SEC §10) | **N/A (dev)** | Single localhost origin |
| 7 | Console MFA, named operators | ✅ Atlas / ⬜ Cloudinary | 7a: Atlas via Google SSO, Google 2SV verified ON (since Jul 17). 7b: Cloudinary MFA — operator to confirm (Google SSO expected) |
| 8 | Secret namespace populated; boot config validation passes | ✅ **2026-07-23** | `server/.env` complete; `loadEnv()` green; NOTE: standard (non-SRV) Mongo URI — local ISP DNS refuses SRV queries |
| 9 | Seed release phase + integrity check green | ✅ **2026-07-23** | First run created Admin/settings/Uncategorized; re-run created nothing (idempotent); `verifyBootIntegrity` green; server boot → `/ready` 200 against Atlas |
| 10 | Uptime monitor + alert route | **N/A (dev)** | Monitors target staging/production (DEP §9) |

**Deviations recorded:**
- Atlas dev cluster is named `Cluster0` (creation-time miss; name immutable). Project, user, and secrets follow the `ims-dev` convention — isolation boundary unaffected (DEP §3 note).
- R-6 resolved here: Atlas Search available on M0/ap-south-1 (MongoDB 8.0.28) — D-1 path viable for Phase 2.

**Sign-off:** _______________ (operator) · date: ________
