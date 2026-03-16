#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

MODE="${1:-local}"
shift || true

WITH_SUPABASE=""
RESET_DB="false"
NO_INSTALL="false"
STOP_ON_EXIT="true"
HOST=""
FRONTEND_PORT="8080"

print_help() {
  cat <<'EOF'
Usage:
  scripts/run-all.sh local [options]
  scripts/run-all.sh server [options]

Modes:
  local   Start local Supabase + frontend dev server (default).
          Also auto-generates `.env.local` and `supabase/functions/.env`.
  server  Start frontend dev server bound to 0.0.0.0 for remote access (AWS/dev VM).
          You can still include --with-supabase to run local backend on server.

Options:
  --with-supabase       Force start local Supabase backend.
  --no-supabase         Skip local Supabase backend.
  --reset-db            Run `supabase db reset` after starting backend.
  --no-install          Skip dependency installation checks.
  --host <host>         Frontend host bind (default: local=127.0.0.1, server=0.0.0.0).
  --frontend-port <n>   Frontend port (default: 8080).
  --no-stop-on-exit     Keep Supabase running when script exits.
  -h, --help            Show this help.

Examples:
  scripts/run-all.sh local
  scripts/run-all.sh local --reset-db
  scripts/run-all.sh server --host 0.0.0.0 --frontend-port 8080
  scripts/run-all.sh server --with-supabase --frontend-port 8080
EOF
}

if [[ "$MODE" != "local" && "$MODE" != "server" ]]; then
  print_help
  exit 1
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-supabase)
      WITH_SUPABASE="true"
      shift
      ;;
    --no-supabase)
      WITH_SUPABASE="false"
      shift
      ;;
    --reset-db)
      RESET_DB="true"
      shift
      ;;
    --no-install)
      NO_INSTALL="true"
      shift
      ;;
    --host)
      HOST="${2:-}"
      if [[ -z "$HOST" ]]; then
        echo "Missing value for --host"
        exit 1
      fi
      shift 2
      ;;
    --frontend-port)
      FRONTEND_PORT="${2:-}"
      if [[ -z "$FRONTEND_PORT" ]]; then
        echo "Missing value for --frontend-port"
        exit 1
      fi
      shift 2
      ;;
    --no-stop-on-exit)
      STOP_ON_EXIT="false"
      shift
      ;;
    -h|--help)
      print_help
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      print_help
      exit 1
      ;;
  esac
done

if [[ -z "$WITH_SUPABASE" ]]; then
  if [[ "$MODE" == "local" ]]; then
    WITH_SUPABASE="true"
  else
    WITH_SUPABASE="false"
  fi
fi

if [[ -z "$HOST" ]]; then
  if [[ "$MODE" == "local" ]]; then
    HOST="127.0.0.1"
  else
    HOST="0.0.0.0"
  fi
fi

if [[ "$NO_INSTALL" != "true" ]]; then
  if [[ ! -d node_modules ]]; then
    echo "Installing frontend dependencies..."
    npm install
  fi
fi

SUPABASE_STARTED="false"
SUPABASE_DB_PORT="54322"

detect_supabase_db_port() {
  local config_file="supabase/config.toml"
  local detected_port=""
  if [[ -f "$config_file" ]]; then
    detected_port="$(
      awk '
        /^\[db\]/ { in_db=1; next }
        /^\[/ { in_db=0 }
        in_db && /^[[:space:]]*port[[:space:]]*=/ {
          val=$0
          sub(/.*=[[:space:]]*/, "", val)
          gsub(/[[:space:]]/, "", val)
          gsub(/"/, "", val)
          print val
          exit
        }
      ' "$config_file"
    )"
  fi

  if [[ "$detected_port" =~ ^[0-9]+$ ]]; then
    SUPABASE_DB_PORT="$detected_port"
  fi
}

port_in_use() {
  local port="$1"

  if command -v ss >/dev/null 2>&1; then
    ss -ltn "sport = :${port}" 2>/dev/null | awk 'NR>1 {found=1} END {exit !found}'
    return $?
  fi

  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1
    return $?
  fi

  return 1
}

ensure_supabase_db_port_available() {
  if ! port_in_use "$SUPABASE_DB_PORT"; then
    return 0
  fi

  echo "Port ${SUPABASE_DB_PORT} is already in use. Checking for stale Docker containers..."
  npx supabase stop >/dev/null 2>&1 || true

  local stale_found="false"
  local non_supabase_found="false"
  mapfile -t containers < <(docker ps -a --filter "publish=${SUPABASE_DB_PORT}" --format '{{.ID}} {{.Names}}')

  if [[ "${#containers[@]}" -eq 0 ]]; then
    echo "Port ${SUPABASE_DB_PORT} is occupied, but Docker has no container publishing it."
    echo "Likely an orphaned docker-proxy. Restart Docker daemon, then retry:"
    echo "  sudo systemctl restart docker"
    return 1
  fi

  for row in "${containers[@]}"; do
    local id name
    id="${row%% *}"
    name="${row#* }"
    if [[ "$name" == supabase_* ]]; then
      stale_found="true"
      echo "Removing stale Supabase container: ${name} (${id})"
      docker rm -f "$id" >/dev/null 2>&1 || true
    else
      non_supabase_found="true"
      echo "Port ${SUPABASE_DB_PORT} is owned by non-Supabase container: ${name} (${id})"
    fi
  done

  if [[ "$non_supabase_found" == "true" ]]; then
    echo "Stop/remove the container above, or change your local Supabase DB port."
    return 1
  fi

  if [[ "$stale_found" == "true" ]]; then
    sleep 1
  fi

  if port_in_use "$SUPABASE_DB_PORT"; then
    echo "Port ${SUPABASE_DB_PORT} is still in use after cleanup."
    echo "Try restarting Docker daemon, then rerun the script:"
    echo "  sudo systemctl restart docker"
    return 1
  fi
}

start_supabase_with_recovery() {
  echo "Starting local Supabase services..."
  if npx supabase start; then
    return 0
  fi

  echo "Initial Supabase start failed. Attempting recovery (stop stale stack -> restart)..."
  npx supabase stop || true
  npx supabase start
}

if [[ "$WITH_SUPABASE" == "true" ]]; then
  if ! command -v npx >/dev/null 2>&1; then
    echo "npx is required to run Supabase CLI."
    exit 1
  fi

  if ! docker info >/dev/null 2>&1; then
    echo "Warning: Docker daemon is not accessible. Skipping local Supabase startup."
    echo "Frontend will still start, but local Supabase APIs will be unavailable."
    echo "Fix Docker access and rerun for full local stack."
    WITH_SUPABASE="false"
  fi
fi

if [[ "$WITH_SUPABASE" == "true" ]]; then

  if [[ ! -f "supabase/functions/.env" && -f "supabase/functions/.env.example" ]]; then
    echo "supabase/functions/.env not found. Creating from .env.example..."
    cp "supabase/functions/.env.example" "supabase/functions/.env"
    echo "Update supabase/functions/.env with real secret values before production use."
  fi

  detect_supabase_db_port
  echo "Using Supabase DB host port: ${SUPABASE_DB_PORT}"
  ensure_supabase_db_port_available
  start_supabase_with_recovery
  SUPABASE_STARTED="true"

  echo "Auto-configuring local auth/env files..."
  if ! bash scripts/configure-supabase-auth.sh local; then
    echo "Warning: auto-configure step failed. Continuing to start frontend."
    echo "You can run it manually later with: npm run setup:local-auth"
  fi

  if [[ "$RESET_DB" == "true" ]]; then
    echo "Resetting local database..."
    npx supabase db reset
  fi
fi

cleanup() {
  if [[ "$SUPABASE_STARTED" == "true" && "$STOP_ON_EXIT" == "true" ]]; then
    echo
    echo "Stopping local Supabase services..."
    npx supabase stop || true
  fi
}

trap cleanup EXIT INT TERM

echo "Starting frontend on http://${HOST}:${FRONTEND_PORT} ..."
echo "Press Ctrl+C to stop."
npm run dev -- --host "$HOST" --port "$FRONTEND_PORT"
