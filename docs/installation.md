# Installation

## Requirements

- Node.js ≥ 18 (tested on 20 and 22)
- Chromium, installed via Playwright (one command, ~120 MB download)

## Install from this repository

```bash
git clone https://github.com/geyutu6755/ReproCase.git
cd ReproCase
npm install
npx playwright install chromium
npm run build
```

Install globally from GitHub (no clone needed):

```bash
npm install -g github:geyutu6755/ReproCase
npx playwright install chromium
reprocase --version
```

Or run ad hoc:

```bash
npx github:geyutu6755/ReproCase demo
```

> `@playwright/test` and `playwright` ship as dependencies of ReproCase; the only extra step is
> downloading the Chromium browser binary with `npx playwright install chromium`.

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
`npx playwright install --with-deps chromium` to install system dependencies.
