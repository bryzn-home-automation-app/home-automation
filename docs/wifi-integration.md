# WiFi Tab — Integration Guide

The WiFi tab (`/wifi`) is a **guest check-in portal**, not a router-management
integration. Visitors scan a QR code, enter their name, and the app records
their visit. This document covers how it works, how to configure it, and what a
real router integration would (and would not) look like.

## What it actually is

The flow is self-contained in the app's own database — no code talks to the
router:

```
WiFi tab (/wifi)
  └─ QR code = window.location.origin + "/guest"
       └─ Guest opens /guest, enters name + picks a color
            └─ POST /api/auth/guest-login
                 └─ creates/updates a GUEST user + a guest_sessions row (30-day expiry)
                      └─ admin sees them on /wifi and /admin/guests
```

**"Connected guests" means "people who submitted the form", not "devices on
your WiFi."** The `ip_address` on a session is whatever IP the guest's browser
happened to use, not a lease read from the router. See [Phase 2](#phase-2-real-eero-integration)
for what would make that real.

## Configuration

### Network credentials (SSID / password)

The SSID and password shown on the WiFi tab are **build-time** values, read via
`import.meta.env.VITE_WIFI_SSID` / `VITE_WIFI_PASSWORD` in
`frontend/src/pages/WiFiPage.tsx`. When unset, the page shows "Not configured".

There are two build contexts, and they read from different places:

| Context | Where Vite reads from | How to set it |
|---------|----------------------|---------------|
| Local dev (`npm run dev`) | `frontend/.env` | Copy `frontend/.env.example` → `frontend/.env` (gitignored) |
| Production (Docker/nginx) | repo-root `.env` | Set `VITE_WIFI_SSID` / `VITE_WIFI_PASSWORD` in the root `.env` |

Production plumbing: root `.env` → `docker-compose.yml` (`nginx` build args) →
`nginx/Dockerfile` (`ARG` → `ENV`) → `npm run build` → Vite inlines the values
into the bundle.

```bash
# Root .env (production) — same file Docker Compose already reads
VITE_WIFI_SSID=bry-wifi-guest
VITE_WIFI_PASSWORD=<guest-password>
```

After changing the root `.env`, rebuild the nginx image (`docker compose up -d
--build nginx`) or redeploy. On the NUC this happens via `deploy-nuc`.

> **Security note:** Vite inlines these at build time and ships them to the
> browser. Moving them to env keeps the real password out of **git** — it does
> not hide it from the app's users, since the WiFi page displays them to any
> authenticated user. True secrecy would require serving them from the backend
> behind an auth check.

### The QR code

The QR encodes `window.location.origin + "/guest"`. There is nothing to enable —
it always works, but it encodes **the URL you are currently viewing**.

- Viewing the tab at `http://localhost/wifi` → QR points at `localhost`, which
  is useless to a phone.
- Viewing the tab at `http://192.168.4.228/wifi` → QR points at
  `192.168.4.228/guest`.

**Rule: open the WiFi tab from the same URL a guest's phone can reach.**

## Why guests can't reach the app on your LAN (eero)

eero's guest network is **isolated from the main LAN** by design. Guests get
internet access but **cannot reach `192.168.4.228`** (the NUC, which sits on the
main network). A QR encoding a LAN IP will fail for anyone on the guest network.

For the QR to work for guests, the app must be reachable **over the internet**.

## Exposing the app publicly (Tailscale Funnel)

The NUC's nginx already listens on port 80. Tailscale Funnel exposes that port
on a public HTTPS URL without port-forwarding, a custom domain, or any eero
changes.

- **Domain:** your tailnet's `*.ts.net` subdomain is used automatically — no
  domain to buy or configure.
- **URL shape:** `https://<machine-name>.<tailnet-name>.ts.net`
  (e.g. `https://nuc.bryzn-home.ts.net`).
- **HTTPS:** Tailscale provisions a free Let's Encrypt cert automatically.
- **Free** on the Personal plan; the URL is stable (unlike ngrok's random URLs).

### Setup on the NUC

```bash
# 1. Install Tailscale and join your tailnet (one-time)
tailscale up

# 2. Expose nginx (port 80) publicly
tailscale funnel 80
```

The app is now reachable at `https://nuc.<tailnet-name>.ts.net`.

### Make the QR use the public URL

1. Open the WiFi tab **through the public URL**:
   `https://nuc.<tailnet-name>.ts.net/wifi`
2. The QR now encodes `https://nuc.<tailnet-name>.ts.net/guest`, which a guest
   on the isolated network can reach over the internet.

> **Security note:** Funnel makes the app reachable by anyone with the URL.
> `/login` still requires credentials, but the login page is now on the open
> internet. Keep that in mind before exposing anything beyond this app.

## Phase 2 — Real eero integration

eero has **no official API, no local API, and no SSH/SNMP**. The only
programmatic path is the community reverse-engineered **eero cloud API** (via
[`eero-api`](https://pypi.org/project/eero-api/), a Python client).

Realistically achievable on eero:

- Read **real connected devices** (replace the software count).
- Toggle the **guest network on/off**.
- Pull the **real guest SSID + rotating password** from eero.
- **Block/unblock a device by MAC**.

Not achievable on eero:

- Per-guest provisioning or a **captive portal** — eero's guest network is one
  shared rotating password with no hook you control. Name-based check-in stays a
  logical layer in your DB; eero only gives the physical layer.

Recommended architecture (not yet built): a small **Python sidecar** wrapping
`eero-api` exposing `/devices`, `/guest/status`, `/guest/toggle`, and
`/guest/credentials`; the Spring backend polls it and merges with
`guest_sessions`; the WiFi tab reads the merged view.

> **Security:** this would store your **eero account credentials** (and a 2FA
> seed, if enabled) on the box talking to eero — effectively full control of the
> home network. It must live in an env secret / vault, and only the sidecar
> should have access.

## Related files

| File | Purpose |
|------|---------|
| `frontend/src/pages/WiFiPage.tsx` | WiFi tab UI, QR code, credentials display |
| `frontend/src/pages/GuestLogin.tsx` | Guest check-in form (`/guest`) |
| `frontend/src/api/auth.ts` | `guestLogin`, `fetchGuestSessions`, etc. |
| `frontend/src/vite-env.d.ts` | `VITE_WIFI_*` type declarations |
| `nginx/Dockerfile` | Inlines `VITE_WIFI_*` at build time |
| `docker-compose.yml` | Passes `VITE_WIFI_*` build args to nginx |
| `backend/src/main/resources/schema.sql` | `users` + `guest_sessions` tables |
| `backend/.../service/UserService.java` | `guestLogin`, session lifecycle |
