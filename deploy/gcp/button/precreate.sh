#!/usr/bin/env bash
# Run on Google Cloud, before the service is created: creates the Secret Manager secrets and the
# service account the app runs as. Secret values are typed with hidden input and sent straight to
# Secret Manager. See docs/deploy.md.
set -euo pipefail
set +x

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project="$GOOGLE_CLOUD_PROJECT"
service="$K_SERVICE"
prefix="$service"

cat <<'EOF'

This deployment uses accounts mode (per-person sign-in). Before you continue, run these once on
your computer with MOTHERDUCK_APP_TOKEN set (docs/accounts.md):
  npm run db:migrate
  npm run admin:create -- --username=<you>

Cloud Run's default address cannot guarantee a trusted client-IP header, which the shared
password needs. For password sign-in, use the Terraform configuration with your own domain.

EOF

# Some providers need two secrets, such as AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.
read -r -p "Model provider secret settings, separated by commas [OPENAI_API_KEY]: " model_keys
model_keys="${model_keys:-OPENAI_API_KEY}"
model_keys="${model_keys//[[:space:]]/}"
[[ "$model_keys" =~ ^[A-Z][A-Z0-9_]*(,[A-Z][A-Z0-9_]*)*$ ]] || { echo "Use setting names such as ANTHROPIC_API_KEY." >&2; exit 2; }

gcloud services enable secretmanager.googleapis.com cloudscheduler.googleapis.com iam.googleapis.com --project "$project"

"$here/../scripts/create-secrets.sh" --project "$project" --prefix "$prefix" --sign-in accounts \
  --secrets "MOTHERDUCK_EMBED_TOKEN,MOTHERDUCK_CHAT_TOKEN,${model_keys}"

account="${service:0:26}-app"
email="${account}@${project}.iam.gserviceaccount.com"
if ! gcloud iam service-accounts describe "$email" --project "$project" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$account" --project "$project" --display-name "MotherDuck Dive + AI Chat (app)"
fi

# A new service account can take a minute to become usable in IAM policies, so retry.
retry() {
  local attempt
  for attempt in 1 2 3 4 5 6; do
    "$@" && return 0
    echo "Retrying in 10 seconds ($attempt of 6)..." >&2
    sleep 10
  done
  "$@"
}

names="SESSION_SECRET CRON_SECRET MOTHERDUCK_APP_TOKEN MOTHERDUCK_EMBED_TOKEN MOTHERDUCK_CHAT_TOKEN ${model_keys//,/ }"
for name in $names; do
  retry gcloud secrets add-iam-policy-binding "${prefix}-${name}" --project "$project" \
    --member "serviceAccount:${email}" --role roles/secretmanager.secretAccessor >/dev/null
done

# Names only, for postcreate.sh.
printf 'PREFIX=%q\nAPP_ACCOUNT=%q\nSECRET_NAMES=%q\n' "$prefix" "$email" "$names" > "$APP_DIR/.button-state"
