# Generated reproduction tests

ReproCase generated 4 Playwright spec(s) from verified findings of one scan.

## Run them

```bash
# 1. Start the site that was scanned (the specs use absolute URLs).
# 2. From this folder, with @playwright/test installed somewhere up the tree:
npx playwright test --config playwright.config.mjs
```

## What the assertions mean

Each spec asserts that the original fault is STILL PRESENT (a reproduction test).
It passes while the bug exists and fails once you fix it — that failure is the
signal to swap in the commented-out "after fix" assertion, turning the file into
a permanent regression guard.
