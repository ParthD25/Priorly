#!/usr/bin/env bash
set -euo pipefail
: "${PRIORLY_TEST_DATABASE_URL:?Set PRIORLY_TEST_DATABASE_URL to an isolated disposable PostgreSQL database.}"
psql "$PRIORLY_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f infra/postgres/tests/bootstrap.sql
psql "$PRIORLY_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f infra/postgres/001_priorly_schema.sql
psql "$PRIORLY_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f infra/postgres/tests/isolation.sql
