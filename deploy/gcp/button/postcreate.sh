#!/usr/bin/env bash
# Run on Google Cloud, after the service is created: connects the secrets, sets APP_URL, and
# schedules the two vercel.json crons as Cloud Run jobs started by Cloud Scheduler. See docs/deploy.md.
set -euo pipefail
set +x

# shellcheck source=/dev/null
source "$APP_DIR/.button-state"
project="$GOOGLE_CLOUD_PROJECT"
region="$GOOGLE_CLOUD_REGION"
service="$K_SERVICE"

number="$(gcloud projects describe "$project" --format='value(projectNumber)')"
app_url="https://${service}-${number}.${region}.run.app"
if (( ${#service} + ${#number} + 1 > 63 )); then app_url="$SERVICE_URL"; fi

refs=""
for name in $SECRET_NAMES; do refs="${refs:+$refs,}${name}=${PREFIX}-${name}:latest"; done

gcloud run services update "$service" --project "$project" --region "$region" \
  --service-account "$APP_ACCOUNT" --update-secrets "$refs" --update-env-vars "APP_URL=${app_url}" \
  --no-cpu-throttling --cpu-boost --timeout 300 --max-instances 2

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

scheduler_account="${service:0:24}-sched"
scheduler_email="${scheduler_account}@${project}.iam.gserviceaccount.com"
if ! gcloud iam service-accounts describe "$scheduler_email" --project "$project" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$scheduler_account" --project "$project" --display-name "MotherDuck Dive + AI Chat (scheduled jobs)"
fi

schedule_job() {
  local job="${service}-cron-$1" route="$2" schedule="$3"
  gcloud run jobs deploy "$job" --project "$project" --region "$region" --image "$IMAGE_URL" \
    --command node --args "deploy/cron.mjs,${route}" --set-env-vars "APP_URL=${app_url}" \
    --set-secrets "CRON_SECRET=${PREFIX}-CRON_SECRET:latest" --service-account "$APP_ACCOUNT" \
    --max-retries 1 --task-timeout 600s --memory 512Mi
  retry gcloud run jobs add-iam-policy-binding "$job" --project "$project" --region "$region" \
    --member "serviceAccount:${scheduler_email}" --role roles/run.invoker >/dev/null
  retry upsert_trigger "$job" "$schedule"
}
upsert_trigger() {
  local job="$1" schedule="$2" verb=create
  if gcloud scheduler jobs describe "$job" --project "$project" --location "$region" >/dev/null 2>&1; then verb=update; fi
  gcloud scheduler jobs "$verb" http "$job" --project "$project" --location "$region" \
    --schedule "$schedule" --time-zone "Etc/UTC" --attempt-deadline 320s --http-method POST \
    --uri "https://run.googleapis.com/v2/projects/${project}/locations/${region}/jobs/${job}:run" \
    --oauth-service-account-email "$scheduler_email"
}
schedule_job daily /api/cron/daily "17 4 * * *"
schedule_job digest /api/cron/digest "0 8 * * 1"

cat <<EOF

Done. Open ${app_url} and sign in with the administrator you created.
APP_URL is set to that address. Use it, not another Cloud Run URL, for sign-in and SSO.
EOF
