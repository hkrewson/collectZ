#!/usr/bin/env bash
set -euo pipefail

compose_file="ops/monitoring/docker-compose.monitoring.yml"
prometheus_marker="/prometheus/collectz-persistence-check.txt"
grafana_marker="/var/lib/grafana/collectz-persistence-check.txt"
marker_value="collectz-monitoring-persistence-$(date +%s)"

echo "Starting monitoring example stack..."
docker compose -f "$compose_file" up -d

echo "Writing persistence markers..."
docker compose -f "$compose_file" exec -T prometheus sh -lc "printf '%s\n' '$marker_value' > '$prometheus_marker'"
docker compose -f "$compose_file" exec -T grafana sh -lc "printf '%s\n' '$marker_value' > '$grafana_marker'"

echo "Recreating monitoring example stack without removing volumes..."
docker compose -f "$compose_file" down
docker compose -f "$compose_file" up -d

echo "Verifying markers survived recreate..."
prometheus_value="$(docker compose -f "$compose_file" exec -T prometheus sh -lc "cat '$prometheus_marker'")"
grafana_value="$(docker compose -f "$compose_file" exec -T grafana sh -lc "cat '$grafana_marker'")"

if [[ "$prometheus_value" != "$marker_value" ]]; then
  echo "Prometheus persistence marker mismatch: expected '$marker_value' got '$prometheus_value'" >&2
  exit 1
fi

if [[ "$grafana_value" != "$marker_value" ]]; then
  echo "Grafana persistence marker mismatch: expected '$marker_value' got '$grafana_value'" >&2
  exit 1
fi

echo "Monitoring persistence rehearsal passed."
echo "Marker value: $marker_value"
