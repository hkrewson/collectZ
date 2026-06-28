#!/bin/sh
set -eu

runtime_env_file="/usr/share/nginx/html/runtime-env.js"

escape_js_string() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

cat > "$runtime_env_file" <<EOF
window.__COLLECTZ_RUNTIME_CONFIG__ = {
  VITE_API_URL: "$(escape_js_string "${VITE_API_URL:-/api}")",
  VITE_CSRF_COOKIE_NAME: "$(escape_js_string "${VITE_CSRF_COOKIE_NAME:-csrf_token}")",
  VITE_DEBUG: "$(escape_js_string "${VITE_DEBUG:-0}")"
};
EOF
