# FleetDM Docker Compose

This stack runs Fleet `4.89.2` with its required infrastructure dependencies:

- MySQL `8.4.8` with persistent storage
- Redis `7.4.5` with append-only persistence and authentication
- TLS terminated by Fleet with a mounted certificate and private key

MySQL and Redis are available only on the Compose network. Fleet is published on
host port `1337` by default. This is a single-node deployment suitable for a lab,
evaluation, or a small installation; larger production installations should use
managed, highly available MySQL and Redis services and multiple Fleet servers
behind a TLS-terminating load balancer.

## Configure

Run these commands from this directory. Replace `fleet.example.com` with the DNS
name that enrolled devices will use.

```sh
cp .env.example .env
openssl rand -base64 48 > secrets/mysql_root_password
openssl rand -base64 48 > secrets/mysql_password
openssl rand -base64 48 > secrets/redis_password
openssl rand -base64 32 > secrets/server_private_key
chmod 600 secrets/*

openssl ecparam -genkey -name prime256v1 -noout -out certs/fleet.key
openssl req -new -x509 -key certs/fleet.key -out certs/fleet.crt -days 365 \
  -subj "/CN=fleet.example.com" \
  -addext "subjectAltName=DNS:fleet.example.com"
chmod 600 certs/fleet.key
```

The generated certificate is self-signed and is intended only for initial testing.
For enrolled devices, replace it with a certificate whose SAN matches the public
Fleet hostname and whose full chain is trusted by those devices.

## Start and verify

```sh
docker compose up -d
docker compose ps
docker compose exec -T fleet \
  wget --no-check-certificate -qO- https://127.0.0.1:1337/healthz
```

Open `https://fleet.example.com:1337` (or the host and port mapped to this stack)
to finish Fleet's initial setup. Follow logs with:

```sh
docker compose logs -f fleet
```

## Operational notes

- Back up the `mysql_data` volume. Redis data and Fleet's vulnerability/log volumes
  are persistent, but MySQL is the authoritative application database.
- Keep `secrets/`, `certs/`, and `.env` out of source control. The local `.gitignore`
  protects their default paths.
- Pin changes to tested Fleet, MySQL, and Redis versions rather than switching to
  floating `latest` tags.
- To terminate TLS at an external proxy instead, remove the certificate mounts,
  set `FLEET_SERVER_TLS=false`, update the health check to HTTP, and publish Fleet
  only to the proxy network.

Sources: [Fleet reference architectures](https://fleetdm.com/docs/deploy/reference-architectures#infrastructure-dependencies),
[Fleet Docker Compose guide](https://fleetdm.com/guides/deploy-fleet-on-docker-compose), and
[Fleet server configuration](https://fleetdm.com/docs/configuration/fleet-server-configuration).
