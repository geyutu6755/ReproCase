# Contributing to ReproCase

Thanks for helping make website faults reproducible! This project is intentionally small and
deterministic — no AI APIs, no guessed results.

## Development setup

```bash
git clone https://github.com/geyutu6755/ReproCase.git
cd ReproCase
npm install
npx playwright install chromium
npm run build
npm run test:all
```

## Project rules

1. **Never fabricate results.** A finding requires objective evidence (HTTP status, exception,
   measurement). If something cannot be proven, it is `suspected` or listed under "not checked".
2. **Never weaken tests to make them pass.** The demo site's four planted faults and the clean
   control pages are an executable specification: fault scans must find all four, control scans
   must find nothing. Changes that break either must fix the product, not the test.
3. **Strict TypeScript, ESM, Node ≥ 18.** No new runtime dependencies without discussion —
   the current set is `@playwright/test`, `playwright`, `commander`.
4. **Safety first.** Exploration must stay read-only-first. If you add interactions, extend the
   risky-keyword deny-list and keep form filling opt-in.

## Workflow

1. Open an issue describing the fault you want to detect or the bug you found.
2. Fork, create a feature branch (`feat/overflow-iframes`).
3. Add/adjust tests: unit for pure logic, integration (real browser) for detection behaviour.
4. `npm run test:all` must pass, `npm run build` must be clean.
5. Open a PR with a short description and the scan/report behaviour change.

## Commit style

Conventional Commits: `feat:`, `fix:`, `docs:`, `test:`, `chore:`, `refactor:`.

## Reporting a bug

Run with `-v`, attach `result.json` and (if relevant) the generated spec. Redact anything you
do not want public — although ReproCase already redacts sensitive query parameters, screenshots
can contain page content.

## Releases

Maintainers tag `vX.Y.Z` on `main` after CI is green. See [CHANGELOG.md](CHANGELOG.md).
