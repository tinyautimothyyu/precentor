#!/usr/bin/env bash
# Pulls the :main images from ECR and, if they changed, redeploys the stack.
#
# Run every 2 minutes by deploy/systemd/precentor-autodeploy.timer (see
# docs/aws-deploy.md). Install a copy at /usr/local/bin/precentor-autodeploy rather
# than running it from the repo: this script checks out other commits, and a
# script that rewrites itself mid-run misbehaves.
#
#   precentor-autodeploy           # deploy only if ECR has something new
#   precentor-autodeploy --force   # redeploy what's in ECR now
set -euo pipefail

APP_DIR="${APP_DIR:-/home/deploy/precentor}"
cd "$APP_DIR"

dc() {
  docker compose -f docker-compose.prod.yml -f docker-compose.ecr.yml --env-file .env.prod "$@"
}

mapfile -t images < <(dc config --images | grep '/precentor-')
if [ "${#images[@]}" -ne 2 ]; then
  echo "Expected the web and frontend ECR images, got: ${images[*]:-none}" >&2
  exit 1
fi

image_ids() { docker image inspect -f '{{.Id}}' "${images[@]}" 2>/dev/null || true; }

before=$(image_ids)
dc pull --quiet web frontend
after=$(image_ids)

if [ "$before" = "$after" ] && [ "${1:-}" != "--force" ]; then
  exit 0
fi

rev=$(docker image inspect -f '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "${images[0]}")
if [ -z "$rev" ]; then
  echo "Image ${images[0]} has no org.opencontainers.image.revision label" >&2
  exit 1
fi

echo "Deploying $rev"

# Match docker-compose.prod.yml and deploy/Caddyfile to the commit the images were
# built from. .env.prod is gitignored, so it's untouched.
git fetch --quiet origin
git checkout --quiet --detach "$rev"

dc up -d --remove-orphans
docker image prune -f >/dev/null

domain=$(grep -E '^DOMAIN=' .env.prod | cut -d= -f2- || true)
if [ -n "$domain" ]; then
  if curl -fsS --retry 10 --retry-delay 3 --retry-all-errors "https://$domain/healthz" >/dev/null; then
    echo "Deployed $rev; https://$domain/healthz is OK"
  else
    echo "WARNING: deployed $rev but https://$domain/healthz is failing" >&2
    exit 1
  fi
else
  echo "Deployed $rev"
fi
