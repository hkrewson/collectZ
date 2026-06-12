# Install and Update collectZ

This guide covers the public self-hosted path using prebuilt images from GHCR.

## Prerequisites

- Docker with Docker Compose
- A writable directory for `docker-compose.yml`, `.env`, and persistent Docker volumes
- Optional: a reverse proxy and HTTPS domain

## First Install

Copy the example environment and generate strong secrets:

```bash
cp env.example .env
openssl rand -hex 32
```

Set at minimum:

```text
DB_PASSWORD=
SESSION_SECRET=
INTEGRATION_ENCRYPTION_KEY=
```

Start the stack:

```bash
docker compose --env-file .env pull
docker compose --env-file .env up -d
```

Open `http://localhost:3000`.

The first successful registration on an empty install becomes the initial admin account.

## Updating

The public compose file uses the `latest` GHCR images by default.

```bash
docker compose --env-file .env pull
docker compose --env-file .env up -d
```

Check health and version:

```bash
curl http://localhost:3000/api/health
```

Release notes are available inside collectZ under Help.

## Backups Before Updating

Before updating a long-running install, back up:

- the Postgres volume or database dump
- uploaded media volume
- the current `.env`

Do not publish `.env` or database dumps. They contain secrets and private collection data.
