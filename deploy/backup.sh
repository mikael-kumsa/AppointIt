#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
env_file="${APP_ENV_FILE:-.env.production}"
if [[ ! -f "${env_file}" ]]; then
  echo "Missing ${env_file}." >&2
  exit 1
fi
mkdir -p backups
chmod 700 backups

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
destination="backups/appointit-${timestamp}.sql.gz"
export APP_ENV_FILE="${env_file}"
compose=(docker compose --env-file "${env_file}" -f compose.production.yml)

"${compose[@]}" exec -T postgres pg_dump -U appointit -d appointit --clean --if-exists | gzip -9 >"${destination}"
chmod 600 "${destination}"
find backups -type f -name 'appointit-*.sql.gz' -mtime +14 -delete
echo "Backup written to ${destination}"
