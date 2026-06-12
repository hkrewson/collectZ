# Public Mirror Contract

The public collectZ repository is a clean mirror for people who want to install, update, inspect public setup files, and understand the published containers.

## Included

- `README.md`
- `SECURITY.md`
- `docker-compose.yml`
- `env.example`
- `setup.sh`
- public version metadata
- `docs/public/`

## Not Included

- private git history
- maintainer planning notes
- release-gate evidence
- local CI artifacts
- runtime/debug artifacts
- uploaded media
- private environment files
- application implementation source

The public mirror is generated from a private source-of-truth checkout only after local validation. The exported tree is scanned for known private paths, private workflow terms, and secret-like values before a clean public commit is created.

## Why the Source Is Not Mirrored Yet

The current app source still contains implementation vocabulary and internal maintenance surfaces that were not designed as public documentation. Publishing that source safely requires a separate public-source boundary pass, not a simple file copy.

Until that work is complete, the public repository should be treated as an install and support mirror for the published GHCR images.
