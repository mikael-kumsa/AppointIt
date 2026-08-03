#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
env_file="${APP_ENV_FILE:-.env.production}"

if [[ ! -f "${env_file}" ]]; then
  echo "Missing ${env_file}. Start from .env.production.example." >&2
  exit 1
fi

if grep -q "CHANGE_ME" "${env_file}"; then
  echo "Replace every CHANGE_ME value in ${env_file} before deploying." >&2
  exit 1
fi

export APP_ENV_FILE="${env_file}"
compose=(docker compose --env-file "${env_file}" -f compose.production.yml)
"${compose[@]}" config --quiet
"${compose[@]}" build --pull
"${compose[@]}" up -d --remove-orphans
"${compose[@]}" ps

echo "Waiting for the API health check..."
for _ in {1..30}; do
  if "${compose[@]}" exec -T api node -e "fetch('http://127.0.0.1:4201/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
    echo "AppointIt API is healthy."
    exit 0
  fi
  sleep 2
done

echo "API health check failed. Recent logs:" >&2
"${compose[@]}" logs --tail=100 api migrate >&2
exit 1
