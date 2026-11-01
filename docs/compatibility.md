# Compatibility matrix

Honest status per platform. "Real pass" means the full automated suite (or the listed
components) actually ran on that platform; nothing here is inferred from source review.

| Component | Windows 11 x64 (local) | Linux ubuntu-latest (GitHub Actions, Node 20 & 22) | macOS |
| --- | --- | --- | --- |
| Full test suite (`vitest run`) | ✅ real pass (99/99, local run 2026-11-01) | ✅ real pass (CI on every push, Node 20 + 22 matrix) | ⚠️ **not executed** — no Apple runner available to this project |
| CLI `scan` / `demo` / `init` / `doctor` / `compare` | ✅ real pass | ✅ real pass (CI e2e tests) | ⚠️ not executed |
| Chromium via Playwright (headless) | ✅ real pass | ✅ real pass (`npx playwright install --with-deps chromium` in CI) | ⚠️ not executed |
| Generated reproduction tests via `playwright test` | ✅ real pass | ✅ real pass (CI e2e) | ⚠️ not executed |
| Paths with spaces and non-ASCII (CJK) characters | ✅ real pass (automated test) | ✅ real pass (automated test runs on Linux too) | ⚠️ not executed |
| `npm pack` → isolated install → CLI runs | ✅ real pass (automated test) | ✅ real pass (automated test) | ⚠️ not executed |
| SIGINT (Ctrl+C) graceful stop | ✅ implemented, exercised manually | ✅ implemented | ⚠️ not executed |

Notes:

- Node.js: 20 and 22 are CI-tested; 18 is the minimum supported version.
- The Windows local environment includes a CJK-containing working directory
  (`E:\ai测试\ReproCase`), so CJK path handling is exercised daily by development itself.
- macOS support is expected to work (POSIX-like paths, Playwright supports darwin) but is
  **explicitly unverified** — contributions with a macOS run report are welcome.
