# [MEDIUM] First-party resource failed to load: http://127.0.0.1:50536/assets/missing-logo.png (HTTP 404)

Reproduced by [ReproCase](https://github.com/geyutu6755/ReproCase) v0.1.1 (2026-10-31T17:18:00.795Z, scan of http://127.0.0.1:50536/).

## [MEDIUM] [verified] First-party resource failed to load: http://127.0.0.1:50536/assets/missing-logo.png (HTTP 404)

- **Type:** `resource-load-failure`
- **ID:** `fp-ade7f67f`
- **Status:** verified (confidence 100%)
- **Reproduction:** 3/3 independent verification attempts reproduced it (observed 1x during the crawl)
- **Page(s):** <http://127.0.0.1:50536/broken-image.html>

**Evidence**

```text
http status: 404
resource: http://127.0.0.1:50536/assets/missing-logo.png
```

**Reproduction steps**

1. Open <http://127.0.0.1:50536/broken-image.html> in a browser.
2. Observe the fault described above.

**Artifacts**

- Screenshot: `artifacts/screenshots/page-003.png`
- Browser trace (open with `npx playwright show-trace artifacts/traces/trace-b39eefe8.zip`): `artifacts/traces/trace-b39eefe8.zip`
- Generated reproduction test: `generated-tests/reprocase-fp-ade7f67f-03.spec.ts`
