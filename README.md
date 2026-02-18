# collectZ

A containerized media collection app (VHS, Blu-ray, digital) with auth, roles, and admin-managed integrations.

## Quick Start

```bash
cp env.example .env
# set required values in .env
docker compose --env-file .env up -d --build
```

Required env values:

- `DB_PASSWORD`
- `REDIS_PASSWORD`
- `JWT_SECRET`
- `INTEGRATION_ENCRYPTION_KEY`

## Documentation (Wiki Style)

- [Wiki Home](docs/wiki/Home.md)
- [Configuration and Use](docs/wiki/01-Configuration-and-Use.md)
- [Environment Variables](docs/wiki/02-Environment-Variables.md)
- [Docker Compose Setup](docs/wiki/03-Docker-Compose-Setup.md)
- [Docker CLI and Portainer Deployment](docs/wiki/04-Docker-CLI-and-Portainer-Deploy.md)
- [Portainer Stack Build](docs/wiki/05-Portainer-Stack.md)
- [Versioning and Build Metadata](docs/wiki/06-Versioning-and-Build-Metadata.md)
- [Release Roadmap](docs/wiki/07-Release-Roadmap.md)
- [Backup and Restore](docs/wiki/08-Backup-and-Restore.md)
- [Smoke Test Checklist](docs/wiki/09-Smoke-Test-Checklist.md)
- [CI/CD and Registry Deploy](docs/wiki/10-CI-CD-and-Registry-Deploy.md)
