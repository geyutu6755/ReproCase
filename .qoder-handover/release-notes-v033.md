## ReproCase v0.3.3 — attachment path safety + CI action-runtime maintenance

A focused patch on the verified v0.3.2 base: one security follow-up and one CI
maintenance change. No new features, no UI rebuild.

### Security

- **Trace / screenshot attachments are validated as local-relative paths.** The
  v0.3.2 link-scheme guard covered page/plan/member/header links but missed the
  attachment attributes: `report.html` set the trace anchor `href` and the
  screenshot `<img> src` from `result.json` values using only `encodeURI`, which
  does not strip URL schemes. A crafted / shared / older `result.json` opened as an
  offline report could therefore expose a **clickable `javascript:` trace link
  (self-XSS)**, or `data:` / path-traversal (`../`) image sources. **Reproduced in
  Chromium, then fixed** with a single `safeArtifact()` check (rejects any scheme,
  protocol-relative `//host`, absolute path, backslash separator and `..` traversal),
  applied to the trace `href`/`download`, the screenshot `src` and the lightbox.
  **Normal local artifacts still work** — `artifacts/traces/…zip` and
  `artifacts/screenshots/…png` keep their working link / preview; nothing is
  blanket-disabled.

### CI maintenance

- **Actions moved to Node-24 runtime majors.** GitHub removed Node 20 from
  hosted runners on 2026-09-16; the pinned `checkout@v4` / `setup-node@v4` /
  `upload-artifact@v4` / `configure-pages@v5` / `deploy-pages@v4` are Node-20 actions
  now force-run on Node 24. Upgraded to the minimal Node-24 majors **verified from
  each action's own `action.yml` `runs.using`**: `checkout@v5`, `setup-node@v5`,
  `upload-artifact@v6` (v5 is still node20), `configure-pages@v6`, `deploy-pages@v5`.
  `upload-pages-artifact` is a composite action and is unchanged. The project's
  **Node 20 & 22 build/test matrix is preserved.**

### Verification (real)

- `tsc` clean; full suite **137 tests / 20 files** on Windows 11 + headless Chromium
  (was 136). New real-browser audit proves hostile trace/screenshot paths are
  neutralized while legitimate local artifacts still render.
- **CI matrix green with the new action versions** on all four platforms
  (Ubuntu Node 20 & 22, macOS Node 22, Windows Node 22) — run #41303801050 (PR) and
  the `push:main` run on this tag.
- Packaged artifact == source verified: the published tarball's compiled report
  renderer contains `safeArtifact` and `--version` reports 0.3.3.
- `npm audit`: 0 vulnerabilities.

### Installation — ReproCase is not yet on the npm registry

`npm i -g reprocase` does **not** work: the name returns 404 on registry.npmjs.org. Use a
verified method:

**A. Install from this release's tarball** (no build step):
```bash
curl -L -O https://github.com/geyutu6755/ReproCase/releases/download/v0.3.3/reprocase-0.3.3.tgz
npm install -g ./reprocase-0.3.3.tgz        # or: npm install ./reprocase-0.3.3.tgz (local)
npx playwright install chromium             # one-time browser download
reprocase demo
```

**B. Clone the pinned tag and build:**
```bash
git clone -b v0.3.3 https://github.com/geyutu6755/ReproCase.git
cd ReproCase && npm install && npx playwright install chromium && npm run build
npx reprocase demo
```
