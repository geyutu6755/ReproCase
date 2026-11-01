# Compatibility matrix

Honest status per platform. "Real pass" means the full automated suite (or the listed
components) actually ran on that platform; nothing here is inferred from source review.
Windows and macOS results come from real GitHub Actions runners (`ci.yml` matrix, run for
commit `2ef101c`, 2026-11-01); Linux from ubuntu runners (Node 20 & 22). The **Windows local**
column is re-run for every release and now reports the current suite: 122/122 at v0.3.0 and
132/132 at v0.3.1. The CI columns above the v0.3.x line reflect the `2ef101c` matrix run; a
fresh `ci.yml` matrix executes on every push to `main` (including the v0.3.1 release push) and
its results are recorded on that run, not asserted here until observed.

| Component | Windows 11 x64 (local dev) | Windows CI (windows-latest, Node 22) | Linux CI (ubuntu-latest, Node 20 & 22) | macOS CI (macos-latest, Node 22) |
| --- | --- | --- | --- | --- |
| Full test suite (`vitest run`) | ✅ real pass (99/99 v0.2.1; 101/101 v0.2.2; 122/122 v0.3.0; 132/132 v0.3.1) | ✅ real pass (CI @ v0.2.2) | ✅ real pass (CI @ v0.2.2) | ✅ real pass (CI @ v0.2.2) |
| CLI `scan` / `demo` / `init` / `doctor` / `compare` | ✅ real pass | ✅ real pass (CI e2e) | ✅ real pass (CI e2e) | ✅ real pass (CI e2e) |
| Chromium via Playwright (headless) | ✅ real pass | ✅ real pass (CI) | ✅ real pass (`--with-deps`) | ✅ real pass (CI) |
| Generated reproduction tests via `playwright test` | ✅ real pass | ✅ real pass (CI e2e) | ✅ real pass (CI e2e) | ✅ real pass (CI e2e) |
| Paths with spaces and non-ASCII (CJK) characters | ✅ real pass (automated test; dev dir is CJK) | ✅ real pass (CI e2e) | ✅ real pass (CI e2e) | ✅ real pass (CI e2e) |
| `npm pack` → isolated install → CLI runs | ✅ real pass (automated test) | ✅ real pass (CI e2e) | ✅ real pass (CI e2e) | ✅ real pass (CI e2e) |
| SIGINT (Ctrl+C) graceful stop | ✅ implemented, exercised manually | ✅ implemented | ✅ implemented | ✅ implemented |

Notes:

- Node.js: 20 and 22 are CI-tested; 18 is the minimum supported version.
- The Windows local environment includes a CJK-containing working directory
  (`E:\ai测试\ReproCase`), so CJK path handling is exercised daily by development itself.
- macOS is now verified through CI. A maintainer-reported local macOS run (Homebrew Node,
  local Chromium) is still welcome as extra signal.

