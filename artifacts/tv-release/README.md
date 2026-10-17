# CollectZ 3.25.0 local release verification

Docker cache cleanup was explicitly approved and reclaimed 14.47 GB. Existing application images and data volumes were preserved.

| Check | Result |
| --- | --- |
| tvOS ad-hoc simulator suite | 17 passed, including real Core pairing, browse, detail, Back/focus restoration |
| TV API abuse and isolation | 55 passed |
| Core browser regression (CI-selected suite) | 31 passed |
| Core and control-plane runtime smoke | Both passed |
| Production compose cookie/header/version/anonymous checks | Passed |
| Identity certification | Passed through migration 123 |
| Runtime database role | 30/30 passed |
| Observability | 9/9 passed in isolated control-plane verification stack |
| Local backend/frontend images | Zero fixable critical vulnerabilities; CycloneDX SBOMs included |
| New TV backend commits / native repository secrets | No findings |
| CodeQL maintained-source analysis | 0 active findings (5 baseline/suppressed) |
| Full local release wrapper | 13 passed, 0 failed, 3 tooling/opt-in blocks; both runtime editions run separately |
| Full backend repository history secrets | FAILED: 16 historical credential-fingerprint evidence findings |

Image scans use the locally built `collectz-backend:ci` and `collectz-frontend:ci` images, not published multi-platform image digests. JSON reports record image identities and scanner metadata. Hosted CI must rerun against exact publish artifacts. The full-history report is redacted. Findings are in historical migration evidence from commits `6ca3cfad1406` and `7cdb071633c8`; current evidence does not retain fingerprints. No history rewrite or suppression was performed.

Native compile/archive results, screenshots, and distribution limitations are in the sibling `collectZ-tvos/docs/Verification.md`. This evidence does not authorize pushing, publishing, signing, or TestFlight upload. The mandatory history secret gate remains a release blocker.
