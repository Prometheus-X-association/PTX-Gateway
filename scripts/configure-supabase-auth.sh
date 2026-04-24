#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

MODE="${1:-local}"
shift || true

AWS_DOMAIN=""
AWS_SMTP_HOST=""
AWS_SMTP_PORT="587"
AWS_SMTP_USER=""
AWS_SMTP_PASS=""
AWS_SMTP_ADMIN_EMAIL=""
AWS_SMTP_SENDER_NAME="PTX Gateway"

usage() {
  cat <<'EOF'
Usage:
  scripts/configure-supabase-auth.sh local
  scripts/configure-supabase-auth.sh aws [options]

Modes:
  local  Generate local `.env.local` and `supabase/functions/.env` from running Supabase.
         If ngrok is running locally, the script can auto-detect forwarded URLs.
  aws    Generate `.env.supabase.aws.smtp` template for self-hosted Supabase SMTP/auth config.

AWS options:
  --domain <url>         Public app domain (example: https://gateway.example.com)
  --smtp-host <host>     SMTP host
  --smtp-port <port>     SMTP port (default: 587)
  --smtp-user <user>     SMTP username
  --smtp-pass <pass>     SMTP password
  --admin-email <email>  SMTP admin email (from address)
  --sender-name <name>   SMTP sender display name
  -h, --help             Show this help
EOF
}

get_ngrok_tunnel_url_for_port() {
  local port="$1"

  if ! command -v curl >/dev/null 2>&1; then
    return 0
  fi

  local tunnels_json
  tunnels_json="$(curl -fsS "http://127.0.0.1:4040/api/tunnels" 2>/dev/null || true)"
  if [[ -z "$tunnels_json" ]]; then
    return 0
  fi

  node -e '
const raw = process.argv[1];
const port = process.argv[2];
try {
  const parsed = JSON.parse(raw);
  const tunnels = Array.isArray(parsed.tunnels) ? parsed.tunnels : [];
  const match = tunnels.find((tunnel) => {
    const addr = String(tunnel?.config?.addr ?? "");
    const publicUrl = String(tunnel?.public_url ?? "");
    return (
      publicUrl.startsWith("https://") &&
      (
        addr === port ||
        addr === `http://localhost:${port}` ||
        addr === `http://127.0.0.1:${port}` ||
        addr === `localhost:${port}` ||
        addr === `127.0.0.1:${port}` ||
        addr.endsWith(`:${port}`)
      )
    );
  });
  if (match?.public_url) {
    process.stdout.write(String(match.public_url));
  }
} catch {
  process.exit(0);
}
' "$tunnels_json" "$port"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain)
      AWS_DOMAIN="${2:-}"
      shift 2
      ;;
    --smtp-host)
      AWS_SMTP_HOST="${2:-}"
      shift 2
      ;;
    --smtp-port)
      AWS_SMTP_PORT="${2:-}"
      shift 2
      ;;
    --smtp-user)
      AWS_SMTP_USER="${2:-}"
      shift 2
      ;;
    --smtp-pass)
      AWS_SMTP_PASS="${2:-}"
      shift 2
      ;;
    --admin-email)
      AWS_SMTP_ADMIN_EMAIL="${2:-}"
      shift 2
      ;;
    --sender-name)
      AWS_SMTP_SENDER_NAME="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      usage
      exit 1
      ;;
  esac
done

if [[ "$MODE" != "local" && "$MODE" != "aws" ]]; then
  usage
  exit 1
fi

random_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    dd if=/dev/urandom bs=32 count=1 2>/dev/null | xxd -p -c 256
  fi
}

is_wsl_runtime() {
  if [[ -n "${WSL_DISTRO_NAME:-}" || -n "${WSL_INTEROP:-}" ]]; then
    return 0
  fi

  if grep -qiE "(microsoft|wsl)" /proc/version 2>/dev/null; then
    return 0
  fi

  return 1
}

get_wsl_primary_ip() {
  local ip
  ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  if [[ -n "$ip" ]]; then
    printf '%s\n' "$ip"
    return 0
  fi
  return 1
}

upsert_env_line() {
  local file="$1"
  local key="$2"
  local value="$3"
  local escaped_value
  escaped_value="$(printf '%s\n' "$value" | sed -e 's/[\/&]/\\&/g')"

  if grep -qE "^${key}=" "$file"; then
    sed -i "s/^${key}=.*/${key}=${escaped_value}/" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

get_env_value() {
  local file="$1"
  local key="$2"
  if [[ ! -f "$file" ]]; then
    return 0
  fi
  grep -E "^${key}=" "$file" | head -n1 | cut -d'=' -f2-
}

ensure_env_value() {
  local file="$1"
  local key="$2"
  local default_value="$3"
  local current_value
  current_value="$(get_env_value "$file" "$key")"
  if [[ -n "${current_value}" ]]; then
    return 0
  fi
  upsert_env_line "$file" "$key" "$default_value"
}

if [[ "$MODE" == "local" ]]; then
  if ! command -v npx >/dev/null 2>&1; then
    echo "npx is required."
    exit 1
  fi

  local_status="$(npx supabase status 2>&1 || true)"
  if [[ -z "$local_status" ]]; then
    echo "Supabase local stack is not running. Start it first with: npx supabase start"
    exit 1
  fi

  api_url="$(printf '%s\n' "$local_status" | sed -n 's/^API URL:[[:space:]]*//p' | head -n1)"
  if [[ -z "$api_url" ]]; then
    api_url="$(printf '%s\n' "$local_status" | sed -n 's/.*Project URL[^h]*\(https\?:\/\/[^[:space:]]*\).*/\1/p' | head -n1)"
  fi
  publishable_key="$(printf '%s\n' "$local_status" | sed -n 's/^Publishable key: *//p' | head -n1)"
  if [[ -z "$publishable_key" ]]; then
    publishable_key="$(printf '%s\n' "$local_status" | sed -n 's/^anon key: *//p' | head -n1)"
  fi
  service_role_key="$(printf '%s\n' "$local_status" | sed -n 's/^service_role key: *//p' | head -n1)"
  if [[ -z "$service_role_key" ]]; then
    service_role_key="$(printf '%s\n' "$local_status" | sed -n 's/^Secret key: *//p' | head -n1)"
  fi

  # Fallback to existing local files when CLI output format differs.
  if [[ -z "$api_url" ]]; then
    api_url="$(get_env_value ".env.local" "VITE_SUPABASE_URL")"
  fi
  if [[ -z "$publishable_key" ]]; then
    publishable_key="$(get_env_value ".env.local" "VITE_SUPABASE_PUBLISHABLE_KEY")"
  fi
  if [[ -z "$service_role_key" ]]; then
    service_role_key="$(get_env_value "supabase/functions/.env" "SUPABASE_SERVICE_ROLE_KEY")"
  fi

  if [[ -z "$api_url" || -z "$publishable_key" || -z "$service_role_key" ]]; then
    echo "Failed to parse required values from `supabase status`."
    echo "Check output manually with: npx supabase status"
    exit 1
  fi

  # Auto-adapt localhost/127 Supabase URL when running inside WSL.
  # This helps Windows-host browsers reach the WSL-hosted Supabase API.
  if is_wsl_runtime; then
    wsl_ip="$(get_wsl_primary_ip || true)"
    if [[ -n "$wsl_ip" && "$api_url" =~ ^http://(127\.0\.0\.1|localhost):([0-9]+)$ ]]; then
      api_url="http://${wsl_ip}:${BASH_REMATCH[2]}"
      echo "WSL detected. Auto-selected frontend Supabase URL: ${api_url}"
    fi
  fi

  existing_frontend_url="$(get_env_value ".env.local" "VITE_SUPABASE_URL")"
  if [[ -n "${SUPABASE_URL_OVERRIDE:-}" ]]; then
    echo "Using SUPABASE_URL_OVERRIDE for frontend URL: ${SUPABASE_URL_OVERRIDE}"
    api_url="$SUPABASE_URL_OVERRIDE"
  elif [[ "${NGROK_AUTODETECT:-true}" == "true" ]]; then
    ngrok_supabase_url="$(get_ngrok_tunnel_url_for_port "54321" || true)"
    if [[ -n "$ngrok_supabase_url" ]]; then
      echo "Detected ngrok tunnel for local Supabase API: ${ngrok_supabase_url}"
      api_url="$ngrok_supabase_url"
    fi
  elif is_wsl_runtime && [[ -n "${existing_frontend_url}" ]] && [[ "${existing_frontend_url}" =~ ^http://(127\.0\.0\.1|localhost):([0-9]+)$ ]]; then
    wsl_ip="$(get_wsl_primary_ip || true)"
    if [[ -n "$wsl_ip" ]]; then
      api_url="http://${wsl_ip}:${BASH_REMATCH[2]}"
      echo "WSL detected. Replacing existing localhost frontend URL with: ${api_url}"
    fi
  elif [[ -n "${existing_frontend_url}" && "${PRESERVE_FRONTEND_SUPABASE_URL:-true}" == "true" ]]; then
    echo "Preserving existing .env.local VITE_SUPABASE_URL: ${existing_frontend_url}"
    api_url="$existing_frontend_url"
  fi

  if [[ ! -f ".env.local" ]]; then
    cat > .env.local <<EOF
VITE_SUPABASE_URL=$api_url
VITE_SUPABASE_PUBLISHABLE_KEY=$publishable_key
VITE_SUPABASE_PROJECT_ID=local
EOF
  else
    upsert_env_line ".env.local" "VITE_SUPABASE_URL" "$api_url"
    upsert_env_line ".env.local" "VITE_SUPABASE_PUBLISHABLE_KEY" "$publishable_key"
    upsert_env_line ".env.local" "VITE_SUPABASE_PROJECT_ID" "local"
  fi

  mkdir -p supabase/functions
  if [[ ! -f "supabase/functions/.env" ]]; then
    if [[ -f "supabase/functions/.env.example" ]]; then
      cp "supabase/functions/.env.example" "supabase/functions/.env"
    else
      touch "supabase/functions/.env"
    fi
  fi

  ensure_env_value "supabase/functions/.env" "PDC_EXECUTE_TOKEN_SECRET" "local-$(random_secret)"
  upsert_env_line "supabase/functions/.env" "SUPABASE_SERVICE_ROLE_KEY" "$service_role_key"
  ensure_env_value "supabase/functions/.env" "EMBED_TOKEN_SECRET" "local-$(random_secret)"
  if ! grep -qE '^PDC_BEARER_TOKEN=' "supabase/functions/.env"; then
    printf '%s\n' "PDC_BEARER_TOKEN=" >> "supabase/functions/.env"
  fi

  echo "Local auth/config files updated:"
  echo "  - .env.local"
  echo "  - supabase/functions/.env"
  if [[ "${NGROK_AUTODETECT:-true}" == "true" ]]; then
    ngrok_frontend_url="$(get_ngrok_tunnel_url_for_port "8080" || true)"
    if [[ -n "$ngrok_frontend_url" ]]; then
      echo "Detected ngrok tunnel for frontend: ${ngrok_frontend_url}"
      echo "OIDC callback URL: ${ngrok_frontend_url}/oidc/callback"
    fi
  fi
  echo "Local email testing inbox: http://127.0.0.1:54324"
  exit 0
fi

cat > .env.supabase.aws.smtp <<EOF
# Self-hosted Supabase auth + SMTP config (AWS/VM)
# Copy values into your Supabase self-host .env, then restart the Supabase auth container.

SITE_URL=${AWS_DOMAIN:-https://your-domain.example.com}
API_EXTERNAL_URL=${AWS_DOMAIN:-https://your-domain.example.com}
GOTRUE_SITE_URL=${AWS_DOMAIN:-https://your-domain.example.com}
GOTRUE_URI_ALLOW_LIST=${AWS_DOMAIN:-https://your-domain.example.com}/*

GOTRUE_MAILER_AUTOCONFIRM=false
GOTRUE_SMTP_HOST=${AWS_SMTP_HOST:-smtp.your-provider.com}
GOTRUE_SMTP_PORT=${AWS_SMTP_PORT}
GOTRUE_SMTP_USER=${AWS_SMTP_USER:-smtp-user}
GOTRUE_SMTP_PASS=${AWS_SMTP_PASS:-smtp-password}
GOTRUE_SMTP_ADMIN_EMAIL=${AWS_SMTP_ADMIN_EMAIL:-no-reply@your-domain.example.com}
GOTRUE_SMTP_SENDER_NAME=${AWS_SMTP_SENDER_NAME}
EOF

echo "Generated: .env.supabase.aws.smtp"
echo "Next steps:"
echo "  1) Merge these values into your Supabase self-host .env"
echo "  2) Restart auth/kong containers (or full stack)"
echo "  3) Verify invite/confirmation flow from your app"
