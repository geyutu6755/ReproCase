# Changelog

All notable changes to ReproCase are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed — independent v0.1.0 audit ([report](docs/audit-2026-10-31-v0.1.0.md))

- **Scope leak (critical):** the scan could visit and report on a *different* application that
  shares only the loopback host on another port. The scan scope is now pinned to the entry
  URL's origin (host **and** port).
- **Exploration coverage (high):** the explorer spent its action budget on navigational header
  links and left pages before exercising their buttons, causing systematic false negatives on
  realistic layouts. Exploration now clicks buttons only; `<a>` destinations are traversed by
  the crawl queue.
- **Privacy (critical):** query strings containing secrets leaked into `result.json` through
  reproduction plans and stack traces. URLs and free text are now redacted at the observation
  source, covering findings, repro plans, generated tests and all reports.
- **Cross-page attribution (high):** faults observed on a navigation destination inherited the
  source page's click path, so verification replayed clicks that could not exist there and
  demoted reproducible faults to `suspected`.
- **Overflow replay (high):** overflow verification and generated tests ignored recorded click
  steps, so interaction-injected overflow could not be reproduced.
- **Accuracy (low):** page records now show the final redirect-resolved URL.
- **Deps:** vitest 2 → 5 clears 6 npm-audit advisories (2 critical, dev-dependency only);
  full suite green on vitest 5.

## [0.1.0] — 2026-10-31

First verified release.

### Added

- **Scanner**: breadth-first crawl in a real Chromium browser with hard budgets
  (pages, depth, actions per page, run timeout, request delay) and a fresh browser
  context per page.
- **Detectors**:
  - uncaught JS exceptions and unhandled promise rejections (`pageerror` + init-script capture)
  - page load failures (HTTP ≥ 400 and navigation/network errors)
  - first-party resource load failures (scripts, styles, images, ...)
  - broken internal links (every discovered link re-requested over plain HTTP)
  - horizontal overflow at desktop and mobile viewports with offending-element localisation
  - console errors (reported as informational, never promoted to verified)
- **Safe explorer**: read-only-first click exploration with visibility checks, form avoidance,
  popup/download avoidance, risky-keyword deny-list, dialog dismissal, and full click-path recording.
- **Verification**: every deduplicated finding is re-triggered N times (default 3), each attempt
  in a fresh browser context; `verified` / `suspected` status with confidence = successes/attempts.
- **Playwright test generator**: one runnable reproduction spec per verified finding
  (asserts the fault is present; includes the "after fix" regression assertion to swap in),
  plus a ready-to-run `playwright.config.mjs`.
- **Evidence store**: evidence screenshots per finding, Playwright traces (localhost targets by
  default), recorded reproduction steps.
- **Reports**: self-contained offline HTML report (severity/status/type filters, search,
  screenshots, steps, traces, pages table, explicit "not checked" section), machine-readable
  `result.json`, combined `issues.md` and per-finding GitHub Issue markdown.
- **CLI**: `reprocase scan` and `reprocase demo` with CI-friendly exit codes
  (`0` clean / `1` findings / `2` broken run) and `--fail-on` threshold.
- **Demo site** (`examples/demo-site`): four deterministic planted faults (click-triggered
  exception, missing page link, mobile-only overflow, 404 image) plus two clean control pages.
- **Safety & privacy**: localhost-only by default with explicit `allowedDomains` gate,
  sensitive query-parameter redaction, trace capture limited to localhost unless overridden.
- **Tests**: 49 unit tests, 2 real-browser integration tests (4 faults found / control pages
  clean), 5 CLI end-to-end tests including running the generated specs through the real
  Playwright runner.
- **CI**: GitHub Actions test matrix (Node 20/22) and a GitHub Pages workflow that publishes
  a live demo report generated on every push to `main`.

### Known limitations

- Forms are not exercised (read-only-first policy); authenticated pages are out of reach.
- Third-party resource failures are observed but intentionally not reported.
- No accessibility, performance, or visual-regression coverage beyond horizontal overflow.
- Single-browser (Chromium) at this stage; Firefox/WebKit untested.

[0.1.0]: https://github.com/geyutu6755/ReproCase/releases/tag/v0.1.0
