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

## Default Seeded Admin (Important)

`init.sql` currently includes an optional sample admin user row:

- Email: `admin@example.com`
- Intended password: `admin123`

If this row exists in your initialized database, first-run registration will require an invite token because at least one user already exists.

Use these docs to remove the seed user from a running stack and from `init.sql` for future clean deployments.
