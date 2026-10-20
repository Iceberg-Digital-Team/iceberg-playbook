#!/usr/bin/env bash
# Loads the onboarding content (Getting Started playbook, 5 SOPs, 5 tour videos) into a deployed
# Iceberg Playbook (Docker / Railway) from your own machine.
#
#   ./scripts/bootstrap-remote.sh https://your-app.up.railway.app admin@example.com
#
# It asks for the Admin password (not echoed), shows a dry run, and only imports after you confirm.
# Safe to re-run: nothing is uploaded or changed twice.
set -euo pipefail

URL="${1:-${BOOTSTRAP_API_URL:-}}"
EMAIL="${2:-${BOOTSTRAP_ADMIN_EMAIL:-}}"

if [[ -z "$URL" || -z "$EMAIL" ]]; then
  echo "Usage: $0 <app-url> <admin-email>" >&2
  exit 1
fi

cd "$(dirname "$0")/.."

if ! command -v node >/dev/null; then echo "Node.js 20+ is required." >&2; exit 1; fi
if [[ ! -d node_modules ]]; then echo "Installing dependencies..."; npm ci --silent; fi

if [[ -z "${BOOTSTRAP_ADMIN_PASSWORD:-}" ]]; then
  read -r -s -p "Admin password for $EMAIL: " BOOTSTRAP_ADMIN_PASSWORD
  echo
fi

export BOOTSTRAP_API_URL="${URL%/}"
export BOOTSTRAP_ADMIN_EMAIL="$EMAIL"
export BOOTSTRAP_ADMIN_PASSWORD

echo
echo "== Dry run (changes nothing) =="
node scripts/bootstrap_content.mjs

echo
read -r -p "Apply this plan to $BOOTSTRAP_API_URL? [y/N] " answer
if [[ "$answer" =~ ^[Yy]$ ]]; then
  node scripts/bootstrap_content.mjs --apply
else
  echo "Nothing applied."
fi
