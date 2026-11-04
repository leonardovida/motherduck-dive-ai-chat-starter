#!/usr/bin/env bash
# Run on Google Cloud, before the build: the button cannot build this repository's root from
# deploy/gcp, so it copies the published image instead. The button then pushes it to Artifact
# Registry as $IMAGE_URL. A fork that publishes its own image to ghcr.io uses that one.
set -euo pipefail
set +x

upstream="ghcr.io/leonardovida/motherduck-dive-ai-chat-starter:latest"
source_image="$upstream"
remote="$(git -C "$APP_DIR" remote get-url origin 2>/dev/null || true)"
if [[ "$remote" =~ github\.com[:/]([^/]+)/([^/]+)$ ]]; then
  repo="${BASH_REMATCH[2]%.git}"
  source_image="ghcr.io/${BASH_REMATCH[1],,}/${repo,,}:latest"
fi

if ! docker pull "$source_image"; then
  echo "Could not pull $source_image. Using $upstream instead."
  source_image="$upstream"
  docker pull "$source_image"
fi
docker tag "$source_image" "$IMAGE_URL"
