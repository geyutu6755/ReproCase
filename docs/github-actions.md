# GitHub Actions integration

ReproCase ships a reusable composite action at
[`.github/actions/reprocase-scan`](../.github/actions/reprocase-scan/action.yml).
It runs a scan **inside your job** (same runner, so `http://localhost` test servers work),
publishes a privacy-stripped report artifact, and can gate on **new** findings against a
committed baseline.

Requirements: Node.js 22 runner (default), Chromium installed by the action, **no third-party
API keys**, and the only permission it needs is the artifact upload your workflow grants.

## Quick start (push / manual)

```yaml
name: reprocase
on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read          # minimal; the action needs nothing more

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5

      # Build & serve YOUR site first — the action shares this runner.
      - uses: actions/setup-node@v5
        with:
          node-version: 22
      - run: npm ci && npm run build
      - name: Start site
        run: |
          npm run start &
          npx wait-on http://localhost:3000

      - name: ReproCase scan
        uses: geyutu6755/ReproCase/.github/actions/reprocase-scan@v0.5.0
        with:
          url: http://localhost:3000/
          fail-on: verified
          max-pages: 25
```

Pin the action to a released tag (`@v0.5.0`) or a commit SHA for supply-chain safety.

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `url` | *(required)* | Entry URL to scan. |
| `reprocase-ref` | the ref the action was pinned to | ReproCase version to install (tag/branch/SHA). |
| `config` | — | Path to a `reprocase.config.json` in your repo (overrides URL budgets). |
| `compare-with` | — | Path to a baseline `result.json` — enables the new-findings gate. |
| `fail-on` | `verified` | `verified` / `suspected` / `never` — which findings fail the step. |
| `fail-on-new` | `true` | With `compare-with`: fail when new findings exist vs the baseline. |
| `max-pages` | scanner default (25) | Crawl budget. |
| `detection-window-ms` | scanner default (1500) | Async observation window (higher = catches later hydration faults). |
| `report-name` | `reprocase-report` | Artifact name. |
| `node-version` | `22` | Node.js runtime for the scan. |

## Outputs

| Output | Values |
| --- | --- |
| `verdict` | `clean` (exit 0) · `findings` (exit 1) · `error` (exit 2) |
| `exit-code` | Raw scanner exit code |
| `new-findings` | Count of new findings vs baseline (empty without a baseline) |

## Exit-code semantics

| Code | Meaning | CI effect |
| --- | --- | --- |
| `0` | Scan completed, nothing at/above the threshold | step passes |
| `1` | Scan completed — findings at/above the threshold (a **verdict about your website**) | step fails, report artifact is still published |
| `2` | ReproCase could not run properly (bad config, unreachable URL, missing browser) | step fails with a `::error::` annotation stating this is an **environment problem, not a website verdict** |

An environment error never masquerades as "your site is fine" — the action fails loudly and
points at `reprocase doctor`.

## Baseline & new-fault gating

Commit a baseline once, then compare every run against it:

```yaml
      - name: ReproCase scan (gate on new faults)
        uses: geyutu6755/ReproCase/.github/actions/reprocase-scan@v0.5.0
        with:
          url: http://localhost:3000/
          compare-with: .reprocase/baseline/result.json
          fail-on-new: true
```

Behaviour:

- **Baseline missing** (first run / deleted file): the gate is skipped with a `::notice::`,
  the scan still runs and publishes its report — it becomes your baseline candidate.
- **Coverage shrank** (baseline visited pages the current scan did not): resolved entries are
  marked *unconfirmed*; the report shows the warning, and the gate never claims a fix it
  cannot prove.
- **Update the baseline deliberately**: after accepting a scan, copy its
  `result.json` into `.reprocase/baseline/` in a reviewed commit.

## Pull requests

The action runs the scan on the PR's merge commit inside your workflow job, so PR gating works
with the same snippet (`on: pull_request`), comparing against a baseline on `main`.

**PR comments:** ReproCase intentionally does not post PR comments. A comment bot needs a
token with write access in the PR's context, and for `pull_request_target`-style flows that
token must never be handed to untrusted PR code. If you want PR comments, use the safe
two-workflow pattern: your `pull_request` workflow uploads the report artifact, and a separate
`workflow_run` workflow (running with your own repo's permissions, not the PR's) downloads the
artifact and posts the comment. We deliberately keep that glue out of the action.

## Privacy

- Browser **traces record raw network traffic (including unredacted URLs)** — the action
  deletes `artifacts/traces` before the artifact upload. They never leave the runner.
- **Screenshots** capture your site and are kept in the artifact — they are yours to review.
- `result.json`, `report.html` and `issues.md` are redacted at source (token / password /
  session / email query parameters masked) before anything is written.
- The action requires no secrets and requests no elevated permissions.

## Local verification

To try the action without GitHub: the steps are plain bash — install ReproCase globally,
run `reprocase scan ...`, check `$?`. Everything the action does maps 1:1 to the CLI
commands documented in [cli.md](cli.md).
