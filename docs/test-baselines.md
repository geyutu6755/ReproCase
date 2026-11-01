# Test-application baselines

Reusable scan baselines recorded against the independent test applications in
`audit/apps/` (all unrelated to the bundled demo site). Reproduce with:

```bash
node audit/audit-server.mjs 4650 audit/apps/hash-router
node audit/audit-server.mjs 4651 audit/apps/async-app
node audit/audit-server.mjs 4652 audit/apps/static-shop
node audit/audit-server.mjs 4660 audit/apps/react-app
node audit/audit-server.mjs 4661 audit/apps/vue-app
npx reprocase scan --url http://127.0.0.1:4650/ --out out-hash-router
# ... and so on for each port
```

Baselines recorded: 2026-11-01, ReproCase v0.2.2-pre, Windows 11 (Git Bash), Chromium headless 156.

## Framework applications (real runtimes, vendored offline)

### react-app (4660) — React 18.3.1 (UMD, real event system)

| Planted fault | Result |
| --- | --- |
| `ReactBoom` — uncaught exception inside a React `onClick` on the Deploy tab | ✅ detected, **verified stable 3/3**, 4-step path (tab switch via React state + click) |
| `missing-react-chart.png` — missing first-party asset on the Deploy tab | ✅ detected, **verified stable**, 2-step path |

1 page · 4 interactions · ~6s · 0 false positives · 0 false negatives.

### vue-app (4661) — Vue 3.4.38 (global build)

| Planted fault | Result |
| --- | --- |
| `VueBoom` — crash inside a Vue click handler | ✅ detected, reproduced **3/3 (stable)**; Vue reports handler errors via `console.error`, so ReproCase classifies it `suspected` (informational by design) — exactly the documented console-error semantics |
| `missing-vue-stock.png` — missing first-party asset on the Inventory view | ✅ detected, **verified stable**, 2-step path |

1 page · 3 interactions · ~11s · 0 false positives · 0 false negatives.

## Other applications

### hash-router (4650) — hash-routing SPA

| Planted fault | Result |
| --- | --- |
| `HashRouteBoom` — uncaught exception on a button that only exists inside the `#/logs` hash view | ✅ detected, **verified stable 3/3**, 4-step reproduction path (3 hash navigations + click) |
| Horizontal overflow injected by the Logs view | ✅ detected, **verified stable 3/3**, mobile viewport |

1 page · 4 interactions · ~8s · 0 false positives · 0 false negatives.

### async-app (4651) — slow async hydration

| Planted fault | Result |
| --- | --- |
| `HydrationBoom` — uncaught exception ~850 ms after load (700 ms hydration + 150 ms delay) | ✅ detected, **verified stable** (event-driven verification wait, no fixed sleep) |
| `missing-insights.png` — first-party image 404 injected after hydration | ✅ detected, **verified stable** |

1 page · 0 interactions · ~6s · 0 false positives · 0 false negatives.

### static-shop (4652) — classic four-page static site

| Planted fault | Result |
| --- | --- |
| `promotions.html` — internal link to a missing page | ✅ page-load-failure **verified** + broken-internal-link **verified** |
| `widget-photo.png` — broken product image | ✅ resource-load-failure **verified** |
| Control pages (`about.html`, `contact.html`) | ✅ zero findings (no false positives) |

5 pages · ~10s · 0 false positives · 0 false negatives.

## Known limitations (recorded, not hidden)

- Views rendered by timers longer than ~1 s after load can still be missed: the post-detection
  settle window is bounded (600 ms) to keep scan times sane. Real-user trade-off, revisited in v0.3.0.
- Views behind interaction chains deeper than `maxActionsPerPage` need the budget raised;
  candidate re-collection is capped at 5 rounds per page.
- pushState deep links require server-side fallback (healthy 200) to avoid load-failure findings
  for URLs the server genuinely cannot serve.
- Framework handler errors reported only via `console.error` (Vue) are classified
  `suspected` with measured stability — never promoted to `verified` faults.
