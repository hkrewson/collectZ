# Alert Rules Spec

This page defines the first concrete alert-rule artifact for `2.6.0`.

Rule file:

- `docs/alerts/collectz-alert-rules.yaml`

## Purpose

The thresholds in `docs/wiki/29-Metrics-and-Alerts.md` are intentionally human-readable.

This file translates those thresholds into an implementation-ready rule set so the next deployment step is mechanical instead of interpretive.

## Current Rule Coverage

### API

- high route-level `5xx` failure ratio
- elevated p95 latency by route

### Auth

- login failure spikes
- password reset consume failure spikes

### Imports

- repeated Plex import failures
- repeated Metron import failures
- queued sync jobs not draining
- running sync jobs staying elevated without completions

### Admin

- repeated admin mutation failures

## Rule Format

The file is written in a Prometheus-style rule-group format so it can be adapted to:

- Prometheus rule files
- Grafana managed alerts
- compatible alerting pipelines that accept PromQL-style expressions

It is a spec artifact, not a guaranteed plug-and-play deployment manifest for every stack.

## Labels and Annotations

Each alert includes:

- `severity`
- `category`
- optional provider labels for import rules
- `runbook` annotation pointing to:
  - `docs/wiki/30-Observability-Triage-Runbook.md`

## How To Use It

1. Start with the expressions as written.
2. Adapt them to the monitoring system you actually deploy.
3. Keep alert names stable so incidents and docs remain aligned.
4. Tune thresholds only after collecting baseline production data.

## Mapping

Reference documents:

- metrics and thresholds:
  - `docs/wiki/29-Metrics-and-Alerts.md`
- triage flow:
  - `docs/wiki/30-Observability-Triage-Runbook.md`
- dashboard panels:
  - `docs/wiki/31-Observability-Dashboard-Spec.md`

## Planned Follow-Up

Later work should add:

- severity tuning after baseline collection
- explicit escalation targets and paging policy
