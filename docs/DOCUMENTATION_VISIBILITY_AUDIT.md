# Documentation Visibility Audit

First-pass audit date: 2026-05-19

This is a first-pass visibility classification for the current `docs/wiki` tree. It is based on filenames, headings, representative content reads, and a targeted scan for security, operational, roadmap, backlog, provider, and incident terms. It is not a complete secret scan or legal/proprietary review.

## Recommendation

Do not treat `docs/wiki` as a public GitHub wiki in its current form.

The directory is a maintainer knowledge base. It mixes user/operator documentation with internal roadmap history, release evidence expectations, incident runbooks, implementation contracts, and feature planning notes. Some of that is useful to publish after cleanup, but exposing the whole tree would also expose product direction, operational assumptions, internal recovery workflows, and stale planning context.

Recommended next steps:

1. Keep `docs/wiki` as maintainer documentation for now.
2. Create a separate public docs surface for user/operator docs, such as `docs/user` or GitHub Wiki pages generated from selected sanitized files.
3. Move only public-ready or sanitized copies into that public surface.
4. Keep roadmap, backlog, release closeout, incident, recovery, and implementation-contract docs private/internal unless intentionally published.
5. Run a real secret scan and manual hostname/domain/IP review before publishing any docs outside the repo's current visibility model.

## Visibility Classes

- `Public-ready`: safe in principle for user/operator documentation, assuming normal link and freshness checks.
- `Public with sanitization`: useful publicly, but should be reviewed for internal paths, hostnames, security posture, stale product names, examples that look real, or links into private docs.
- `Maintainer/private`: should remain internal unless rewritten into a public-safe summary.

## File Classification

| File | Class | Reason | Recommended action |
| --- | --- | --- | --- |
| `docs/wiki/01-Configuration-and-Use.md` | Public with sanitization | Useful operator guide, but includes account recovery and direct DB examples. | Split public usage docs from break-glass recovery notes. |
| `docs/wiki/02-Environment-Variables.md` | Public with sanitization | Useful config reference, but env/security examples need a pass for current names and safe placeholders. | Publish after placeholder and freshness review. |
| `docs/wiki/03-Docker-Compose-Setup.md` | Public-ready | General self-hosted setup guidance. | Candidate for public docs. |
| `docs/wiki/04-Docker-CLI-and-Portainer-Deploy.md` | Public-ready | General deployment flow and operator commands. | Candidate for public docs. |
| `docs/wiki/05-Portainer-Stack.md` | Public with sanitization | Useful, but contains operational bootstrap/recovery language. | Publish after separating recovery/admin notes. |
| `docs/wiki/06-Versioning-and-Build-Metadata.md` | Public-ready | Explains version display and build metadata. | Candidate for public docs. |
| `docs/wiki/07-Release-Roadmap.md` | Maintainer/private | Contains detailed milestone history, future planning, release evidence, risks, and internal gate status. | Keep internal; publish only curated changelog/release notes. |
| `docs/wiki/08-Backlog.md` | Maintainer/private | Unscheduled product planning and future direction. | Keep internal. |
| `docs/wiki/08-Backup-and-Restore.md` | Public-ready | General backup/restore runbook for self-hosted operators. | Candidate for public docs. |
| `docs/wiki/09-Smoke-Test-Checklist.md` | Public with sanitization | Useful for operators/testers, but includes internal activity names and invite-token flows. | Publish a simplified operator smoke checklist. |
| `docs/wiki/10-CI-CD-and-Registry-Deploy.md` | Public with sanitization | Useful release/deploy explanation, but mixes public image docs with internal CI gate policy. | Split public deployment docs from maintainer release gates. |
| `docs/wiki/11-Spaces-and-Libraries-Model.md` | Public with sanitization | Product model explanation, but marked planning and includes implementation history. | Rewrite as public concept docs if needed. |
| `docs/wiki/12-Migration-Rehearsal-Runbook.md` | Maintainer/private | Release/migration rehearsal procedure and evidence expectations. | Keep internal. |
| `docs/wiki/13-Rate-Limit-Policy.md` | Public-ready | Security posture reference that can help operators understand runtime behavior. | Candidate for public docs after freshness check. |
| `docs/wiki/14-Engineering-Delivery-Policy.md` | Maintainer/private | Internal delivery policy. | Keep internal. |
| `docs/wiki/15-Secrets-and-Rotation-Runbook.md` | Public with sanitization | Helpful operator security guidance, but includes detailed rotation order and incident response. | Publish a hardened operator version; keep compromise procedure internal if desired. |
| `docs/wiki/16-Activity-Triage-Runbook.md` | Maintainer/private | Internal activity schema and incident triage workflow. | Keep internal; expose user-facing activity docs separately. |
| `docs/wiki/17-Release-Go-No-Go-Checklist.md` | Maintainer/private | Internal release gate checklist. | Keep internal. |
| `docs/wiki/18-Tester-Bug-Template.md` | Public-ready | Suitable external tester template. | Candidate for public docs. |
| `docs/wiki/21-Reader-Feasibility-Spike.md` | Maintainer/private | Research spike and product boundary decisions. | Keep internal. |
| `docs/wiki/22-Logging-and-Observability-Contract.md` | Public with sanitization | Useful for self-hosters, but describes internal log fields and sensitive exclusions. | Publish after redaction/freshness review. |
| `docs/wiki/23-Metadata-Normalization-Cutover-Plan.md` | Maintainer/private | Internal cutover plan. | Keep internal. |
| `docs/wiki/24-Calibre-Web-Automated-Integration-Setup.md` | Public with sanitization | Integration setup could be useful, but appears older and includes credential flow details. | Review for current product support before publishing. |
| `docs/wiki/25-Personal-Access-Tokens.md` | Public-ready | User/operator-facing auth feature documentation. | Candidate for public docs. |
| `docs/wiki/26-Admin-Recovery-and-SMTP-Triage.md` | Maintainer/private | Break-glass admin recovery and token invalidation commands. | Keep internal; publish safer recovery overview only. |
| `docs/wiki/27-Service-Account-Keys.md` | Public with sanitization | Useful integration auth docs, but should be checked for scope/security wording. | Publish after review. |
| `docs/wiki/28-API-Contract-and-OpenAPI.md` | Public-ready | API contract guidance is appropriate for integrators. | Candidate for public docs. |
| `docs/wiki/29-Metrics-and-Alerts.md` | Public with sanitization | Useful for operators, but should be checked against current metrics and private assumptions. | Publish a sanitized operator version. |
| `docs/wiki/30-Observability-Triage-Runbook.md` | Maintainer/private | Incident triage workflow and operational assumptions. | Keep internal. |
| `docs/wiki/31-Observability-Dashboard-Spec.md` | Maintainer/private | Internal dashboard specification and incident recognition design. | Keep internal or publish as architecture summary. |
| `docs/wiki/32-Alert-Rules-Spec.md` | Maintainer/private | Internal alerting implementation spec. | Keep internal or publish a sanitized alerts reference later. |
| `docs/wiki/33-Prometheus-and-Grafana-Integration-Guide.md` | Public with sanitization | Useful self-hosted observability integration doc. | Publish after checking endpoints, examples, and assumptions. |
| `docs/wiki/34-Observability-Baseline-Tuning-Log.md` | Maintainer/private | Tuning log and release evidence history. | Keep internal. |
| `docs/wiki/35-Structured-Log-Export.md` | Public with sanitization | Useful operator feature docs, but includes collector/security assumptions. | Publish after redaction/freshness review. |
| `docs/wiki/36-Loki-and-Promtail-Structured-Logs.md` | Public with sanitization | Useful integration guide, but includes admin/password placeholders and local proof steps. | Publish after placeholder and topology review. |
| `docs/wiki/37-Syslog-Structured-Logs.md` | Public with sanitization | Useful operator integration docs. | Publish after topology/security review. |
| `docs/wiki/38-Convention-Scheduler-and-Provider-Spec.md` | Maintainer/private | Implementation spec with provider tokens, schema, and future feature design. | Keep internal; publish only feature docs after implementation. |
| `docs/wiki/39-Collectibles-Naming-Decision.md` | Public-ready | Product terminology decision can be public if still current. | Candidate for public docs. |
| `docs/wiki/39-Frontend-Design-Lab.md` | Maintainer/private | Internal design workbench and UI direction. | Keep internal. |
| `docs/wiki/40-2.8.0-UI-Review-Checklist.md` | Maintainer/private | Internal release/UI checklist. | Keep internal. |
| `docs/wiki/40-Event-Social-Planning-Foundation.md` | Maintainer/private | Feature foundation and implementation planning. | Keep internal. |
| `docs/wiki/41-Kavita-Integration-Setup.md` | Public with sanitization | Useful integration setup doc, but needs credential/URL and current behavior review. | Publish a cleaned user/operator version. |
| `docs/wiki/41-Personal-Sched-ICS-Sync.md` | Maintainer/private | Platform companion feature planning. | Keep internal. |
| `docs/wiki/42-Event-Social-Platform-Companion-Contract.md` | Maintainer/private | Implementation contract and platform boundary details. | Keep internal. |
| `docs/wiki/42-Kavita-Reader-Progress-Contract.md` | Maintainer/private | Deep provider contract, endpoint probes, and secret-handling boundary. | Keep internal; publish only user-facing capability summary. |
| `docs/wiki/43-Kavita-Chapter-Issue-Fanout-Contract.md` | Maintainer/private | Implementation contract for import behavior. | Keep internal. |
| `docs/wiki/43-Platform-Companion-ICS-Sync-Visibility.md` | Maintainer/private | Platform companion implementation details. | Keep internal. |
| `docs/wiki/44-Kavita-Workspace-Owned-Administration-Contract.md` | Maintainer/private | Administration/security contract. | Keep internal; publish an operator setup guide instead. |
| `docs/wiki/44-Platform-Companion-Offline-Event-Packet.md` | Maintainer/private | Platform companion feature contract. | Keep internal. |
| `docs/wiki/45-Event-Schedule-Catalog-Foundation.md` | Maintainer/private | Event catalog implementation foundation. | Keep internal. |
| `docs/wiki/45-Kavita-Metadata-Writeback-Contract.md` | Maintainer/private | Provider writeback contract and failure semantics. | Keep internal. |
| `docs/wiki/46-Plex-PMS-API-Modernization-Foundation.md` | Maintainer/private | Plex implementation plan, token handling, and migration scope. | Keep internal; publish operator Plex setup separately. |
| `docs/wiki/Home.md` | Public with sanitization | Current index links directly to internal/private documents. | Replace with a public docs index that links only public docs. |
| `docs/wiki/roadmap-tenancy-deferred.md` | Maintainer/private | Deferred roadmap/product planning. | Keep internal. |
| `docs/wiki/share-links-deferred.md` | Maintainer/private | Deferred feature planning. | Keep internal. |

## First-Pass Counts

- Public-ready: 9
- Public with sanitization: 17
- Maintainer/private: 26
- Total `docs/wiki` files reviewed: 52

## Immediate Cleanup Candidates

High-value public docs to extract first:

- Docker setup and deployment: `03`, `04`, selected `05`, selected `10`
- Configuration: selected `01`, `02`
- Backup/restore: `08-Backup-and-Restore`
- Auth and API: `25`, `27`, `28`
- Integrations: cleaned versions of Kavita, Plex, barcode/books, and observability docs

Docs to keep private by default:

- `07-Release-Roadmap.md`
- `08-Backlog.md`
- all release gate/checklist docs
- all migration, incident, recovery, and observability triage runbooks
- all provider implementation contracts and deferred roadmap notes

## Notes From Targeted Scan

The targeted scan found repeated references to:

- tokens, API keys, passwords, and secret rotation
- admin recovery and direct database operations
- internal/private provider framework decisions
- release risks, blocked gates, and CI-only evidence
- implementation contracts for Kavita, Plex, events, and platform companion work

Most references are hygiene-conscious and often explicitly say not to expose secrets. The issue is not that the docs appear to contain real plaintext secrets in this first pass. The issue is that the tree contains operational and product-planning material that should not automatically become public documentation.

