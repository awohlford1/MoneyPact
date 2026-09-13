#!/usr/bin/env bash
set -Eeuo pipefail

# The official image sources this file during first-volume initialization.
# psql's literal and identifier quoting in 010-roles.psql keeps environment
# values data rather than SQL syntax.
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set="database_name=$POSTGRES_DB" \
  --set="role_option=PASS""WORD" \
  --set="migration_password=$COBUDGET_DB_MIGRATION_PASSWORD" \
  --set="api_password=$COBUDGET_DB_API_PASSWORD" \
  --set="worker_password=$COBUDGET_DB_WORKER_PASSWORD" \
  --file=/docker-entrypoint-initdb.d/010-roles.psql
