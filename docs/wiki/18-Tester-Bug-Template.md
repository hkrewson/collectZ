# Tester Bug Template

Use this template when reporting alpha/beta issues.

## Required Fields

- `Build version`: (example: `2.0.0-alpha.9+<sha>`)
- `Date/time`: (local timezone)
- `User role`: (`admin` / `user` / `viewer`)
- `Active library`: (exact library name shown in UI)
- `Page/section`: (Library, Import, Admin -> Members, etc.)

## Report Template

```text
Title:
Short summary of the issue.

Environment:
- Version:
- Browser:
- Device (desktop/mobile/tablet):
- User role:
- Active library:

Steps to Reproduce:
1.
2.
3.

Expected Result:

Actual Result:

Frequency:
- Always / Often / Sometimes / Once

Impact:
- Blocker / High / Medium / Low

Evidence:
- Screenshot(s):
- Console error(s):
- Relevant Activity Log entry (if available):
```

## Notes For Testers

- Include exact error text when available.
- For multi-library issues, include the source library and target library names.
- For permission issues, include the role you were signed in with and whether the action should have been allowed.
