## ReproCase v0.3.2 — report link-scheme hardening & trace-link honesty

A small, focused post-release patch on the verified v0.3.1 base. No new features,
no UI rebuild — one security fix and one honesty fix.

### Security

- **Untrusted URLs can no longer become clickable links in the HTML report.**
  `report.html` assigned `result.json` values — finding page URL, cluster member URL,
  reproduction-plan URL, page-table URL and the header target — straight into anchor
  `href`. The bundled scanner only ever emits `http(s)`, but the generator runs over an
  arbitrary `ScanResult`, so a crafted / shared / older / third-party `result.json` opened
  as an offline report could produce a `javascript:` or `data:` link that runs on click
  (self-XSS). **Reproduced** (live `javascript:alert(...)` anchors) **then fixed**: every
  dynamic link and the header target now validate an HTTP(S) scheme, and a non-HTTP(S)
  value renders as non-clickable text. Legitimate `http(s)` links are unchanged.

### UX

- **Trace links set honest expectations.** Playwright traces stay private and are still
  stripped from CI and GitHub Pages, but the report now labels the trace link as a *local*
  artifact and notes that traces are **not included in hosted / public copies**, so a
  removed file no longer looks like a broken public download.

### Verification (real)

- `tsc` clean; full suite **136 tests / 20 files pass** on Windows 11 x64 + headless
  Chromium (was 132). New: a real-browser audit asserting **zero `javascript:`/`data:`/
  `file:` anchors** while valid `http(s)` links still render, a header-URL guard test, and
  a trace-copy honesty test. No tests removed or weakened.
- CI matrix (Windows / macOS / Ubuntu Node 20 & 22) verified green on the v0.3.2 commit
  before release (see checks on this tag).
- `npm audit`: 0 vulnerabilities.

### Installation — ReproCase is not yet on the npm registry

`npm i -g reprocase` does **not** work: the name returns 404 on registry.npmjs.org. Use a
verified method:

**A. Install from this release's tarball** (no build step):
```bash
curl -L -O https://github.com/geyutu6755/ReproCase/releases/download/v0.3.2/reprocase-0.3.2.tgz
npm install -g ./reprocase-0.3.2.tgz        # or: npm install ./reprocase-0.3.2.tgz (local)
npx playwright install chromium             # one-time browser download
reprocase demo
```

**B. Clone the pinned tag and build:**
```bash
git clone -b v0.3.2 https://github.com/geyutu6755/ReproCase.git
cd ReproCase && npm install && npx playwright install chromium && npm run build
npx reprocase demo
```
