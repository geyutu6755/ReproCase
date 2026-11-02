# Installation

## Requirements

- Node.js ≥ 22 (the current LTS lines; CI-tested on 22 and 24). Node 18 and 20 are
  End-of-Life and no longer supported.
- Chromium, installed via Playwright (one command, ~120 MB download)

## Install from this repository

```bash
git clone https://github.com/geyutu6755/ReproCase.git
cd ReproCase
npm install                    # the `prepare` script compiles dist/ automatically
npx playwright install chromium
```

Install globally straight from GitHub (no clone needed — `prepare` builds it):

```bash
npm install -g github:geyutu6755/ReproCase#v0.4.0
npx playwright install chromium
reprocase --version
```

Or run ad hoc:

```bash
npx github:geyutu6755/ReproCase demo
```

> `@playwright/test` and `playwright` ship as dependencies; the only extra step is
> downloading the Chromium browser binary with `npx playwright install chromium`.
> Installing from a released **tarball** (below) or the npm registry skips the build —
> `dist/` is already in the package.

## Verify the installation

```bash
npx reprocase demo --no-open
```

This serves the bundled demo site (with four planted faults), scans it and writes
`reprocase-demo-report/report.html`. The report should list 5 verified findings —
the four planted faults plus the broken link they imply.

## Run the test suite (contributors)

```bash
npm run test:all
```

This runs the full suite — unit tests, real-browser integration tests and CLI end-to-end tests,
including executing the generated Playwright reproduction tests. Current counts live in
[CHANGELOG.md](../CHANGELOG.md); the suite grows with every release, so no numbers are hardcoded here.

Troubleshooting browser install: see
[Playwright's documentation](https://playwright.dev/docs/browsers). On Linux CI runners use
`npx playwright install --with-deps chromium` to install system dependencies. More first-run
problems are covered in the README FAQ; npm publishing readiness is described in
[npm-publishing.md](npm-publishing.md).
