# Docker CLI and Portainer Deployment

## Deploy with Docker CLI

On target host:

```bash
git clone <your-repo-url> collectZ
cd collectZ
cp env.example .env
# edit .env
docker compose --env-file .env pull
docker compose --env-file .env up -d
```

The public compose file is the homelab deployment stack and uses prebuilt images.

Release channel:

The public compose defaults to the GHCR `latest` images. Use `docker compose --env-file .env pull && docker compose --env-file .env up -d` to move to the current default homelab release. If you need an exact pinned version, edit the backend/frontend `image:` lines directly or layer a private compose override.

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
- `SESSION_SECRET`
- `INTEGRATION_ENCRYPTION_KEY`

Optional public settings are listed in `docs/wiki/48-Public-Homelab-Environment-Reference.md`.

## Post-Deploy Checks

1. Open app URL.
2. Register/login.
3. If admin tab exists, configure global integrations under `Admin Settings`.
4. Confirm non-admin users cannot access admin settings/users/invites.
