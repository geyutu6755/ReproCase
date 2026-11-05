# Changelog

All notable changes to ReproCase are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [Semantic Versioning](https://semver.org/).

## [0.5.1] — 2026-11-06

GitHub Actions composite-action reliability release. Three real defects found by the
external-repo CI runs and code audit.

### Fixed

- fail-on-new input was declared but its env var never read (P1): the gate always used
  the new-findings gate regardless of the user setting. Now: true gates on new findings;
  false reports the diff without gating; invalid values produce an explicit error.
- Scan step exited 1, causing GitHub Actions to skip the gate step (P1): the scan step
  now completes on exit 0 or 1 (recording the verdict) and only exits 2 for environment
  errors. A new Final CI decision step evaluates scan verdict + gate conclusion in priority
  order (error > gate > findings > clean) and produces the final exit code.
- reprocase-ref SHA support was claimed but not implemented (P2): git clone --branch
  only works for tags/branches. Now: --branch first, then fallback to full clone + git
  checkout for SHAs, with an explicit error for unresolvable refs. The checked-out commit
  is verified and reported.
- npm install to npm ci for lockfile-reproducible installs; hashFiles guard prevents
  empty artifact upload.

### Verification

160/160 tests; npm audit 0; external repo validation (clean green, incident red, fix green,
honest-error green); four-OS CI matrix.

## [0.5.0] — 2026-11-05

Developer-workflow integration release: run ReproCase in your own GitHub Actions pipelines,
with honest exit-code semantics, baseline new-fault gating and privacy-stripped artifacts.

### Added

- **Composite action** `.github/actions/reprocase-scan`: runs a scan inside your job (same
  runner, so localhost test servers work), installs a pinned ReproCase ref (clone → `npm ci`
  → build → global install of the built package — global mode strips devDependencies, so
  install-time building fails), publishes a privacy-stripped report artifact (traces deleted
  before upload), and requires no secrets beyond artifact upload.
- **Baseline new-faults gate**: `compare-with` a committed `result.json`; first runs without a
  baseline skip the gate with a notice; coverage shrink marks resolutions *unconfirmed*; the
  gate fails on NEW findings (`fail-on-new`, default true) — verified against a real external
  repository ([reprocase-actions-demo](https://github.com/geyutu6755/reprocase-actions-demo)):
  clean scan green, incident commit red (2 verified faults + gate "2 new findings"), fix
  commit green.
- **Honest environment errors**: scanner exit 2 (unreachable URL, bad config) is annotated as
  an environment problem — never presented as a website verdict — and an external CI job
  asserts this contract.
- **`scan --detection-window-ms`**: CI-friendly async observation budget (verified end-to-end).
- **Cluster-aware issue markdown**: the combined GitHub-issue document groups
  js-exception/console-error findings by fault cluster with collapsed per-page member detail
  (landed from the preserved v0.3.0 takeover patch, now with a dedicated 5-case test suite).
- Package metadata: `bugs`/`homepage`; docs: GitHub Actions guide, architecture sections for
  aggregation/observation/components/CI, npm publishing readiness.

### Fixed

- Composite action install strategy (global mode devDependencies).
- Demo/CI pattern: background servers must be detached to survive workflow steps.

### Verification

137/137 tests (71 unit + 66 integration/e2e) incl. docs↔CLI consistency, CLI error-path UX,
report UX browser audit, framework apps, observation window and components suites; four-OS CI
matrix; external repository workflow verified on real GitHub runners (scan green, gated red,
honest-error contract green); npm audit 0.

## [0.4.0] — 2026-11-02

Lower the barrier to first install and adoption. No new detection rules and no UI
rebuild — this release fixes the deprecated test config, reconciles the supported
Node baseline, and makes installing/first-run one step shorter and self-consistent.

### Changed

- **Node.js baseline is now 22.** Node 18 (EOL Apr 2025) and Node 20 (EOL Mar 2026)
  reached End-of-Life and are no longer supported. `engines.node` is `>=22`, and the
  README (en/zh), `docs/installation.md`, `docs/compatibility.md` and the CI matrix now
  agree (CI-tested on the current LTS lines **22 and 24**). `reprocase doctor`'s Node
  check was updated to match (previously it accepted 18/20 while the package required
  them — a real inconsistency).
- **One-step source install.** Added `prepare: npm run build`, so `npm install` compiles
  `dist/`. This fixes `npm install -g github:geyutu6755/ReproCase#vX.Y.Z` (which
  previously shipped unbuilt TypeScript with no runnable `bin`) and removes the manual
  `npm run build` from the quick start. Verified: a clean source install rebuilds `dist/`
  and the CLI runs. Installing a released tarball or (future) npm package is unchanged.
- **Deprecated Vitest config removed.** `test.poolOptions` was dropped in Vitest 4;
  `poolOptions.forks.singleFork` becomes top-level `maxWorkers: 1` with per-file
  isolation left at its default, so test isolation and cross-platform behaviour are
  unchanged (suite 137/137, deprecation warning gone).

### Docs / presentation

- README screenshots refreshed from the current demo report rendered in real Chromium.
- Accuracy validated against an **independent** probe application (not the bundled demo):
  cross-page reliable clusters, lazy/async + unhandled-rejection detection, same-page
  de-duplication, out-of-scope/`mailto:`/`javascript:` links correctly ignored, risky
  buttons skipped (never clicked), forms untouched, and two scans reproducing the same
  finding set.

## [0.3.3] — 2026-11-01

Report attachment security follow-up plus CI action-runtime maintenance. No new
features.

### Security

- **Trace / screenshot attachments no longer accept hostile paths.** The v0.3.2
  link-scheme guard covered page/plan/member/header links but missed the
  attachment attributes: `report.html` set the trace anchor `href` and the
  screenshot `<img> src` from `result.json` values using only `encodeURI`, which
  does not strip schemes. A crafted / shared / older `result.json` opened as an
  offline report could therefore expose a clickable `javascript:` trace link
  (self-XSS) or a `data:` / path-traversal (`../`) image source. **Reproduced in
  Chromium, then fixed:** a single `safeArtifact()` check now admits only
  local-relative artifact paths — it rejects any scheme, protocol-relative
  `//host`, absolute path, backslash separator and `..` traversal — and is applied
  to the trace `href`/`download`, the screenshot `src` and the lightbox.
  Legitimate artifacts (`artifacts/traces/…zip`, `artifacts/screenshots/…png`)
  keep their normal working link / preview; attachments are not disabled.

### Maintenance (CI)

- **Actions moved to Node-24 runtime majors.** Node 20 was removed from
  GitHub-hosted runners on 2026-09-16; the pinned `actions/checkout@v4`,
  `setup-node@v4`, `upload-artifact@v4`, `configure-pages@v5` and `deploy-pages@v4`
  are Node-20 actions now force-run on Node 24. Upgraded to the minimal
  Node-24 majors verified from each action's own `action.yml` (`runs.using:
  node24`): `checkout@v5`, `setup-node@v5`, `upload-artifact@v6` (v5 is still
  node20), `configure-pages@v6`, `deploy-pages@v5`. `upload-pages-artifact` is a
  composite action and is unchanged. The project's Node **20 and 22** build/test
  matrix is preserved and CI was re-run on all four platforms.

### Tests

- Suite: **137 tests across 20 files** (was 136) — added a real-browser audit
  proving hostile trace/screenshot paths are neutralized while normal local
  artifacts still render.

## [0.3.2] — 2026-11-01

Post-release hardening: one security fix and one report-honesty fix. No new
features and no UI rebuild.

### Security

- **The HTML report no longer turns untrusted URLs into clickable links.**
  `report.html` assigned `result.json` values (finding page URL, cluster member
  URL, reproduction-plan URL, page-table URL, header target) directly to anchor
  `href`. The bundled scanner only emits `http(s)`, but the generator is a general
  renderer over an arbitrary `ScanResult`, so a crafted / shared / older /
  third-party `result.json` — opened as an offline report — could produce a
  `javascript:` or `data:` link that executes on click (self-XSS). Every dynamic
  link now passes an HTTP(S) scheme check and renders as non-clickable text if the
  URL is not `http(s)`; the header target is guarded server-side. Legitimate
  `http(s)` links are unchanged. A real-browser test asserts zero
  `javascript:`/`data:`/`file:` anchors while normal links still render.

### Changed

- **Trace links set honest expectations.** Playwright traces stay private and are
  still stripped from CI and GitHub Pages, but the report now labels the trace link
  as a *local* artifact and its tooltip states that traces are not included in
  hosted / public copies — so users no longer see a dead "download" for evidence
  that was intentionally removed.

### Tests

- Suite: **136 tests across 20 files** (was 132) — added a real-browser URL-safety
  audit, a header-URL guard test, and a trace-copy honesty test.

## [0.3.1] — 2026-11-01

Reliability and trust refinement. No new capabilities — this release corrects how the
v0.3.0 cross-page fault clusters are described and presented, so a report never claims a
proven shared root cause it has not actually established.

### Fixed

- **Fault clusters no longer over-claim.** Cross-page clusters that group by identical
  message with no distinguishing stack (signature quality `message-only`) are now
  rendered under a separate **"Possible duplicates"** heading, labelled
  `confidence: low · message only`, with an explicit note that the shared root cause is
  **NOT proven**. Clusters backed by a reliable normalized stack + message stay under the
  confirmed **"Cross-page clusters"** heading. A stack-bearing fault and a stack-less fault
  that print the same message are kept in separate keys and are never merged.
- **Lone faults are not "clusters".** `aggregateFindings` now only produces a cluster when a
  signature spans **two or more pages**. A single-page match previously surfaced as a
  one-member "cluster" (and, with the honesty labels, a misleading "possible duplicate" of
  one). Such faults remain complete in `findings`, which still drives `compare` and the
  per-finding report — no information is lost.
- **`issues.md` header accuracy.** The combined issue document no longer printed the first
  finding's verification-attempt count as a global "N independent browser runs" figure
  (attempts vary per finding). The header now states the verified/suspected meaning
  generically; every finding still lists its own reproduction ratio.

### Tests

- Real-browser (Chromium) regressions for the honest two-tier cluster labeling, the
  exploration authorization precedence (`deny > hard-dangerous > soft > click`, proving
  `exploration.allowSelectors` can never revive a hard-dangerous control), Markdown
  traceability of clustered findings, and CJK/emoji/markup escaping in the offline report.
- Strengthened aggregate guards (wrong-merge / miss-merge / lone-fault / deterministic ids).
  Suite: **132 tests across 20 files** (was 122 across 19).

## [0.3.0] — 2026-11-01

Real-site coverage and intelligent fault aggregation. Two P0 capabilities — cross-page fault
clustering and adaptive async observation — plus modern-component detection (shadow DOM,
same-origin iframes) and a report upgrade that ties scans together over time.

### Added

- **Cross-page fault clusters** (`clusters` in `result.json`, primary section in the HTML
  report): uncaught exceptions and console errors reached from several pages are grouped by a
  conservative root-cause signature — error category + normalized top stack frame (script +
  function) + message head. Different components with similar texts stay separate; stack-less
  findings fall back to a message-only key, marked `signatureQuality: "message-only"`. Every
  cluster keeps its original per-page findings (status, stability, click path, evidence)
  expandable in the report; the raw `findings` array is untouched for traceability.
- **Adaptive async-observation window** (`detection.windowMs` / `detection.maxWaitMs`,
  defaults 1500/5000 ms): combines in-page DOM mutations (MutationObserver), request activity
  and error events; observation ends early once the page is *sustainably* quiet (500 ms
  stillness — beat-race safe) and never waits beyond the hard cap. Pages that never go quiet
  (long polling, continuous animation) are flagged `observationTimedOut` per page and counted
  in `stats.observationTimeouts` — partially observed pages are reported, not hidden.
- **Open shadow DOM detection**: candidate collection, fault localization and overflow
  measurement traverse open shadow roots; selectors cross host boundaries (Playwright-piercing
  CSS). Verified end-to-end: a fault buried in a shadow component reproduces 3/3.
- **Same-origin iframe detection**: per-frame candidate collection, clicks and overflow inside
  frames whose URL is in scope; frame faults are attributed to the frame document (via stack)
  and verified by replaying on it directly. Cross-origin frames are logged as
  `skipped-off-scope` and never reported.
- **`scan --compare-with <result.json>`**: embeds a "Changes vs previous scan" section
  (new / resolved / persistent + coverage-shrink warning) into the main report and writes
  `compare.json` into the bundle.
- **Report upgrades**: stability filter, cluster view, compare section — all verified in a
  real browser (keyboard, desktop + mobile, no client-side errors).

### Fixed

- **Ambiguous CSS fallback locators** (found on real React/Vue apps): fallback selectors are
  now document-unique full structural paths — silent wrong-button clicks during exploration
  and replay are gone.
- **In-place view switching false negatives** (found on real React/Vue apps): candidates are
  re-collected after every non-navigating click (bounded 5/page), so controls that only exist
  after a framework state change are explored.
- **Verification matching** normalizes whitespace on both sides — stack newlines can no longer
  break a reproduction match.
- **Error attribution**: page errors land on the current page URL or the matching frame URL
  (stack-derived), with `line:col` suffixes stripped; cross-origin console/error traffic is
  suppressed and logged instead of leaking into findings.

### Verification

121/121 tests (68 unit + 53 integration/e2e) incl. new suites: aggregation semantics
(11), observation window (3), component detection (3), framework apps (2), docs↔CLI
consistency (7), report UX (7). Multi-application baselines updated
([docs/test-baselines.md](docs/test-baselines.md)). npm audit 0.

## [0.2.2] — 2026-11-01

User-adoption readiness and release-quality release. Focus: trusted distribution, real
cross-platform verification, framework coverage and honest public-facing documentation.

### Added

- **Real macOS and Windows CI** ([ci.yml](.github/workflows/ci.yml)): the full suite — CLI,
  real-browser scans, generated reproduction tests, CJK paths, npm pack install — now runs
  natively on `macos-latest` and `windows-latest` (Node 22) in addition to
  `ubuntu-latest` (Node 20 & 22). See [docs/compatibility.md](docs/compatibility.md).
- **Framework application baselines** ([docs/test-baselines.md](docs/test-baselines.md)):
  real React 18.3.1 and Vue 3.4.38 production runtimes (vendored offline with license headers)
  exercising in-place view switching. React `onClick` crashes are detected and verified with
  their full interaction path; Vue handler errors reported via `console.error` are measured
  stable 3/3 and honestly classified `suspected` (console-error semantics).
- **npm publishing readiness** ([docs/npm-publishing.md](docs/npm-publishing.md)): package name
  confirmed available, pack/bin/metadata/audit checklist verified, minimal executable publish
  steps documented. No npm release is claimed — no publish credentials exist for this project.
- Package metadata: `bugs` and `homepage` fields for registry and issue-tooling integration.

### Fixed

- **Locator stability (found on real React/Vue apps):** CSS fallback selectors are now
  document-unique (full structural path), fixing ambiguous `button` matches that silently
  clicked the wrong control during exploration and verification replay.
- **In-place view switching (found on real React/Vue apps):** candidate re-collection now runs
  after every non-navigating click (bounded 5/page) — controls that only exist after a React
  state change or Vue reactive update are explored. Previously only hash changes triggered
  re-collection, missing the most common SPA pattern (false negative).
- **Verification matching:** plan messages (whitespace-normalized at capture) are compared
  against raw console/pageerror text in normalized form, so stack newlines can no longer break
  a reproduction match.

### Verification

101 tests (65 unit + 36 integration/e2e) green; npm audit 0; four-OS CI matrix; framework
baselines 4/4 planted faults detected (3 verified + 1 console-error stable 3/3), 0 false
positives / 0 false negatives; full-artifact privacy sweep clean.

## [0.2.1] — 2026-11-01

User-experience polish and reliability release. No large new features — every change came from
actually using the product: fresh-user install runs, real-browser report audits, multi-application
scan baselines ([docs/test-baselines.md](docs/test-baselines.md)) and error-path exercises.

### Added

- **Hash-routing support:** same-page hash links (`#/views`) are explored as safe interactions;
  after a hash change the candidate list is re-collected (bounded to 5 re-collections) so
  controls injected by the new view are exercised. Reproduction steps keep accumulating across
  hash views.
- **Event-driven verification wait:** JS-fault verification waits for an in-page error flag
  (bounded 2 s) instead of a fixed sleep — faults that fire ~1 s after load (slow hydration)
  now verify reliably.
- **Bounded post-detection settle** (600 ms) per page so near-boundary async faults are observed
  before the browser context closes.
- **Compatibility matrix** ([docs/compatibility.md](docs/compatibility.md)) with honest
  real-pass / not-executed statuses, and reusable multi-application baselines
  ([docs/test-baselines.md](docs/test-baselines.md)).
- **Docs ↔ CLI consistency guard** (automated): every documented command/option must exist,
  README status must match the package version, CHANGELOG top entry must match, example config
  must validate with zero warnings, and every local documentation link must resolve.

### Fixed

- **Report UX (found by real-browser audit):** the pages table forced page-level horizontal
  overflow on phones (now a scrollable region); long unbroken tokens in titles/URLs overflowed
  the layout (`overflow-wrap: anywhere`); screenshot previews are keyboard-operable
  (Tab → Enter opens, Escape closes, ARIA dialog semantics).
- **CLI (found by error-path exercises):** `Chromium not installed` now prints the exact fix
  command instead of a raw stack; unwritable output directories name the directory and the
  `--out` remedy; Ctrl+C closes the browser and exits 130 deterministically; quoted option
  values (`--config "path"`) no longer produce doubled-quote path errors; the exit-code
  explanation for unreachable entries no longer claims "findings exist".
- **Docs:** README status sections, stale test counts and a dead documentation link corrected;
  the example config no longer triggers an unknown-key warning when copied.
- **Reliability:** hash-view findings no longer lose their click path (the D5 reset was
  incorrectly applied to same-page transitions); re-collection is bounded per page.

### Verification

99/99 tests (65 unit + 34 integration/e2e), npm audit 0, three-application baselines with
7/7 planted faults verified stable and 0 false positives / 0 false negatives, full-artifact
privacy sweep clean (traces remain private evidence and are stripped from CI/Pages uploads).

## [0.2.0] — 2026-11-01

Productization release: workflow commands, SPA-aware exploration, a three-tier interaction
policy, scan comparison and a report upgrade. Built on top of the v0.1.1 security fixes.

### Added

- **`reprocase init`** — writes a validated starter config; refuses to overwrite without `--force`.
- **`reprocase doctor`** — environment diagnostics (Node version, Chromium presence, config
  validity, scan-target reachability, output writability) with concrete `fix:` hints; exit `1`
  only on real failures.
- **`reprocase compare <baseline> <current>`** — diffs two scans by **stable fingerprint**
  (type + URL path + error signature); volatile ids, timestamps and query parameters are
  ignored. Resolved findings require the current scan to have covered their page — shrunk
  coverage is marked **unconfirmed**, never claimed as a fix. Emits `compare.json` and a
  self-contained `compare.html`; `--fail-on new|any` for CI.
- **SPA support:** same-document (`pushState`/`replaceState`) transitions no longer abandon the
  page — exploration continues through the remaining buttons and the final URL is queued as a
  deep-link check (server fallback required for 200s). Real navigations are distinguished via a
  document-load counter instead of URL-change heuristics alone.
- **Three-tier interaction policy:** hard-dangerous keywords (pay, delete, logout, submit, ...)
  are never clickable; soft keywords (run, execute, launch, install, order, cancel) are skipped
  unless the exact control is authorized via the new `exploration.allowSelectors` config;
  `exploration.denySelectors` excludes controls outright.
- **Exploration log:** every considered control is recorded (`explored`, `navigated`,
  `forbidden`, `skipped-risky`, `skipped-denied`, `not-covered`, `click-failed`,
  `skipped-off-scope`) and shipped in `result.json` + a report section — skipped and uncovered
  interactions are visible instead of silent.
- **Finding stability** (`stable` / `intermittent` / `unreproducible`) measured by the
  verification pass; steps record their locator strategy (`id` / `testid` / `aria-label` /
  `css-path`).
- **Report UX:** sort findings (severity / status / type / reproducibility), one-click
  **Copy issue text** per finding, exploration log section; stability chip on findings.
- **Evidence privacy:** CI and GitHub Pages workflows strip `artifacts/traces` before any
  upload; the report shows a review-before-sharing warning wherever traces/screenshots are
  attached (traces contain unredacted network traffic by design).
- npm pack verified end-to-end: tarball → isolated directory install → `npx reprocase` runs
  (`--version`, `init`, `demo`).

### Fixed

- Document observations use the **response URL as ground truth** — a race could attribute a
  404 page-load-failure to `about:blank` and suppress it via the scope guard (false negative).
- Out-of-scope hardening: observations from pages dragged outside the scan origin by redirects
  are suppressed and logged.

### Verification

82 tests (58 unit + 24 integration/e2e) including: SPA transition regression, coverage-aware
compare, init/doctor/pack end-to-end, red/green reproduction tests, full-artifact privacy sweep
(0 secrets in JSON/HTML/Markdown/specs), npm audit 0.

## [0.1.1] — 2026-11-01

Security-fix release. All changes were produced and verified by the
[independent v0.1.0 quality audit](docs/audit-2026-10-31-v0.1.0.md); the `v0.1.0`
tag and release remain unchanged as a historical record.

### Security

- **Scan scope leak (critical, D1):** a scan could visit and report on a *different* application
  that shares only the loopback host on another port (e.g. `localhost:3001` while scanning
  `localhost:3000`). The scan scope is now pinned to the entry URL's origin: same host **and**
  same port (`samePort`). Regenerate any reports that were produced against non-localhost
  targets with v0.1.0.
- **Secret leakage via repro plans and stack traces (critical, D7):** sensitive query parameter
  values (token, password, session, email, ...) were redacted in report display fields but
  leaked verbatim into `plan.url` and `evidence.stack` — reaching `result.json`, the HTML
  report, GitHub-Issue markdown and generated Playwright tests. URLs and free text are now
  redacted at the observation source (`redactSecretsInText`).
- **Evidence sharing restriction (D7 follow-up):** browser traces record raw network traffic
  (including unredacted URLs and query strings) and screenshots capture raw page content;
  neither can be reliably auto-redacted. The HTML report now carries an explicit
  "review before sharing publicly" warning wherever such artifacts are attached, the report
  footer states it, and README/docs call it out. Review evidence files before publishing any
  report.

### Fixed

- **Exploration coverage (high, D2/D6):** the explorer spent its action budget on navigational
  header links and left pages before exercising their buttons, causing systematic false
  negatives on realistic layouts. Exploration now clicks buttons only; `<a>` destinations are
  traversed by the crawl queue (`allowedActions.clickLinks` gates that traversal).
- **Cross-page attribution (high, D5):** faults observed on a navigation destination inherited
  the source page's click path, so verification replayed clicks that could not exist there and
  demoted reproducible faults to `suspected`.
- **Overflow replay (high, D8):** overflow verification and generated tests ignored recorded
  click steps, so interaction-injected overflow could not be reproduced.
- **Accuracy (low, D3):** page records show the final redirect-resolved URL.
- **Deps:** vitest 2 → 5 clears 6 npm-audit advisories (2 critical, dev-dependency only);
  `npm audit` reports 0 vulnerabilities. Full suite green on vitest 5.

### Still true (documented limitations)

- The risky-keyword deny-list is deliberately conservative: harmless buttons whose labels
  contain words like "run" are skipped (D4). Configurability is planned for v0.2.0.
- Forms are never exercised; authenticated pages are out of reach; third-party resource
  failures are observed but not reported.
- Trace archives cannot be auto-redacted — treat them (and screenshots) as sensitive by default.

### Verification

68/68 tests (50 unit + 18 integration/e2e incl. real-browser scans), red/green verification of
generated tests (GREEN 2/2 → RED 2/2 correctly failed → SWAP 2/2), full-artifact privacy sweep
(0 secrets in JSON/HTML/Markdown/specs; traces documented as restricted), npm audit 0.

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

[0.5.1]: https://github.com/geyutu6755/ReproCase/releases/tag/v0.5.1
[0.5.0]: https://github.com/geyutu6755/ReproCase/releases/tag/v0.5.0
[0.4.0]: https://github.com/geyutu6755/ReproCase/releases/tag/v0.4.0
[0.3.3]: https://github.com/geyutu6755/ReproCase/releases/tag/v0.3.3
[0.3.2]: https://github.com/geyutu6755/ReproCase/releases/tag/v0.3.2
[0.3.1]: https://github.com/geyutu6755/ReproCase/releases/tag/v0.3.1
[0.3.0]: https://github.com/geyutu6755/ReproCase/releases/tag/v0.3.0
[0.2.2]: https://github.com/geyutu6755/ReproCase/releases/tag/v0.2.2
[0.2.1]: https://github.com/geyutu6755/ReproCase/releases/tag/v0.2.1
[0.2.0]: https://github.com/geyutu6755/ReproCase/releases/tag/v0.2.0
[0.1.1]: https://github.com/geyutu6755/ReproCase/releases/tag/v0.1.1
[0.1.0]: https://github.com/geyutu6755/ReproCase/releases/tag/v0.1.0
