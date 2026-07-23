# ZXing Device Spike — how to run (Phase 0 · task 0.11 · R-1)

Camera APIs require a **secure context** (NFR-35): serve this folder over HTTPS
and open it from each target phone on the same Wi-Fi.

## 1. Generate a throwaway self-signed cert (once)

From the repo root (Git Bash — openssl ships with Git for Windows):

```bash
openssl req -x509 -newkey rsa:2048 -nodes -days 7 \
  -keyout "$TEMP/spike-key.pem" -out "$TEMP/spike-cert.pem" -subj "//CN=ims-spike"
```

(The cert lives in TEMP, never in the repo.)

## 2. Serve the spike over HTTPS

```bash
npx http-server "docs/evidence/phase-0/zxing-spike" -S \
  -C "$TEMP/spike-cert.pem" -K "$TEMP/spike-key.pem" -p 8443 -a 0.0.0.0
```

## 3. Connect each phone

1. Find the laptop's LAN IP: `ipconfig` → Wireless LAN adapter → IPv4 (e.g. `192.168.1.7`)
2. Phone (same Wi-Fi) → browser → `https://192.168.1.7:8443`
3. Accept the self-signed-certificate warning (Advanced → proceed)
4. **Start camera** → grant permission → point at test codes

## 4. Test protocol (per device — fill `report.md`)

| # | Test | How |
|---|---|---|
| 1 | Camera init time | logged automatically ("camera ready in N ms") |
| 2 | EAN-13 decode | any retail product barcode |
| 3 | Code-128 decode | print one: barcode.tec-it.com (Code-128, e.g. `IMS-TEST-128`) |
| 4 | QR decode | any QR code (e.g. generated for `IMS-QR-TEST`) |
| 5 | Decode latency | logged per decode ("+N ms after camera-ready") |
| 6 | Low light | dim the room, retry test 2 — decode still possible ≤ a few seconds? |
| 7 | Torch | Torch button — supported? helps in low light? |
| 8 | Permission denied | revoke camera permission in site settings, reload, Start → the page must show `permission-denied`, not hang |
| 9 | Wrong/damaged code | partially cover a barcode — no false decodes? |
| 10 | Sustained scan | scan 10 codes in a row — no freeze/crash/heat warning |

Use **Copy log for report** on each device and paste into `report.md`.

## R-1 decision rule (FEA §13)

- **PASS** — target phones init the camera and decode EAN-13 + QR reliably
  (seconds, not tens of seconds), with usable failure states → Scanner (P4)
  proceeds on the approved ZXing architecture.
- **PARTIAL** — decode works but slowly / torch missing / one browser quirky →
  proceed; record constraints as P4 design inputs (e.g. mandatory manual-entry
  fallback prominence, minimum lighting guidance).
- **FAIL** — camera or decode fundamentally broken on target devices →
  architecture review BEFORE P4 (per SRS: manual code entry is the guaranteed
  fallback path either way).
