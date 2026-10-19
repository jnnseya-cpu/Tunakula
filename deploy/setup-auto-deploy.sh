#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Turn ON Tunakula's automatic web deploy — run this ONCE, on your own computer.
#
# After this, every push to the deploy branch runs the tests and, if green,
# deploys the website + API to your VPS by itself. No more manual server steps.
#
# You need, on the computer you run this from:
#   • the GitHub CLI `gh`, logged in        → https://cli.github.com  then  gh auth login
#   • SSH access to your VPS (you can `ssh user@your-server`)
#
# The deploy key is generated here and its PRIVATE half goes straight into a
# GitHub secret via `gh` — it is never printed or sent through chat. The PUBLIC
# half is added to your server so the pipeline is allowed to log in.
#
#   bash deploy/setup-auto-deploy.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO="jnnseya-cpu/Tunakula"
KEY="$HOME/.ssh/tunakula_deploy"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

command -v gh >/dev/null 2>&1 || { echo "Install the GitHub CLI first: https://cli.github.com"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "Log in first:  gh auth login"; exit 1; }
command -v ssh-keygen >/dev/null 2>&1 || { echo "ssh-keygen not found (install OpenSSH)."; exit 1; }

say "Your VPS details"
read -rp "  VPS host or IP (e.g. 187.124.117.159): " VPS_HOST
read -rp "  VPS SSH user (e.g. root): " VPS_USER
read -rp "  Tunakula checkout path on the VPS [/root/Tunakula]: " VPS_APP_DIR
VPS_APP_DIR="${VPS_APP_DIR:-/root/Tunakula}"

# 1. A dedicated deploy key (kept on your machine; only the public half touches the server)
if [[ ! -f "$KEY" ]]; then
  say "Generating a deploy key at $KEY"
  ssh-keygen -t ed25519 -N "" -C "tunakula-auto-deploy" -f "$KEY"
else
  say "Reusing existing deploy key at $KEY"
fi

# 2. Authorise that key on the VPS so the pipeline can log in
say "Installing the public key on $VPS_USER@$VPS_HOST (you may be asked for your server password)"
if command -v ssh-copy-id >/dev/null 2>&1; then
  ssh-copy-id -i "$KEY.pub" "$VPS_USER@$VPS_HOST"
else
  # shellcheck disable=SC2029
  ssh "$VPS_USER@$VPS_HOST" 'mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys' < "$KEY.pub"
fi

# 3. Store the secrets + path on GitHub (private key goes in via a file, never echoed)
say "Storing the GitHub secrets"
gh secret   set VPS_HOST    --repo "$REPO" --body "$VPS_HOST"
gh secret   set VPS_USER    --repo "$REPO" --body "$VPS_USER"
gh secret   set VPS_SSH_KEY --repo "$REPO" < "$KEY"
gh variable set VPS_APP_DIR --repo "$REPO" --body "$VPS_APP_DIR"

# 4. Flip the switch ON — last, once everything above is in place
say "Turning the deploy pipeline ON (DEPLOY_WEB=true)"
gh variable set DEPLOY_WEB --repo "$REPO" --body "true"

cat <<EOF

✔ Automatic web deploy is ON.

One thing to confirm: the first-time bring-up must have been run on the VPS at least
once, so the containers, env file and Caddy routing exist:

    cd "$VPS_APP_DIR" && bash deploy/go-live-coexist.sh

After that, every push to the deploy branch deploys the website + API automatically.

Optional — the mobile apps' auto-build also needs one token:
    gh secret set EXPO_TOKEN --repo "$REPO"     # paste a token from expo.dev → Account → Access tokens
EOF
