# Deploy Tunakula alongside your other websites (shared VPS)

Your VPS already serves other sites, so something (Nginx, Apache, or a control panel) already owns ports
**80/443**. We will **not** touch that. Tunakula runs in Docker on **localhost-only** high ports, and your
existing web server reverse-proxies three new subdomains to it and issues their TLS. Your current sites are
unaffected, and nothing here binds 80/443.

```
                 your existing web server (owns 80/443, your other sites)
 Internet ──▶ 443 ─┬─ yourdomain.com      ──▶ 127.0.0.1:8091  (Tunakula customer site)
                   ├─ admin.yourdomain.com ──▶ 127.0.0.1:8092  (Tunakula admin console)
                   └─ api.yourdomain.com   ──▶ 127.0.0.1:8090  (Tunakula API)  ──▶ Postgres (internal)
                   … plus all your existing sites, exactly as before …
```

---

## Step 0 — Tell me what's on the box (2 min)

SSH in and run this. Paste the whole output back and I'll hand you the exact config for your setup.

```bash
echo "── OS ──";        cat /etc/os-release | grep -E '^(NAME|VERSION)='
echo "── public IP ──"; curl -4 -s ifconfig.me; echo
echo "── docker ──";    docker --version 2>/dev/null || echo "docker: NOT installed"
                        docker compose version 2>/dev/null || echo "compose plugin: NOT installed"
echo "── who owns 80/443 ──"; sudo ss -ltnp '( sport = :80 or sport = :443 )'
echo "── web servers present ──"; for s in nginx apache2 httpd caddy; do command -v $s >/dev/null && echo "$s: $(command -v $s)"; done
echo "── panels present ──"; for p in /usr/local/cpanel /usr/local/psa /usr/local/hestia /usr/local/CyberCP /www/server/panel /home/cloudpanel; do [ -e "$p" ] && echo "panel dir: $p"; done
```

The "who owns 80/443" line is the key one: it names the process (nginx / apache2 / litespeed / a panel's server) that we'll add the three subdomains to.

## Step 1 — DNS: three A records (5 min, in your domain's DNS panel)

Point each at your VPS's public IP (the number Step 0 printed):

| Type | Host (name) | Value         | Becomes            |
|------|-------------|---------------|--------------------|
| A    | `@`         | your VPS IP   | customer storefront |
| A    | `admin`     | your VPS IP   | admin console       |
| A    | `api`       | your VPS IP   | the API             |

> If your bare domain `@` is already in use by an existing site, **don't reuse it** — pick a free subdomain
> for Tunakula's storefront instead (e.g. `shop`), and set `CUSTOMER_DOMAIN=shop.yourdomain.com` in Step 3.

Wait a few minutes, then check one resolves to your VPS: `dig +short api.yourdomain.com` (or `ping`).

## Step 2 — Get the code and the settings file

```bash
git clone https://github.com/jnnseya-cpu/Tunakula.git
cd Tunakula
git checkout claude/exciting-turing-k5r4jb
cp deploy/.env.coexist.example deploy/.env.staging
nano deploy/.env.staging          # set the 3 domains + generate TUNAKULA_TOKEN_SECRET (command is in the file)
```

## Step 3 — Build and start Tunakula (localhost only, never 80/443)

```bash
C="docker compose --env-file deploy/.env.staging -f deploy/docker-compose.coexist.yml"
$C up -d --build                  # first build takes a few minutes
$C ps                             # all services Up; ports show 127.0.0.1:809x
curl -s http://127.0.0.1:8090/v1/health   # -> {"status":"ok"}
```

Nothing is reachable from the internet yet — only your web server (next step) can see these ports.

## Step 4 — Point your existing web server at them + get HTTPS

Pick the file that matches Step 0 and follow the instructions at the top of it (replace the domain
placeholders first):

- **Nginx** → `deploy/reverse-proxy/nginx-tunakula.conf`
- **Apache** → `deploy/reverse-proxy/apache-tunakula.conf`
- **A control panel** (cPanel/Plesk/CloudPanel/HestiaCP/CyberPanel/aaPanel): create three sites/domains in
  the panel (`yourdomain.com`, `admin.`, `api.`), and for each set a **reverse proxy / proxy pass** to
  `http://127.0.0.1:8091`, `:8092`, `:8090` respectively, then enable **Let's Encrypt SSL** for each in the
  panel. Paste me your panel name from Step 0 and I'll give the click-path.

Then issue certificates (Nginx/Apache route — the panel does its own):

```bash
sudo certbot --nginx  -d yourdomain.com -d admin.yourdomain.com -d api.yourdomain.com
#   or, for Apache:
sudo certbot --apache -d yourdomain.com -d admin.yourdomain.com -d api.yourdomain.com
```

Certbot edits only the three Tunakula blocks and reloads; your other sites' vhosts and certs are untouched.

## Step 5 — Create your Super Admin and open the shop

```bash
C="docker compose --env-file deploy/.env.staging -f deploy/docker-compose.coexist.yml"
$C exec -T api npm run bootstrap-admin -w @tunakula/api -- "+243810000000" "Launch Owner"
```

Then:
1. Open `https://admin.yourdomain.com` and sign in with that phone number. Staging prints the sign-in code
   to the log instead of SMS — read it with: `$C logs api | grep -i otp | tail -1`
2. In the admin console, **publish your first market** (Country Profile → publish).
3. Open `https://yourdomain.com` and place a test order (payments are sandbox — no real money moves).

---

## Everyday commands

```bash
C="docker compose --env-file deploy/.env.staging -f deploy/docker-compose.coexist.yml"
$C logs -f            # watch Tunakula
$C ps                 # what's running
$C restart api        # restart just the API
git pull && $C up -d --build   # update to newer code
$C down               # stop Tunakula (keeps its database)  — your other sites keep running
$C down -v            # stop AND erase Tunakula's database only
```

## Safety notes for a shared box

- Tunakula's Postgres has **no host port** — it lives on the internal Docker network only, so it can't clash
  with any database already on the VPS.
- The app ports bind to **127.0.0.1**, so they're reachable only through your web server, never directly.
- Volumes are named `tunakula-coexist-*`, isolated from any other Docker stack.
- To fully remove Tunakula later: `docker compose --env-file deploy/.env.staging -f deploy/docker-compose.coexist.yml down -v`,
  then delete the three server blocks/vhosts (or the three panel sites) and their certs. Your other sites are
  never involved.

## When you're ready for real customers

Turn off the staging conveniences and add real providers (managed database with backups, real SMS, real
card/mobile-money payments). See `docs/runbooks/deploy-step-by-step.md`.
