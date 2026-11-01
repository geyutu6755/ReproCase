# Test-application baselines

Reusable scan baselines recorded against the independent test applications in
`audit/apps/` (all unrelated to the bundled demo site). Reproduce with:

```bash
node audit/audit-server.mjs 4650 audit/apps/hash-router
node audit/audit-server.mjs 4651 audit/apps/async-app
node audit/audit-server.mjs 4652 audit/apps/static-shop
npx reprocase scan --url http://127.0.0.1:4650/ --out out-hash-router
npx reprocase scan --url http://127.0.0.1:4651/ --out out-async-app
npx reprocase scan --url http://127.0.0.1:4652/ --out out-static-shop
```

Baseline recorded: 2026-11-01, ReproCase v0.2.1-pre, Windows 11 (Git Bash), Chromium headless 156.

## hash-router (4650) — hash-routing SPA

| Planted fault | Result |
| --- | --- |
| `HashRouteBoom` — uncaught exception on a button that only exists inside the `#/logs` hash view | ✅ detected, **verified stable**, 4-step reproduction path (3 hash navigations + click) |
| Horizontal overflow injected by the Logs view | ✅ detected, **verified stable**, mobile viewport |

1 page · 4 interactions · ~8s · 0 false positives · 0 false negatives. The exploration log
records 3 `same-page hash navigation` entries.

## async-app (4651) — slow async hydration

| Planted fault | Result |
| --- | --- |
| `HydrationBoom` — uncaught exception ~850 ms after load (700 ms hydration + 150 ms delay) | ✅ detected, **verified stable** (event-driven verification wait, no fixed sleep) |
| `missing-insights.png` — first-party image 404 injected after hydration | ✅ detected, **verified stable** |

1 page · 0 interactions · ~6s · 0 false positives · 0 false negatives.

## static-shop (4652) — classic four-page static site

| Planted fault | Result |
| --- | --- |
| `promotions.html` — internal link to a missing page | ✅ page-load-failure **verified** + broken-internal-link **verified** |
| `widget-photo.png` — broken product image | ✅ resource-load-failure **verified** |
| Control pages (`about.html`, `contact.html`) | ✅ zero findings (no false positives) |

5 pages · ~10s · 0 false positives · 0 false negatives.

## Known limitations (recorded, not hidden)

- Views rendered by timers longer than ~1 s after load can still be missed: the post-detection
  settle window is bounded (600 ms) to keep scan times sane. Real-user trade-off, revisited in v0.3.0.
- Views behind interaction chains deeper than `maxActionsPerPage` need the budget raised.
- pushState deep links require server-side fallback (healthy 200) to avoid load-failure findings
  for URLs the server genuinely cannot serve.
