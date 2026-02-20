# Docker CLI and Portainer Deployment

## Deploy with Docker CLI

On target host:

```bash
git clone <your-repo-url> collectZ
cd collectZ
cp env.example .env
# edit .env
docker compose --env-file .env up -d --build
```

Versioned deploy (recommended):

```bash
APP_VERSION=1.6.5 \
GIT_SHA=$(git rev-parse --short HEAD) \
BUILD_DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ) \
docker compose --env-file .env up -d --build
```

Check:

```bash
docker compose --env-file .env ps
docker compose --env-file .env logs -f backend frontend db
```

## Deploy with Portainer (Git Repository Method)

1. In Portainer, go to `Stacks` -> `Add stack`.
2. Choose `Repository`.
3. Set repository URL and branch.
4. Set compose path: `docker-compose.yml`.
5. Add required environment variables in Portainer UI (or upload `.env`).
6. Deploy stack.

## Deploy with Portainer (Web Editor Method)

1. Open `docker-compose.yml` locally.
2. In Portainer `Stacks` -> `Add stack`, paste compose content.
3. Add env vars in `Environment variables` section.
4. Deploy the stack.

## Required Env in Portainer

Set these in stack environment:

- `DB_PASSWORD`
- `REDIS_PASSWORD`
- `SESSION_SECRET`
- `INTEGRATION_ENCRYPTION_KEY`
- `AUDIT_LOG_MODE` (recommended: `failures`, can use `mutations` during testing)

## Post-Deploy Checks

1. Open app URL.
2. Register/login.
3. If admin tab exists, configure global integrations under `Admin Settings`.
4. Confirm non-admin users cannot access admin settings/users/invites.
