# Release Go/No-Go Checklist

This checklist is enforced for tagged release runs (`v*`) via CI preflight.

## Required Gates

All of the following must pass:

1. Secret scan.
2. Dependency vulnerability scan.
3. Migration check (including init parity + rehearsal evidence).
4. Compose smoke check.
5. RBAC regression check.
6. Image security scan + SBOM generation.

## Required Evidence Artifacts

Tagged runs must produce:

- `dependency-audit/backend-audit.json`
- `dependency-audit/frontend-audit.json`
- `init-parity-evidence/init-parity-evidence.json`
- `migration-rehearsal-evidence/migration-rehearsal-evidence.json`
- `sbom-cyclonedx/backend-sbom.cdx.json`
- `sbom-cyclonedx/frontend-sbom.cdx.json`
- `preflight-go-no-go.md`

If any required artifact is missing, release is **NO-GO**.

## Blocking Rule

Release publication is blocked when:

- any mandatory gate fails, or
- any mandatory evidence artifact is missing.

## Exception Process

Exceptions are not implicit. Follow:

- `docs/wiki/14-Engineering-Delivery-Policy.md` -> `Exception Process`

Any exception must include:

- documented risk,
- compensating controls,
- expiration/remediation target.
