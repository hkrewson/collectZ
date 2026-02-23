#!/usr/bin/env bash

# collectZ bootstrap preflight
# Safe helper: performs checks and prints next-step commands.
# It does NOT generate or overwrite application source files.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

info() { printf '%s\n' "$*"; }
warn() { printf 'WARN: %s\n' "$*" >&2; }
err() { printf 'ERROR: %s\n' "$*" >&2; }

required_env=(
  DB_PASSWORD
  REDIS_PASSWORD
  SESSION_SECRET
  INTEGRATION_ENCRYPTION_KEY
)

check_command() {
  local cmd="$1"
  local hint="$2"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    err "$cmd is not installed. $hint"
    return 1
  fi
  return 0
}

check_env_file() {
  if [[ ! -f .env ]]; then
    warn ".env is missing. Creating from env.example..."
    cp env.example .env
    warn "Created .env from env.example. Fill required secrets before startup."
  fi

  local missing=()
  for key in "${required_env[@]}"; do
    local value
    value="$(awk -F= -v k="$key" '$1==k {print substr($0, index($0,$2))}' .env | tail -n 1 || true)"
    if [[ -z "${value// /}" ]]; then
      missing+=("$key")
    fi
  done

  if (( ${#missing[@]} > 0 )); then
    warn "Required variables with empty values in .env: ${missing[*]}"
    warn "Generate secrets with: openssl rand -hex 32"
  fi
}

main() {
  info "================================"
  info "collectZ Setup Preflight"
  info "================================"

  check_command docker "Install Docker Desktop or engine first." || exit 1
  if ! docker compose version >/dev/null 2>&1; then
    err "docker compose is unavailable. Install Docker Compose v2."
    exit 1
  fi

  check_env_file

  mkdir -p backend/uploads

  info
  info "Preflight complete. Next steps:"
  info "1) Edit .env and set required secrets if still empty"
  info "2) Validate config:"
  info "   docker compose --env-file .env config >/dev/null"
  info "3) Start local source build:"
  info "   docker compose --env-file .env up -d --build"
  info
  info "Registry deploy (optional):"
  info "   docker compose -f docker-compose.registry.yml --env-file .env pull"
  info "   docker compose -f docker-compose.registry.yml --env-file .env up -d"
}

main "$@"
