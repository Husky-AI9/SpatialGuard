#!/bin/sh
# One-container Railway preview: separate TwinForge and SpatialGuard processes
# still communicate over TwinForge's public HTTP API.  A production rollout can
# split these commands into independent services without changing that boundary.
set -eu

DATA_ROOT="${SPATIALGUARD_DATA_DIR:-/app/.data}"
mkdir -p "$DATA_ROOT"
export TWINFORGE_DB="${TWINFORGE_DB:-$DATA_ROOT/twinforge.sqlite3}"
export SPATIALGUARD_DB="${SPATIALGUARD_DB:-$DATA_ROOT/spatialguard.sqlite3}"
mkdir -p "$(dirname "$TWINFORGE_DB")" "$(dirname "$SPATIALGUARD_DB")"

# The engine creates its owner credential once on the mounted data directory.
# SpatialGuard reads only the owner token, and never its SQLite database.
python -m twinforge.cli init >/dev/null
if [ -z "${SPATIALGUARD_TWINFORGE_TOKEN:-}" ]; then
  export SPATIALGUARD_TWINFORGE_TOKEN="$(python -c "import json, os; from pathlib import Path; print(json.loads((Path(os.environ['TWINFORGE_DB']).parent / 'credentials.json').read_text())['owner_token'])")"
fi
export SPATIALGUARD_TWINFORGE_URL="${SPATIALGUARD_TWINFORGE_URL:-http://127.0.0.1:8000}"

cleanup() {
  kill "${SPATIALGUARD_API_PID:-}" "${SPATIALGUARD_WORKER_PID:-}" "${TWINFORGE_WORKER_PID:-}" "${TWINFORGE_API_PID:-}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

python -m uvicorn twinforge.api:create_app --factory --host 127.0.0.1 --port 8000 &
TWINFORGE_API_PID=$!
python -m twinforge.worker &
TWINFORGE_WORKER_PID=$!
python -m spatialguard_api.worker &
SPATIALGUARD_WORKER_PID=$!
python -m uvicorn spatialguard_api.api:create_app --factory --host 0.0.0.0 --port "${PORT:-8010}" &
SPATIALGUARD_API_PID=$!

wait "$SPATIALGUARD_API_PID"
