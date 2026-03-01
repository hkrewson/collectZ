# Reader Feasibility Spike (Comics + Digital Books)

## Goal
Evaluate whether a built-in reader should ship in v2.0 or remain optional behind a feature flag.

## Constraints
- Preserve current security posture (no unsafe file rendering/execution).
- Keep homelab deployment simple.
- Avoid broad format parser complexity in core v2.0 milestone.

## Candidate approaches

### 1) In-browser PDF first (lowest risk)
- Scope: render PDF-backed comic/book files only.
- Pros: simple, stable ecosystem, good browser support.
- Cons: excludes CBZ/CBR/EPUB until conversion/adapter exists.
- Risk: low.

### 2) Comic archive support (CBZ) with server-side unzip/index
- Scope: parse image sequence from CBZ and stream pages.
- Pros: common comic format, strong UX value.
- Cons: archive handling and pagination logic add complexity.
- Risk: medium.

### 3) Full mixed-format reader (PDF/CBZ/CBR/EPUB)
- Scope: broad format support.
- Pros: most complete long-term capability.
- Cons: significantly larger attack surface and maintenance cost.
- Risk: high.

## Recommendation for v2.0
- Keep reader **optional** and feature-flagged.
- Defer full mixed-format reader to post-2.0.
- If needed for RC demos, allow a **PDF-only preview** path behind flag with strict file-type validation.

## Security requirements (if enabled)
- Restrict allowed MIME/content signatures.
- Never execute embedded scripts/content.
- Enforce path traversal protections and bounded file size.
- Log reader open/failed events to activity/audit.

## Decision
For `2.0.0` stable: prioritize tracking/import/enrichment workflows. Reader remains optional and non-blocking.
