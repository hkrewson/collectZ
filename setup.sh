#!/usr/bin/env bash

# collectZ bootstrap helper
# Guides first-run setup without overwriting existing configuration values.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

info() { printf '%s\n' "$*"; }
warn() { printf 'WARN: %s\n' "$*" >&2; }
err() { printf 'ERROR: %s\n' "$*" >&2; }

auto_generate=0
auto_start=0
assume_yes=0

required_env=(
  DB_PASSWORD
  SESSION_SECRET
  INTEGRATION_ENCRYPTION_KEY
)

usage() {
  cat <<'USAGE'
Usage: ./setup.sh [options]

Options:
  --generate-secrets  Fill missing required secrets without prompting.
  --start             Validate compose config, pull images, and start collectZ.
  --yes               Answer yes to setup prompts.
  -h, --help          Show this help.
USAGE
}

parse_args() {
  while (( $# > 0 )); do
    case "$1" in
      --generate-secrets)
        auto_generate=1
        ;;
      --start)
        auto_start=1
        ;;
      --yes)
        assume_yes=1
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        err "Unknown option: $1"
        usage
        exit 1
        ;;
    esac
    shift
  done
}

check_command() {
  local cmd="$1"
  local hint="$2"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    err "$cmd is not installed. $hint"
    return 1
  fi
  return 0
}

prompt_yes_no() {
  local prompt="$1"
  local default="${2:-n}"
  local answer

  if (( assume_yes == 1 )); then
    return 0
  fi

  if [[ ! -t 0 ]]; then
    [[ "$default" == "y" ]]
    return
  fi

  read -r -p "$prompt " answer
  answer="${answer:-$default}"
  [[ "$answer" =~ ^[Yy]$|^[Yy][Ee][Ss]$ ]]
}

get_env_value() {
  local key="$1"
  awk -v k="$key" '
    BEGIN { FS = "=" }
    $1 == k {
      sub(/^[^=]*=/, "")
      value = $0
    }
    END { print value }
  ' .env
}

set_env_value() {
  local key="$1"
  local value="$2"
  local tmp

  if grep -q "^${key}=" .env; then
    tmp="$(mktemp)"
    awk -v k="$key" -v v="$value" '
      BEGIN { FS = "=" }
      $1 == k { print k "=" v; next }
      { print }
    ' .env > "$tmp"
    mv "$tmp" .env
  else
    printf '\n%s=%s\n' "$key" "$value" >> .env
  fi
}

generate_secret() {
  openssl rand -hex 32
}

fill_missing_secrets() {
  local missing=("$@")
  if (( ${#missing[@]} == 0 )); then
    return 0
  fi

  if (( auto_generate == 0 )); then
    if ! prompt_yes_no "Would you like me to auto-create the missing secrets now? [y/N]" "n"; then
      warn "Required variables still need values in .env: ${missing[*]}"
      warn "Generate strong values with: openssl rand -hex 32"
      return 0
    fi
  fi

  check_command openssl "Install OpenSSL or fill the missing values manually." || exit 1

  for key in "${missing[@]}"; do
    set_env_value "$key" "$(generate_secret)"
  done

  info "Generated missing required values in .env: ${missing[*]}"
  info "Secret values were not printed."
}

check_env_file() {
  if [[ ! -f .env ]]; then
    info "We need a .env file. Creating one from env.example now."
    cp env.example .env
    info "Created .env."
  fi

  local missing=()
  for key in "${required_env[@]}"; do
    local value
    value="$(get_env_value "$key")"
    if [[ -z "${value// /}" ]]; then
      missing+=("$key")
    fi
  done

  if (( ${#missing[@]} > 0 )); then
    fill_missing_secrets "${missing[@]}"
  fi
}

start_stack() {
  info
  info "Validating docker compose config..."
  docker compose --env-file .env config >/dev/null

  info "Pulling collectZ images..."
  docker compose --env-file .env pull

  info "Starting collectZ..."
  docker compose --env-file .env up -d

  info
  docker compose --env-file .env ps
}

main() {
  parse_args "$@"

  info "================================"
  info "collectZ Setup"
  info "================================"

  check_command docker "Install Docker Desktop or engine first." || exit 1
  if ! docker compose version >/dev/null 2>&1; then
    err "docker compose is unavailable. Install Docker Compose v2."
    exit 1
  fi

  check_env_file

  mkdir -p backend/uploads

  if (( auto_start == 1 )) || prompt_yes_no "Would you like me to validate the config and start collectZ now? [y/N]" "n"; then
    start_stack
    info
    info "Open collectZ at:"
    info "  http://localhost:3000"
    return 0
  fi

  info
  info "Setup checks complete. Next steps:"
  info "1) Validate config:"
  info "   docker compose --env-file .env config >/dev/null"
  info "2) Pull and start collectZ:"
  info "   docker compose --env-file .env pull"
  info "   docker compose --env-file .env up -d"
  info "3) Open:"
  info "   http://localhost:3000"
}

main "$@"
