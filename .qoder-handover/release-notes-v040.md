## ReproCase v0.4.0 — lower the barrier to first install

An adoption-focused release on the verified v0.3.3 base. **No new detection rules,
no UI rebuild** — it makes installing and first use simpler, and fixes a deprecated
test config and an inconsistent Node-version story.

### What changed

- **Node.js baseline is now 22.** Node 18 (EOL Apr 2025) and Node 20 (EOL Mar 2026)
  reached End-of-Life. `engines.node` is `>=22`, and README (en/zh), installation docs,
  compatibility matrix, `reprocase doctor`, and the CI matrix (now Node **22 & 24**) all
  agree. Previously the docs claimed "18 works" while nothing tested it.
- **One-step source install.** Added `prepare: npm run build`, so `npm install` compiles
  `dist/`. This makes `npm install -g github:geyutu6755/ReproCase#vX.Y.Z` actually work
  (it previously fetched unbuilt TypeScript with no runnable `reprocase` binary) and
  removes the manual `npm run build` from the Quick Start.
- **Deprecated Vitest config fixed.** `test.poolOptions` (removed in Vitest 4) became
  top-level `maxWorkers: 1`, with per-file isolation left at its default — test isolation,
  stability and cross-platform behaviour are unchanged.
- **Real screenshots** regenerated from the current report rendered in Chromium.

### Verified — accuracy on an independent app (not the bundled demo)

A purpose-built probe application exercised the detector and all **23 checks passed**:
cross-page clusters with a reliable stack+message signature spanning 2 pages, lazy/async
and unhandled-rejection errors caught by the adaptive observation window, same-page
duplicate errors de-duplicated to one finding, out-of-scope / `mailto:` / `javascript:`
links correctly ignored, risky buttons (Delete/Pay/Logout) skipped and never clicked,
forms untouched, a clean page with zero findings, and two independent scans reproducing
the identical finding set.

### Quality gates

- `tsc` clean; suite **137 tests / 20 files**; security subset (redaction, HTML/JSON/attachment
  escaping, dangerous-action authorization) green.
- Cross-platform CI (Windows, macOS, Ubuntu Node 22 & 24) green on this commit.
- `npm audit`: 0 vulnerabilities.

### Installation

ReproCase is **still not published to the npm registry** (name returns 404; no maintainer
publish credentials are configured — see `docs/npm-publishing.md`). Verified install:

```bash
# A. one-step from the pinned tag (prepare builds dist):
npm install -g github:geyutu6755/ReproCase#v0.4.0
npx playwright install chromium
reprocase demo

# B. or download this release's tarball (prebuilt, no build step):
curl -L -O https://github.com/geyutu6755/ReproCase/releases/download/v0.4.0/reprocase-0.4.0.tgz
npm install -g ./reprocase-0.4.0.tgz
npx playwright install chromium
reprocase demo
```
