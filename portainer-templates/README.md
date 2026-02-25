# Portainer Template Catalog

This folder is a starter repo structure for maintaining a merged Portainer app template list from:

- Portainer default templates (`v3`)
- Tom Chantler templates
- Your custom templates

## Structure

- `sources.json` remote template sources to aggregate
- `custom/templates.json` your local templates
- `scripts/build-templates.mjs` merge/build script
- `dist/templates.json` generated output for Portainer
- `dist/sources-report.json` build report (counts and errors)

## Build

Run from this folder:

```bash
npm run build
```

The script fetches all configured remote sources, loads your local custom templates, merges by template identity, and writes `dist/templates.json`.

## Portainer usage

Portainer consumes a single app-templates URL (set at startup with `--templates` or in `Settings -> App Templates`).
That means combining multiple catalogs (default + Tom Chantler + custom) should happen in this repo, and you publish one merged `templates.json`.

Use the raw URL to your generated `dist/templates.json` in this repo, for example:

`https://raw.githubusercontent.com/<org>/<repo>/<branch>/dist/templates.json`

Portainer also documents hosting your templates on a web server and pointing Portainer at that URL. GitHub raw URLs are usually the simplest option for a Git-based workflow.
If you set `--templates` at startup, Portainer documents this as a first-start configuration value.

## Add your own templates

Add templates under `custom/templates.json` in standard Portainer format:

```json
{
  "version": "3",
  "templates": []
}
```

Custom templates are loaded last, so they win on key collisions.

## Notes

- If Tom Chantler changes template URL/location, update it in `sources.json`.
- This scaffold can live inside another repo, or you can copy this folder into its own dedicated Git repository.
- `sources-report.json` captures fetch/parse issues; check it after each build.
