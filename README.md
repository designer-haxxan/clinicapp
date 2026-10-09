# ClinicPro

Offline-first clinic management as a static PWA (no build step).
HTML5 · ES modules · jQuery · Bootstrap 5 · Bootstrap Icons · IndexedDB · Service Worker · eposwala login API.

## Features

- **Reception & tokens**: issue a daily token (`T-001`, `T-002`…) for a patient and a doctor. Call the next patient, mark them *with doctor*, *done* or *cancelled*. Each doctor has a "now serving" card.
- **Appointments**: book a patient with a doctor for a day and time, then check them in, which issues a token. Mark no-shows and cancellations.
- **Patients**: searchable register (name, phone, age, gender, address) with a history of visits, bills, and appointments per patient.
- **Doctors**: each doctor has a share percentage. Every bill credits the doctor's share and the clinic keeps the rest. Doctor statements show earned, paid out, and owed. Record payouts (partial or full).
- **Services & fees**: price list for consultations, lab tests, procedures, medicines. A doctor's consultation fee can be added to a bill with one tap.
- **Billing**: bills from a token or a patient, with discount, partial payment (cash, card, bank, or credit), and dues collected later. Print a receipt. Voiding a bill needs a reason and removes it from totals.
- **Expenses**: rent, salaries, supplies, and other costs. They reduce the clinic's net in reports.
- **Dashboard**: collected today, doctors' figures and live queue, 7-day billing chart, upcoming appointments.
- **Reports**: day-end closing or any date range. Billed, collected, dues, doctors' share, clinic share, expenses, payouts, net to clinic, cash flow, per-doctor table, payment modes, top services, tokens and appointments. Print or export CSV.
- **Backup & restore**: one JSON file with a SHA-256 checksum. The file is checked and previewed before restoring, and restoring requires typing `REPLACE`.
- **PWA**: installable, works fully offline after the first online sign-in.

## Architecture

```
index.html              App shell (splash, login, layout, bottom navigation)
manifest.json           PWA manifest
service-worker.js       Precache of shell + CDN libs; cache-first; /api/ requests never cached
css/app.css
js/app.js               Boot, auth gate + session expiry, router (lazy-loaded modules), connection badge
js/config.js            App name/ID, login API base URL, support phone, versions
js/core/                utils, settings (LocalStorage), ui helpers, charts (SVG), pickers, shared views
js/db/                  IndexedDB wrapper (atomic multi-store transactions) + schema
js/services/            auth, clinic (all reads/writes and report figures), backup
js/modules/             dashboard, reception, appointments, patients, doctors, billing, fees, expenses, backup, settings
js/reports/             reports (day-end closing, range reports, print, CSV)
```

### Storage

| Where | What |
|---|---|
| IndexedDB `clinicpro_clinic` | doctors, patients, services, tokens, appointments, bills (with item lines and share split), payments, doctor payouts, expenses, audit log, counters |
| LocalStorage | Clinic profile and defaults (`clinicpro.settings`), device preferences, `clinicpro.session` (`{ token, expiresAt, username }`), and the shared phone id `minipos.deviceId` |

**Shared origin.** All GitHub Pages sites under the same host share one IndexedDB, LocalStorage and Cache Storage. This app namespaces everything with `CONFIG.APP_ID` (`clinicpro`). If you copy it for another clinic, keep a unique `APP_ID` in `js/config.js` and `service-worker.js`.

**Data integrity.** Each write (token status change, bill, payment, payout, expense, void…) runs in one IndexedDB transaction and writes an audit record. A bill also takes its number and its payment in the same transaction. Bill numbers (`BILL-000001`…) come from a counter inside that transaction and cannot repeat. A token can be billed only once.

**Doctor share.** The share is taken from the doctor's percentage at the moment the bill is saved (`doctorShare = total × share%`). Later changes to the percentage do not change old bills.

**Figures come from records.** Reports, dashboard figures and doctor balances are computed from bills, payments, payouts and expenses. Voided bills are excluded.

### Authentication

Sign-in uses the eposwala login API (`CONFIG.AUTH_API_BASE`), as before:

```
POST /api/login   Content-Type: application/json
{ "username": "...", "password": "...", "deviceId": "..." }
2xx  → { "token": "...", "expiresAt": <unix ms>, "username": "..." }
!2xx → { "error": "missing_fields" | "invalid_credentials" | "device_mismatch" | "account_disabled" }
```

- Sign-in requires the internet. The session stays valid offline until `expiresAt`. Passwords are never stored.
- One account is bound to one device on the server (`deviceId`).
- Roles are defined in `js/services/auth.js` (`reception`, `manager`, `admin`). The login response has no role today, so every account gets full access (`admin`).

## Setup

```bash
python -m http.server 8765
```

Then open http://localhost:8765. The app must be served over HTTP(S) (ES modules and service worker). Sign-in from `localhost` works only once the login API allows that origin (see CORS note below).

**CORS:** `https://eposwala.com/api/login` sends no CORS headers, so browsers can only call it from pages served by https://eposwala.com itself. To run from another origin, the API must return `Access-Control-Allow-Origin` for that origin and answer the `OPTIONS` preflight with `Access-Control-Allow-Headers: content-type`.

**Deploy:** serve the folder over HTTPS (GitHub Pages, IIS, or any host). When you change any file, bump `VERSION` in `service-worker.js`. Installed copies then update the next time they are opened online.

## Backup & restore

- **Download** produces:
  ```json
  { "format": "clinicpro-backup", "backupVersion", "appVersion", "schemaVersion", "createdAt", "createdBy", "counts", "checksum", "settings", "data": { ... } }
  ```
- **Restore** checks the format and version, record counts against the header (detects truncation), the checksum (detects tampering), and duplicate bill numbers. You then see the counts and must type `REPLACE`. It runs in one transaction. There is no merge mode yet.

## Known limitations

- **Data lives on the device.** There is no multi-device sync. Back up regularly (the dashboard reminds you after 7 days).
- **Anyone with physical access can read local data**, including patient records. Use device lock screens and keep backup files private.
- **Accounting is simple.** Bills, payments, payouts and expenses are tracked, but there is no double-entry ledger, tax, or insurance billing.
- **Roles are not enforced by the server.** Permissions are enforced in the app only.
- **Restore replaces data.** There is no merge yet.
- **Printing** uses the browser print dialog (any printer, PDF, AirPrint). Bluetooth/RawBT thermal printing from the previous POS version was removed.
