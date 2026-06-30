#!/bin/sh
set -eu

mkdir -p /app/uploads

if [ "$(id -u)" = "0" ]; then
  chown -R node:node /app/uploads 2>/dev/null || true
  exec su-exec node "$@"
fi

exec "$@"
