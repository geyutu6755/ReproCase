# Publishing ReproCase to npm

The `reprocase` package name is **available** on the npm registry (verified 2026-11-01:
`npm view reprocase` → 404). This project has **no npm publish credentials configured**, so no
npm release has been made from this repository — the verified install path remains GitHub:

```bash
npm install -g github:geyutu6755/ReproCase#vX.Y.Z
npx playwright install chromium
```

This document is the minimal, executable path to a trusted npm release once an account exists.
It intentionally contains no tokens and asks for none in chat.

## Pre-publish checklist (already verified)

- `files` whitelist ships `dist/` + `examples/demo-site` + docs; `npm pack` verified end-to-end
  (tarball → isolated install → `npx reprocase --version/init/demo`) on Windows and Linux CI.
- `bin: { "reprocase": "dist/cli.js" }` with a `#!/usr/bin/env node` shebang.
- `engines: { "node": ">=22" }`; `prepare: npm run build` compiles `dist/` on publish and on
  `npm install`-from-source (git/tarball) installs.
- No install/postinstall scripts run in the published package (Playwright browsers are a
  documented explicit `npx playwright install chromium` step — nothing phones home at install).
- `npm audit` clean at release time.

## Minimal release steps (maintainer with an npm account)

```bash
# 1. Authenticate locally (never commit or share the token):
npm login

# 2. From a clean checkout at the release commit:
npm ci && npm run build && npm test

# 3. Inspect exactly what will ship:
npm pack --dry-run

# 4. Publish (first release: provenance requires a supported CI; local publish is fine without):
npm publish

# 5. Verify from the registry in an isolated directory:
mkdir verify && cd verify && npm init -y
npm install reprocase@<version>
npx reprocase --version && npx reprocase demo --no-open
```

## Optional: CI publishing with provenance

1. `npm publish --provenance` requires publishing from GitHub Actions with
   `id-token: write` permission and `NPM_TOKEN` stored as a repository secret.
2. Recommended flow: tag `vX.Y.Z` → workflow job runs `npm ci && npm run build && npm test`
   → `npm publish --provenance --access public`.

Until a maintainer performs these steps, README and docs will keep describing the GitHub
install path — npm is not claimed as an available channel.
