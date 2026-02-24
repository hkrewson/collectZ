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

## Default Admin Behavior (Important)

`init.sql` does not seed a default admin user.

First user registration on an empty database becomes admin automatically.

Use invite-based registration for all additional users after bootstrap.
