#!/usr/bin/env bash
set -euo pipefail

compose_file="ops/logging/docker-compose.loki.yml"
loki_marker="/loki/collectz-persistence-check.txt"
promtail_marker="/tmp/promtail/collectz-persistence-check.txt"
marker_value="collectz-loki-persistence-$(date +%s)"

echo "Starting Loki example stack..."
docker compose -f "$compose_file" up -d

echo "Writing persistence markers..."
docker compose -f "$compose_file" exec -T loki sh -lc "printf '%s\n' '$marker_value' > '$loki_marker'"
docker compose -f "$compose_file" exec -T promtail sh -lc "printf '%s\n' '$marker_value' > '$promtail_marker'"

echo "Recreating Loki example stack without removing volumes..."
docker compose -f "$compose_file" down
docker compose -f "$compose_file" up -d

echo "Verifying markers survived recreate..."
loki_value="$(docker compose -f "$compose_file" exec -T loki sh -lc "cat '$loki_marker'")"
promtail_value="$(docker compose -f "$compose_file" exec -T promtail sh -lc "cat '$promtail_marker'")"

if [[ "$loki_value" != "$marker_value" ]]; then
  echo "Loki persistence marker mismatch: expected '$marker_value' got '$loki_value'" >&2
  exit 1
fi

if [[ "$promtail_value" != "$marker_value" ]]; then
  echo "Promtail persistence marker mismatch: expected '$marker_value' got '$promtail_value'" >&2
  exit 1
fi

echo "Loki persistence rehearsal passed."
echo "Marker value: $marker_value"
