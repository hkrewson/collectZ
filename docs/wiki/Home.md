# collectZ Wiki

Start here for deployment and operations guidance.

## Pages

1. [Configuration and Use](./01-Configuration-and-Use.md)
2. [Environment Variables](./02-Environment-Variables.md)
3. [Docker Compose Setup](./03-Docker-Compose-Setup.md)
4. [Docker CLI and Portainer Deployment](./04-Docker-CLI-and-Portainer-Deploy.md)
5. [Portainer Stack Build](./05-Portainer-Stack.md)
6. [Versioning and Build Metadata](./06-Versioning-and-Build-Metadata.md)
7. [Release Roadmap](./07-Release-Roadmap.md)
8. [Backup and Restore](./08-Backup-and-Restore.md)
9. [Smoke Test Checklist](./09-Smoke-Test-Checklist.md)
10. [CI/CD and Registry Deploy](./10-CI-CD-and-Registry-Deploy.md)
11. [Spaces and Libraries Model](./11-Spaces-and-Libraries-Model.md)
12. [2.0 Migration Rehearsal Runbook](./12-Migration-Rehearsal-Runbook.md)
13. [Rate Limit Policy](./13-Rate-Limit-Policy.md)
14. [Engineering Delivery Policy](./14-Engineering-Delivery-Policy.md)
15. [Secrets and Rotation Runbook](./15-Secrets-and-Rotation-Runbook.md)
16. [Activity Triage Runbook](./16-Activity-Triage-Runbook.md)
17. [Release Go/No-Go Checklist](./17-Release-Go-No-Go-Checklist.md)
18. [Reader Feasibility Spike](./21-Reader-Feasibility-Spike.md)
19. [Logging and Observability Contract](./22-Logging-and-Observability-Contract.md)
20. [Metadata Normalization Cutover Plan](./23-Metadata-Normalization-Cutover-Plan.md)
21. [Personal Access Tokens](./25-Personal-Access-Tokens.md)
22. [Service Account Keys](./27-Service-Account-Keys.md)
23. [API Contract and OpenAPI](./28-API-Contract-and-OpenAPI.md)
24. [Metrics and Alerts](./29-Metrics-and-Alerts.md)
25. [Observability Triage Runbook](./30-Observability-Triage-Runbook.md)
26. [Observability Dashboard Spec](./31-Observability-Dashboard-Spec.md)
27. [Alert Rules Spec](./32-Alert-Rules-Spec.md)
28. [Prometheus and Grafana Integration Guide](./33-Prometheus-and-Grafana-Integration-Guide.md)
29. [Observability Baseline Tuning Log](./34-Observability-Baseline-Tuning-Log.md)
30. [Structured Log Export](./35-Structured-Log-Export.md)
31. [Loki and Promtail Structured Logs](./36-Loki-and-Promtail-Structured-Logs.md)
32. [Syslog Structured Logs](./37-Syslog-Structured-Logs.md)

## Default Admin Behavior (Important)

`init.sql` does not seed a default admin user.

First user registration on an empty database becomes admin automatically.

Use invite-based registration for all additional users after bootstrap.
