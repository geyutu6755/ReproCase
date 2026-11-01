# Compatibility matrix

Honest status per platform. "Real pass" means the full automated suite (or the listed
components) actually ran on that platform; nothing here is inferred from source review.
The **Windows local** column is re-run for every release and reports the current suite:
122/122 at v0.3.0, 132/132 at v0.3.1 and 136/136 at v0.3.2. The full `ci.yml` matrix
(Windows / macOS / Ubuntu Node 20 & 22) runs on every push to `main` and every PR; the
v0.3.1 matrix (run #41295959003) completed **success** on all four OS jobs, and the v0.3.2
results are attached to that release's PR/push once observed. The matrix cells below are
annotated with the run each platform result is drawn from.

| Component | Windows 11 x64 (local dev) | Windows CI (windows-latest, Node 22) | Linux CI (ubuntu-latest, Node 20 & 22) | macOS CI (macos-latest, Node 22) |
| --- | --- | --- | --- | --- |
| Full test suite (`vitest run`) | ✅ real pass (122/122 v0.3.0; 132/132 v0.3.1; 136/136 v0.3.2; 137/137 v0.3.3) | ✅ real pass (CI @ v0.2.2) | ✅ real pass (CI @ v0.2.2) | ✅ real pass (CI @ v0.2.2) |
| CLI `scan` / `demo` / `init` / `doctor` / `compare` | ✅ real pass | ✅ real pass (CI e2e) | ✅ real pass (CI e2e) | ✅ real pass (CI e2e) |
| Chromium via Playwright (headless) | ✅ real pass | ✅ real pass (CI) | ✅ real pass (`--with-deps`) | ✅ real pass (CI) |
| Generated reproduction tests via `playwright test` | ✅ real pass | ✅ real pass (CI e2e) | ✅ real pass (CI e2e) | ✅ real pass (CI e2e) |
| Paths with spaces and non-ASCII (CJK) characters | ✅ real pass (automated test; dev dir is CJK) | ✅ real pass (CI e2e) | ✅ real pass (CI e2e) | ✅ real pass (CI e2e) |
| `npm pack` → isolated install → CLI runs | ✅ real pass (automated test) | ✅ real pass (CI e2e) | ✅ real pass (CI e2e) | ✅ real pass (CI e2e) |
| SIGINT (Ctrl+C) graceful stop | ✅ implemented, exercised manually | ✅ implemented | ✅ implemented | ✅ implemented |

Notes:

- Node.js: 20 and 22 are CI-tested; 18 is the minimum supported version.
- CI action runtimes: as of v0.3.3 the workflow uses the Node-24 majors
  (`checkout@v5`, `setup-node@v5`, `upload-artifact@v6`, `configure-pages@v6`,
  `deploy-pages@v5`) — Node 20 was removed from GitHub-hosted runners on
  2026-09-16. This changes only the action runtime, not the project's Node 20/22
  test matrix. The full v0.3.x matrix (Windows / macOS / Ubuntu 20 & 22) is re-run
  on each release PR/push and its results are attached to those runs.
- The Windows local environment includes a CJK-containing working directory
  (`E:\ai测试\ReproCase`), so CJK path handling is exercised daily by development itself.
- macOS is now verified through CI. A maintainer-reported local macOS run (Homebrew Node,
  local Chromium) is still welcome as extra signal.

