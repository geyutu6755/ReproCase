# Architecture

ReproCase is a deterministic, API-free pipeline: everything is based on observable browser
behaviour, never on guessed intent.

```
                 reprocase.config.json / CLI flags
                              │
                              ▼
                    ┌──────────────────┐
                    │  config loader   │  validation, defaults, authorization gate
                    └────────┬─────────┘   (non-local hosts require allowedDomains)
                             ▼
                    ┌──────────────────┐
                    │     Scanner      │  breadth-first crawl with hard budgets
                    │  (src/scanner.ts)│
                    └────┬────┬────────┘
        one fresh browser│    │plain HTTP re-check of
        context per page │    │every internal link
             ┌───────────┘    └───────────┐
             ▼                            ▼
   ┌───────────────────┐        ┌──────────────────┐
   │  per-page pass    │        │  link checker    │
   │  - pageerror      │        │  status >= 400   │
   │  - unhandledrej.  │        │  → broken links  │
   │  - console.error  │        └──────────────────┘
   │  - requestfailed  │
   │  - response >=400 │        observations carry:
   │  - overflow x2    │        evidence + click path + screenshot
   │  - safe exploration│
   └─────────┬─────────┘
             ▼
   ┌───────────────────┐
   │ FindingCollector  │  fingerprint = type|url|normalized-signature
   │ (src/findings.ts) │  dedupe, page-merge, observedCount
   └─────────┬─────────┘
             ▼
   ┌───────────────────┐
   │     Verifier      │  each finding: N attempts, fresh context each,
   │  (src/verify.ts)  │  replays the recorded click path
   └─────────┬─────────┘  verified = reproduced ≥ 1×, confidence = s/N
             ▼
   ┌───────────────────┐     ┌──────────────────────────────┐
   │  Test generator   │────▶│ generated-tests/*.spec.ts    │
   │(src/generate-tests)│    │ + playwright.config.mjs      │
   └─────────┬─────────┘     └──────────────────────────────┘
             ▼
   ┌───────────────────────────────────────────────────────┐
   │ Reporters: report.html (offline, data-embedded),      │
   │ result.json, issues.md + issues/<id>.md               │
   └───────────────────────────────────────────────────────┘
```

## Key design decisions

**Honest status model.** Every finding starts `suspected`; only the independent verification
pass promotes it to `verified` (reproduced ≥ 1× in N fresh-context attempts, confidence =
successes/attempts). `console-error` findings stay `suspected` forever — a reproduced
`console.error` is still only informational. The scan also records what it did **not** check.

**Fingerprint dedupe.** `type | page-URL | normalized signature` — e.g. the same broken logo on
five pages is one finding listing all five pages; the same exception message with different
whitespace is one finding. `observedCount` records how often a fingerprint was seen.

**ReproPlan as the single source of truth.** When an observation is captured, the collector
builds a declarative replay plan (page URL, expected message/status, click path, viewport).
The verifier and the Playwright test generator both execute that same plan — verification and
generated tests cannot drift apart.

**Read-only-first exploration.** Exploration clicks buttons only — `<a>` destinations are
traversed by the crawl queue, which keeps the action budget on interactive elements instead of
header navs. No form filling by default; dialogs always dismissed; candidates filtered by
visibility, form-proximity, popups/downloads and a risky-keyword deny-list
(pay/delete/submit/send/logout/...). The scan scope is pinned to the entry origin (host **and**
port). All budgets (pages, depth, actions, time, delay) are enforced in the crawl loop.

**Privacy.** Non-local hosts require an explicit `allowedDomains` entry (the authorization
gate). Trace capture defaults to `auto` = localhost only. Query parameters with sensitive
names are redacted before anything reaches a report. The HTML report is a single
self-contained file: data is embedded as escaped JSON and all rendering goes through
`textContent`, so findings cannot inject markup.

**Exit codes.** `0` clean / `1` findings / `2` broken run (bad config, unreachable entry).
`entryUnreachable` is both a finding in `result.json` and an exit-2 trigger.

## Generated tests: reproduction-first

Each generated spec asserts the fault is **still present**. While the bug exists the suite
passes (proving stable reproduction); after a fix it fails and the failure message tells the
developer to swap in the commented-out "after fix" assertion, converting the file into a
permanent regression guard. This keeps generated artifacts unambiguous: a passing run means
"the fault reproduces", not "everything is fine".

## Repository layout

```
src/
  cli.ts             commander-based entry (scan, demo)
  scanner.ts         crawl loop, per-page pass, budgets
  findings.ts        observations → fingerprint dedupe → findings
  verify.ts          independent re-verification
  generate-tests.ts  Playwright spec generator
  config.ts          schema validation + authorization gate
  dev-server.ts      static server for demo & tests (real 404s!)
  report/            html (self-contained), issue (markdown), write (bundle)
  util/              net helpers, in-page measurement/selection scripts, logging
examples/demo-site/  demo with 4 planted faults + 2 clean control pages
tests/               unit / integration (real browser) / e2e (CLI) / helpers
```

## The demo site as an executable spec

`examples/demo-site` intentionally contains: a click-triggered uncaught exception, an internal
link to a missing page, a mobile-only horizontal overflow, and a 404 image — plus two clean
control pages. The integration and e2e suites assert all four faults are found, the control
pages produce zero findings, and generated tests reproduce every fault through the real
Playwright runner.
