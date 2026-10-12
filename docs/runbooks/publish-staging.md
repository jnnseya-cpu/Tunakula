# Publish Tunakula — the simple version (one VPS, one command)

This gets the **whole platform live on the internet at your own domain**, fast, on your Hostinger VPS.
No Google Cloud, no Vercel, no Twilio, no Stripe needed yet — those come later when you harden for
paying customers. There are only **three things you do**.

```
┌────────────────────────── YOUR HOSTINGER VPS ──────────────────────────┐
│   Caddy (HTTPS)  →  customer site                                        │
│                  →  admin console        all built + run by ONE command  │
│                  →  API  →  PostgreSQL                                    │
└──────────────────────────────────────────────────────────────────────┘
        ▲ your domain's DNS points all three names here
```

---

## Thing 1 — Point your domain at the VPS (5 minutes, in your domain's DNS panel)

Find your VPS's public IP in the Hostinger panel (it looks like `193.42.x.x`). Then add **three DNS
A records**, all pointing at that IP:

| Type | Name (host) | Value         |
|------|-------------|---------------|
| A    | `@`         | your VPS IP   |  ← the customer site (your bare domain)
| A    | `admin`     | your VPS IP   |  ← the admin console
| A    | `api`       | your VPS IP   |  ← the API

(You can choose different names — the script will ask. These are the defaults.)

Wait a few minutes, then from your laptop check one resolves:
```
ping api.yourdomain.com      # should show your VPS IP
```

## Thing 2 — Run the one command on the VPS

Open the Hostinger **Browser terminal** (or SSH in), then:
```bash
git clone https://github.com/jnnseya-cpu/Tunakula.git
cd Tunakula
git checkout claude/exciting-turing-k5r4jb
bash deploy/go-live-staging.sh
```
The script walks you through everything:
1. installs Docker if it isn't there,
2. asks for your three domain names,
3. generates a secret key for you,
4. asks you to confirm DNS is set, then **builds and starts the whole platform** (first build takes a few minutes),
5. waits until the API is healthy,
6. asks for your phone number and creates your **Super Admin** account,
7. prints your three live URLs.

## Thing 3 — Sign in and open your shop

1. Go to `https://admin.yourdomain.com` and sign in with the phone number you gave.
   - This is staging, so your **sign-in code is printed in the log**, not sent by SMS. Get it with:
     ```bash
     docker compose --env-file deploy/.env.staging -f deploy/docker-compose.staging.yml logs api | grep -i otp
     ```
2. In the admin console, **publish your first market** (create a Country Profile, then publish it).
3. Open `https://yourdomain.com` — your customer storefront is live. Place a test order
   (payments run in sandbox mode, so no real money moves).

**That's it — the platform is published.**

---

## Everyday commands (run from the `Tunakula` folder on the VPS)

```bash
C="docker compose --env-file deploy/.env.staging -f deploy/docker-compose.staging.yml"
$C logs -f            # watch everything
$C ps                 # what's running
$C restart api        # restart one service
$C up -d --build      # redeploy after a `git pull`
$C down               # stop (keeps the database)
$C down -v            # stop AND erase the database
```

To update to the latest code later:
```bash
git pull && $C up -d --build
```

---

## When you're ready for real customers

Staging uses a local database, printed sign-in codes, and fake payments. To go to a **real
production launch** (managed database with backups, real SMS, real card/mobile-money payments,
frontends on Vercel's global CDN), follow `docs/runbooks/deploy-step-by-step.md`. You can keep this
staging box running as your test environment the whole time.
