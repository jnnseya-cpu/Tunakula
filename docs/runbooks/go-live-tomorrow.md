# Go live — your launch-day checklist

One page. Follow it top to bottom. Everything here uses the one-command staging
publish that's already built and tested on branch `claude/exciting-turing-k5r4jb`.

Two moments: a **5-minute job tonight** (so DNS is ready by morning), then
**~20 minutes tomorrow** to actually go live.

---

## ✅ Tonight — do just this one thing (5 min)

DNS records take time to spread across the internet. Setting them tonight means
they're ready when you run the launch tomorrow — no waiting around.

1. In the **Hostinger panel**, find your VPS's public IP (looks like `193.42.x.x`).
2. In your **domain's DNS panel**, add three **A records**, all pointing at that IP:

   | Type | Name (host) | Value       | Becomes            |
   |------|-------------|-------------|--------------------|
   | A    | `@`         | your VPS IP | your customer site |
   | A    | `admin`     | your VPS IP | the admin console  |
   | A    | `api`       | your VPS IP | the API            |

3. That's it for tonight. (Tomorrow you'll confirm they resolve before building.)

> Don't have the VPS yet? Create the Hostinger VPS tonight too (Ubuntu is fine),
> so its IP exists for the records above.

---

## 🚀 Tomorrow — go live (~20 min, mostly waiting on the build)

### Step 1 — Check DNS resolves (1 min, from your laptop)
```bash
ping api.yourdomain.com      # should print your VPS IP
```
If it shows your VPS IP, you're good. If not, give DNS a little longer.

### Step 2 — Run the one command on the VPS
Open the Hostinger **Browser terminal** (or SSH in), then:
```bash
git clone https://github.com/jnnseya-cpu/Tunakula.git
cd Tunakula
git checkout claude/exciting-turing-k5r4jb
bash deploy/go-live-staging.sh
```

The script does everything. It will ask you **four things** — have these ready:

| It asks for…        | You answer…                                            |
|---------------------|--------------------------------------------------------|
| Your domain         | e.g. `tunakula.com`                                    |
| 3 subdomains        | just press Enter to accept `api.`, bare, `admin.`      |
| "DNS set? [y/N]"    | `y` (you did it last night)                            |
| Admin phone + name  | your phone in full form, e.g. `+243810000000`          |

Then it builds and starts the whole platform (first build takes a few minutes),
waits until the API is healthy, creates your Super Admin, and **prints your three
live URLs**.

### Step 3 — Sign in and open your shop
1. Go to `https://admin.yourdomain.com` and sign in with the phone number you gave.
   - This is staging, so your **sign-in code is printed in the log**, not texted.
     Get it with:
     ```bash
     C="docker compose --env-file deploy/.env.staging -f deploy/docker-compose.staging.yml"
     $C logs api | grep -i otp | tail -1
     ```
2. In the admin console, **publish your first market** (create a Country Profile → publish).
3. Open `https://yourdomain.com` — your storefront is live. **Place a test order**
   (payments are in sandbox, so no real money moves).

**You're live.** 🎉

---

## What's real vs. sandbox on day one

This staging launch is the real platform at your real domain, with **automatic HTTPS**.
These parts run in safe/test mode until you turn them on for paying customers:

| Area        | Day-one behaviour                        | Turn on later with…                     |
|-------------|------------------------------------------|-----------------------------------------|
| Sign-in SMS | code printed in the API log              | Twilio keys (admin → Integrations)      |
| Payments    | sandbox (no real charges)               | Stripe / mobile-money keys              |
| Email blasts| logged unless SMTP is set                | `TUNAKULA_SMTP_HOST` + `_FROM`          |
| Database    | local Postgres on the VPS (with backups you run) | managed DB — see production runbook |

Nothing above blocks launch. You can flip each one on from the admin console or
env file without redeploying the whole stack.

---

## If something goes wrong (quick reference)

Run these from the `Tunakula` folder on the VPS. First set the shortcut:
```bash
C="docker compose --env-file deploy/.env.staging -f deploy/docker-compose.staging.yml"
```

| Situation                          | Command                                  |
|------------------------------------|------------------------------------------|
| See what's running                 | `$C ps`                                  |
| Watch all logs live                | `$C logs -f`                             |
| API didn't come up                 | `$C logs api`                            |
| HTTPS cert not issued              | `$C logs caddy` (usually DNS not ready)  |
| Restart just the API               | `$C restart api`                         |
| Re-run is always safe              | `bash deploy/go-live-staging.sh`         |
| Stop everything (keeps your data)  | `$C down`                                |
| Update to newer code later         | `git pull && $C up -d --build`           |

> **Keeps your data:** `$C down` stops the platform but your database survives.
> Only `$C down -v` erases the database — don't use `-v` unless you mean it.

---

## When you're ready for real paying customers

Keep this staging box as your test environment and follow
`docs/runbooks/deploy-step-by-step.md` for the hardened production launch
(managed database with backups, real SMS, real card/mobile-money payments,
frontends on a global CDN).
