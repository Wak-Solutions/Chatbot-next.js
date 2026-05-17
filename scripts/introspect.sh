#!/usr/bin/env bash
#
# scripts/introspect.sh — pull the live production schema for reconciliation.
#
# NOT run during PR 2. This is the runbook artifact for the cutover phase
# (deployment-time), when DB access is available.
#
# Usage:
#   DATABASE_URL=postgres://... ./scripts/introspect.sh
#
# Output goes to ./drizzle/ alongside the baseline generated locally by
# drizzle-kit generate. Compare:
#   • column types (especially messages.conversation_id text vs uuid)
#   • column defaults
#   • UNIQUE constraint names (Drizzle's foo_email_unique vs Postgres'
#     implicit foo_email_key)
#   • indexes
# Reconcile by editing lib/db/schema.ts to match prod, then re-run
# `drizzle-kit generate`. The baseline at drizzle/0000_baseline.sql gets
# regenerated; the diff against the previous baseline should be empty
# when reconciliation is complete.

set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL must be set." >&2
  exit 1
fi

cd "$(dirname "$0")/.."
exec npx drizzle-kit introspect
