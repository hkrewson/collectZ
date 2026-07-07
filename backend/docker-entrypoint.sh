#!/bin/sh
set -eu

mkdir -p /app/uploads

if [ "$(id -u)" = "0" ]; then
  if ! chown -R node:node /app/uploads; then
    echo "collectZ backend startup failed: /app/uploads is not chown-able. Fix the mounted uploads volume ownership or permissions." >&2
    exit 1
  fi
  if ! chmod -R u+rwX,g+rwX /app/uploads; then
    echo "collectZ backend startup failed: /app/uploads permissions could not be made writable." >&2
    exit 1
  fi
  if ! su-exec node sh -c 'probe="/app/uploads/.collectz-write-probe"; : > "$probe" && rm -f "$probe"'; then
    echo "collectZ backend startup failed: /app/uploads is not writable by the node runtime user." >&2
    exit 1
  fi
  exec su-exec node "$@"
fi

if ! sh -c 'probe="/app/uploads/.collectz-write-probe"; : > "$probe" && rm -f "$probe"'; then
  echo "collectZ backend startup failed: /app/uploads is not writable by the current runtime user." >&2
  exit 1
fi

exec "$@"
