# collectZ Sizing Snapshot

This workflow captures non-secret runtime evidence that can be used to estimate hosted collectZ costs on DigitalOcean, AWS, or another container platform.

It is meant to answer:

- how much CPU and memory the current stack uses at rest or under a small probe
- how large Postgres and local uploads are
- how quickly unauthenticated HTTP probes respond
- which services are likely to drive hosting costs as usage grows

## Local Run

With the collectZ Docker stack running:

```bash
npm run ops:sizing
```

The default output goes to:

```text
artifacts/sizing/
```

Each run writes both JSON evidence and a short Markdown summary.

## Optional Load Probe

The load probe is intentionally simple and unauthenticated. It is useful for measuring edge/API health behavior, not full logged-in workflows.

```bash
npm run ops:sizing -- --load-concurrency=10 --load-duration=60 --load-path=/api/health
```

For realistic product sizing, run snapshots during:

- normal personal use
- a large import
- provider sync activity
- cover upload activity
- a small synthetic probe

Then compare the generated reports.

## Container Runner

Build the runner:

```bash
docker build -f ops/sizing/Dockerfile -t collectz-sizing .
```

Run it from the repo while mounting the Docker socket and workspace:

```bash
docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$PWD":/workspace \
  -w /workspace \
  collectz-sizing
```

Use the same options as the local script:

```bash
docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$PWD":/workspace \
  -w /workspace \
  collectz-sizing --load-concurrency=10 --load-duration=60
```

## Evidence Hygiene

The snapshot stores aggregate counts and an allowlist of non-secret runtime settings only. It does not dump user records, integration keys, session secrets, database URLs, provider API keys, or request headers.

Review any report before sharing it outside the project, especially if you add custom probes later.

## Reading The Results

For hosted cost planning, the most important fields are:

- `containerSummary`: CPU, memory, and process headroom for frontend/backend/db containers
- `database.data.databaseBytes`: logical Postgres database size
- `disk.postgresDataBytes`: on-disk Postgres footprint
- `disk.backendUploadsBytes`: local upload footprint when using filesystem uploads
- `database.data.selectedExactCounts`: aggregate row counts for users, spaces, libraries, media, and activity log rows
- `loadProbe`: optional request rate and latency for an unauthenticated endpoint

Use these to model cost per active workspace, per 1,000 media records, and per GiB of uploaded assets.
