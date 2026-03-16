#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

MODE="${1:-local}"

print_help() {
  cat <<'EOF'
Usage:
  scripts/stop-stack.sh local [options]
  scripts/stop-stack.sh aws-local [options]
  scripts/stop-stack.sh aws-remote [options]

Modes:
  local      Stop local frontend + local Supabase.
  aws-local  Stop server frontend + local Supabase.
  aws-remote Stop server frontend only (remote Supabase stays remote).

Options:
  --frontend-port <n>  Kill process listening on this frontend port.
                       If omitted, tries common dev ports (8080, 5173).
  --with-supabase      Force stop local Supabase even in aws-remote mode.
  --no-supabase        Skip stopping local Supabase.
  -h, --help           Show help.
EOF
}

if [[ "$MODE" == "-h" || "$MODE" == "--help" ]]; then
  print_help
  exit 0
fi

shift || true

FRONTEND_PORT=""
WITH_SUPABASE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --frontend-port)
      FRONTEND_PORT="${2:-}"
      if [[ -z "$FRONTEND_PORT" ]]; then
        echo "Missing value for --frontend-port"
        exit 1
      fi
      shift 2
      ;;
    --with-supabase)
      WITH_SUPABASE="true"
      shift
      ;;
    --no-supabase)
      WITH_SUPABASE="false"
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

case "$MODE" in
  local|aws-local)
    DEFAULT_SUPABASE="true"
    ;;
  aws-remote)
    DEFAULT_SUPABASE="false"
    ;;
  *)
    echo "Unknown mode: $MODE"
    print_help
    exit 1
    ;;
esac

if [[ -z "$WITH_SUPABASE" ]]; then
  WITH_SUPABASE="$DEFAULT_SUPABASE"
fi

kill_port_listener() {
  local port="$1"
  local killed="false"

  if command -v lsof >/dev/null 2>&1; then
    mapfile -t pids < <(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
    if [[ "${#pids[@]}" -gt 0 ]]; then
      echo "Stopping process(es) on port ${port}: ${pids[*]}"
      kill "${pids[@]}" 2>/dev/null || true
      sleep 1
      for pid in "${pids[@]}"; do
        if kill -0 "$pid" 2>/dev/null; then
          kill -9 "$pid" 2>/dev/null || true
        fi
      done
      killed="true"
    fi
  fi

  if [[ "$killed" == "false" ]] && command -v ss >/dev/null 2>&1; then
    mapfile -t pids < <(ss -ltnp "sport = :${port}" 2>/dev/null | awk -F'pid=' 'NR>1 {split($2,a,","); if (a[1] ~ /^[0-9]+$/) print a[1]}' | sort -u)
    if [[ "${#pids[@]}" -gt 0 ]]; then
      echo "Stopping process(es) on port ${port}: ${pids[*]}"
      kill "${pids[@]}" 2>/dev/null || true
      sleep 1
      for pid in "${pids[@]}"; do
        if kill -0 "$pid" 2>/dev/null; then
          kill -9 "$pid" 2>/dev/null || true
        fi
      done
      killed="true"
    fi
  fi

  if [[ "$killed" == "false" ]]; then
    echo "No listener found on port ${port}."
  fi
}

echo "Stopping frontend processes..."
if [[ -n "$FRONTEND_PORT" ]]; then
  kill_port_listener "$FRONTEND_PORT"
else
  kill_port_listener "8080"
  kill_port_listener "5173"
fi

# Best-effort cleanup for standalone function serve sessions.
if pgrep -f "supabase functions serve" >/dev/null 2>&1; then
  echo "Stopping standalone 'supabase functions serve' processes..."
  pkill -f "supabase functions serve" || true
fi

if [[ "$WITH_SUPABASE" == "true" ]]; then
  if command -v npx >/dev/null 2>&1; then
    echo "Stopping local Supabase services..."
    npx supabase stop || true
  else
    echo "npx is not available; skipping Supabase stop."
  fi
else
  echo "Skipping Supabase stop for mode '$MODE'."
fi

echo "Stack stop completed for mode: $MODE"
