#!/usr/bin/env bash
# Runs the Run on Google Cloud hooks against stand-ins for gcloud and docker, the way the button
# runs them, and checks what they would do. No cloud calls. It checks that typed secret values
# reach gcloud only on standard input, never in its arguments or the hooks' output, and that the
# service, jobs and schedules get the expected settings. Used by .github/workflows/deploy-templates.yml.
set -euo pipefail

app_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/bin" "$work/app"
export STUB_DIR="$work"

cat > "$work/bin/gcloud" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$STUB_DIR/gcloud.args"
case "$*" in
  "projects describe"*) echo 123456789012 ;;
  # An existing secret without a version, as after an interrupted run.
  "secrets describe motherduck-dive-chat-MOTHERDUCK_CHAT_TOKEN "*) exit 0 ;;
  "secrets versions list"*) ;;
  "secrets describe"* | "iam service-accounts describe"* | "scheduler jobs describe"*) exit 1 ;;
  "secrets create"* | "secrets versions add"*) { cat; echo; } >> "$STUB_DIR/gcloud.stdin" ;;
  # A new service account is not usable at once.
  "secrets add-iam-policy-binding"*)
    [[ -e "$STUB_DIR/bound" ]] || { touch "$STUB_DIR/bound"; echo "service account does not exist" >&2; exit 1; } ;;
esac
EOF
cat > "$work/bin/docker" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$STUB_DIR/docker.args"
EOF
printf '#!/bin/sh\n' > "$work/bin/sleep"
chmod +x "$work/bin/gcloud" "$work/bin/docker" "$work/bin/sleep"

export PATH="$work/bin:$PATH" GOOGLE_CLOUD_PROJECT=demo-project GOOGLE_CLOUD_REGION=us-central1 \
  K_SERVICE=motherduck-dive-chat APP_DIR="$work/app" \
  IMAGE_URL=us-central1-docker.pkg.dev/demo-project/cloud-run-source-deploy/motherduck-dive-chat \
  SERVICE_URL=https://motherduck-dive-chat-abc123-uc.a.run.app

# The button runs each hook as: bash -c "set -euo pipefail; set -x; <command>" in the app directory.
run_hook() { (cd "$app_dir" && bash -c "set -euo pipefail; set -x; $1") >> "$work/output" 2>&1; }

values=(typed-app-token-1111 typed-embed-token-2222 typed-chat-token-3333 typed-aws-id-4444 typed-aws-secret-5555)
run_hook ./button/prebuild.sh
printf '%s\n' "AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY" "${values[@]}" | run_hook ./button/precreate.sh
run_hook ./button/postcreate.sh

failures=0
check() { if grep -qF -- "$2" "$work/$1"; then :; else echo "Missing from $1: $2" >&2; failures=$((failures + 1)); fi; }
absent() { if grep -qF -- "$2" "$work/$1"; then echo "Secret value found in $1" >&2; failures=$((failures + 1)); fi; }

# Two generated values (SESSION_SECRET and CRON_SECRET) and the five typed ones went in on stdin.
[[ "$(grep -cE '^[0-9a-f]{64}$' "$work/gcloud.stdin")" == 2 ]] || { echo "Expected two generated secrets." >&2; failures=$((failures + 1)); }
{ printf '%s\n' "${values[@]}"; grep -E '^[0-9a-f]{64}$' "$work/gcloud.stdin"; } > "$work/values"
while IFS= read -r value; do
  check gcloud.stdin "$value"
  absent gcloud.args "$value"
  absent output "$value"
done < "$work/values"

check docker.args "tag ghcr.io/leonardovida/motherduck-dive-ai-chat-starter:latest $IMAGE_URL"
check gcloud.args "secrets versions add motherduck-dive-chat-MOTHERDUCK_CHAT_TOKEN"
check gcloud.args "secrets add-iam-policy-binding motherduck-dive-chat-AWS_SECRET_ACCESS_KEY --project demo-project --member serviceAccount:motherduck-dive-chat-app@demo-project.iam.gserviceaccount.com --role roles/secretmanager.secretAccessor"
check gcloud.args "AWS_SECRET_ACCESS_KEY=motherduck-dive-chat-AWS_SECRET_ACCESS_KEY:latest"
check gcloud.args "--update-env-vars APP_URL=https://motherduck-dive-chat-123456789012.us-central1.run.app"
check gcloud.args "--max-instances 2"
check gcloud.args "--schedule 17 4 * * * --time-zone Etc/UTC"
check gcloud.args "--schedule 0 8 * * 1 --time-zone Etc/UTC"
check gcloud.args "--args deploy/cron.mjs,/api/cron/daily"
check gcloud.args "--args deploy/cron.mjs,/api/cron/digest"
check gcloud.args "--uri https://run.googleapis.com/v2/projects/demo-project/locations/us-central1/jobs/motherduck-dive-chat-cron-digest:run --oauth-service-account-email motherduck-dive-chat-sched@demo-project.iam.gserviceaccount.com"

if (( failures )); then
  echo "--- gcloud arguments" >&2; cat "$work/gcloud.args" >&2
  exit 1
fi
echo "The button hooks passed."
