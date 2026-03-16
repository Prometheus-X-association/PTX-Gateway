#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

MODE="${1:-local}"
shift || true

print_help() {
  cat <<'EOF'
Usage:
  scripts/start-stack.sh local [options]
  scripts/start-stack.sh aws-local [options]
  scripts/start-stack.sh aws-remote [options]

Modes:
  local      Local laptop/dev: frontend + local Supabase (DB/Auth/Functions/Email via Mailpit).
  aws-local  AWS VM/server: frontend on 0.0.0.0 + local Supabase stack.
  aws-remote AWS VM/server: frontend only, uses remote Supabase project.

Forwarded options:
  --reset-db
  --frontend-port <n>
  --host <host>
  --no-install
  --no-stop-on-exit
  -h, --help

Examples:
  scripts/start-stack.sh local
  scripts/start-stack.sh aws-local --frontend-port 8080
  scripts/start-stack.sh aws-remote --frontend-port 8080
EOF
}

case "$MODE" in
  local)
    bash scripts/run-all.sh local "$@"
    ;;
  aws-local)
    bash scripts/run-all.sh server --with-supabase "$@"
    ;;
  aws-remote)
    bash scripts/run-all.sh server --no-supabase "$@"
    ;;
  -h|--help)
    print_help
    ;;
  *)
    echo "Unknown mode: $MODE"
    print_help
    exit 1
    ;;
esac
