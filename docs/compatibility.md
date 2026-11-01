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
| Full test suite (`vitest run`) | ✅ real pass (101/101 v0.2.2; 122/122 v0.3.0; 132/132 v0.3.1; 136/136 v0.3.2) | ✅ real pass (CI @ v0.2.2) | ✅ real pass (CI @ v0.2.2) | ✅ real pass (CI @ v0.2.2) |
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

