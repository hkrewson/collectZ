# Security Policy

## Supported Versions

collectZ supports security fixes through release channels instead of long-lived backport branches by default.

| Channel / Version | Supported |
| --- | --- |
| Latest | Yes |
| Stable | Yes |
| Previous minor | Critical security fixes only, best effort |
| Older | No |

## Release Channels

- `latest` is the newest published release. It receives new features and fixes first.
- `stable` is the recommended homelab release. It trails `latest` until a release has passed CI, soaked in maintainer use for at least seven days, and has no known blocker open.
- Exact version tags such as `3.4.110` are immutable release pins.
- Moving minor tags such as `3.4` point to the newest published release in that minor line and are not the same as `stable`.

Security fixes are made against the current development line first, then released to `latest`. If `stable` is behind `latest` and affected by the issue, maintainers either promote a fixed `latest` release to `stable` or publish a targeted stable patch.

## Stable Promotion Criteria

A release is eligible for `stable` when:

- it has been published as `latest` for at least seven days,
- all release gates passed,
- the maintainer homelab has run it successfully,
- no known blocker or rollback issue is open.

## Reporting a Vulnerability

Please report suspected security vulnerabilities privately using GitHub Security Advisories.

Do not open a public issue for vulnerabilities involving authentication, secrets, user data, workspace isolation, file uploads, or integration credentials.
