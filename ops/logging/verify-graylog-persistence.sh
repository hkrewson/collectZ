#!/usr/bin/env bash
set -euo pipefail

compose_file="ops/logging/docker-compose.graylog.yml"
mongo_marker="/data/db/collectz-persistence-check.txt"
opensearch_marker="/usr/share/opensearch/data/collectz-persistence-check.txt"
graylog_marker="/usr/share/graylog/data/collectz-persistence-check.txt"
marker_value="collectz-graylog-persistence-$(date +%s)"

echo "Starting Graylog example stack..."
docker compose -f "$compose_file" up -d

echo "Writing persistence markers..."
docker compose -f "$compose_file" exec -T mongodb sh -lc "printf '%s\n' '$marker_value' > '$mongo_marker'"
docker compose -f "$compose_file" exec -T opensearch sh -lc "printf '%s\n' '$marker_value' > '$opensearch_marker'"
docker compose -f "$compose_file" exec -T graylog sh -lc "printf '%s\n' '$marker_value' > '$graylog_marker'"

echo "Recreating Graylog example stack without removing volumes..."
docker compose -f "$compose_file" down
docker compose -f "$compose_file" up -d

echo "Verifying markers survived recreate..."
mongo_value="$(docker compose -f "$compose_file" exec -T mongodb sh -lc "cat '$mongo_marker'")"
opensearch_value="$(docker compose -f "$compose_file" exec -T opensearch sh -lc "cat '$opensearch_marker'")"
graylog_value="$(docker compose -f "$compose_file" exec -T graylog sh -lc "cat '$graylog_marker'")"

if [[ "$mongo_value" != "$marker_value" ]]; then
  echo "Mongo persistence marker mismatch: expected '$marker_value' got '$mongo_value'" >&2
  exit 1
fi

if [[ "$opensearch_value" != "$marker_value" ]]; then
  echo "OpenSearch persistence marker mismatch: expected '$marker_value' got '$opensearch_value'" >&2
  exit 1
fi

if [[ "$graylog_value" != "$marker_value" ]]; then
  echo "Graylog persistence marker mismatch: expected '$marker_value' got '$graylog_value'" >&2
  exit 1
fi

echo "Graylog persistence rehearsal passed."
echo "Marker value: $marker_value"
