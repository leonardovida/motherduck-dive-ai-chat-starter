#!/usr/bin/env bash
# Creates the Secret Manager secrets the app reads, named <prefix>-<SETTING>. It asks for each
# missing value with hidden input, generates SESSION_SECRET and CRON_SECRET, and keeps secrets
# that already exist. Values go straight to Secret Manager on standard input; nothing is printed,
# logged or written to disk. See docs/deploy.md.
#
#   deploy/gcp/scripts/create-secrets.sh --project my-project \
#     [--prefix motherduck-dive-chat] [--sign-in accounts|password] \
#     [--secrets MOTHERDUCK_EMBED_TOKEN,MOTHERDUCK_CHAT_TOKEN,OPENAI_API_KEY]
set -euo pipefail
set +x

project=""
prefix="motherduck-dive-chat"
sign_in="accounts"
extra="MOTHERDUCK_EMBED_TOKEN,MOTHERDUCK_CHAT_TOKEN,OPENAI_API_KEY"

usage() { sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) project="$2"; shift 2 ;;
    --prefix) prefix="$2"; shift 2 ;;
    --sign-in) sign_in="$2"; shift 2 ;;
    --secrets) extra="$2"; shift 2 ;;
    -h | --help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[[ -n "$project" ]] || { echo "--project is required." >&2; exit 2; }
[[ "$prefix" =~ ^[A-Za-z0-9_-]+$ ]] || { echo "--prefix may contain letters, digits, _ and - only." >&2; exit 2; }
case "$sign_in" in
  accounts) sign_in_secret="MOTHERDUCK_APP_TOKEN" ;;
  password) sign_in_secret="DEMO_PASSWORD" ;;
  *) echo "--sign-in must be accounts or password." >&2; exit 2 ;;
esac

describe() {
  case "$1" in
    MOTHERDUCK_APP_TOKEN) echo "read-write token for the app database only (accounts mode)" ;;
    DEMO_PASSWORD) echo "the shared password viewers type to open the app" ;;
    MOTHERDUCK_EMBED_TOKEN) echo "MotherDuck token allowed to create embed sessions" ;;
    MOTHERDUCK_CHAT_TOKEN) echo "read-only MotherDuck token the assistant queries with" ;;
    *_API_KEY | *_TOKEN*) echo "your model provider or service credential" ;;
    *) echo "see docs/configuration.md" ;;
  esac
}

gcloud services enable secretmanager.googleapis.com --project "$project" >/dev/null

IFS=',' read -r -a names <<< "SESSION_SECRET,CRON_SECRET,${sign_in_secret},${extra}"
for name in "${names[@]}"; do
  name="${name//[[:space:]]/}"
  [[ -n "$name" ]] || continue
  [[ "$name" =~ ^[A-Z][A-Z0-9_]*$ ]] || { echo "Skipping $name: not a setting name." >&2; continue; }
  id="${prefix}-${name}"
  if gcloud secrets describe "$id" --project "$project" >/dev/null 2>&1; then
    echo "Keeping the existing secret $id."
    continue
  fi
  case "$name" in
    SESSION_SECRET | CRON_SECRET) value="$(openssl rand -hex 32)" ;;
    *)
      value=""
      while [[ -z "$value" ]]; do
        read -r -s -p "$name ($(describe "$name")), input hidden: " value
        echo
      done
      ;;
  esac
  printf '%s' "$value" | gcloud secrets create "$id" --project "$project" --replication-policy=automatic --data-file=- >/dev/null
  value=""
  echo "Created the secret $id."
done
