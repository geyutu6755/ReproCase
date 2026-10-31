# [LOW] Horizontal overflow on mobile viewport

Reproduced by [ReproCase](https://github.com/geyutu6755/ReproCase) v0.1.1 (2026-10-31T17:18:00.795Z, scan of http://127.0.0.1:50536/).

## [LOW] [verified] Horizontal overflow on mobile viewport

- **Type:** `horizontal-overflow`
- **ID:** `fp-fba8bc59`
- **Status:** verified (confidence 100%)
- **Reproduction:** 3/3 independent verification attempts reproduced it (observed 2x during the crawl)
- **Page(s):** <http://127.0.0.1:50536/overflow.html>
- **Viewport:** mobile

**Evidence**

```text
overflow: scrollWidth=736px clientWidth=390px
offender: <div> right=736px width=720px <div class="wide-panel">720px fixed-width panel — overflows phones, fits desktops</div>
```

**Reproduction steps**

1. Open <http://127.0.0.1:50536/overflow.html> in a browser.
2. Observe the fault described above.

**Artifacts**

- Screenshot: `artifacts/screenshots/page-001.png`
- Screenshot: `artifacts/screenshots/page-002.png`
- Browser trace (open with `npx playwright show-trace artifacts/traces/trace-ae325f50.zip`): `artifacts/traces/trace-ae325f50.zip`
- Generated reproduction test: `generated-tests/reprocase-fp-fba8bc59-04.spec.ts`
