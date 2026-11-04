## ReproCase v0.3.1 — reliability & trust refinement

A focused patch on the verified v0.3.0 base. No new capabilities and no UI
rebuild — this release makes the v0.3.0 fault-aggregation *honest* and corrects
report accuracy.

### What changed

- **Fault clusters no longer over-claim a shared root cause.**
  Cross-page matches grouped by identical message with **no distinguishing stack**
  (`signatureQuality: "message-only"`) are now rendered under a separate
  **"Possible duplicates"** heading, badged `confidence: low · message only`, with an
  explicit note that the shared root cause is **NOT proven**. Only clusters backed by
  a reliable **normalized stack + message** stay under the confirmed
  **"Cross-page clusters"** heading. A stack-bearing fault and a stack-less fault that
  print the same message are kept in separate keys and are never merged.
- **Lone faults are not clusters.** A signature must span **two or more pages** to
  become a cluster; a single-page match stays a plain finding (it still appears in
  `result.json.findings` and still drives `compare`), so nothing is lost and no
  "duplicate of one" mislabel appears.
- **`issues.md` header accuracy.** The combined issue document no longer prints one
  finding's verification-attempt count as a global "N independent browser runs" figure.

### Verification (real, this release)

- `tsc` build clean; full suite **132 tests / 20 files pass** (was 122/19) — Windows 11
  x64 + headless Chromium, including a new real-browser test for honest two-tier
  clusters, an exploration authorization-precedence security test
  (`deny > hard-dangerous > soft > click`), Markdown cluster traceability, and
  CJK/emoji/markup escaping robustness.
- End-to-end CLI demo scan of the bundled site (5 verified findings, full report bundle).
- Closed-loop: fault present → independently verified 3/3 → generated Playwright test →
  fault removed → clean rescan → `compare` reports it **resolved & confirmed** (page
  covered), no phantom "new".
- Isolated install from the packed tarball: `reprocase --version` → 0.3.1, all commands
  present.
- `npm audit`: 0 vulnerabilities (prod and all). Packaged artifact contains no secrets,
  no `node_modules`, no private evidence.

## Installation — ReproCase is not yet on the npm registry

`npm i -g reprocase` does **not** work yet: the name returns 404 on
registry.npmjs.org. Until a real npm publish, use a verified method:

**A. Install from this release's tarball** (no build step — verified):
```bash
curl -L -O https://github.com/geyutu6755/ReproCase/releases/download/v0.3.1/reprocase-0.3.1.tgz
npm install -g ./reprocase-0.3.1.tgz        # or: npm install ./reprocase-0.3.1.tgz (local)
npx playwright install chromium             # one-time browser download
reprocase demo
```

**B. Clone the pinned tag and build** (verified):
```bash
git clone -b v0.3.1 https://github.com/geyutu6755/ReproCase.git
cd ReproCase && npm install && npx playwright install chromium && npm run build
npx reprocase demo
```
