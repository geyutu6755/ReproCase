# Vendored framework runtimes

The framework test applications load real production runtimes that are committed here so
scans never depend on a CDN at scan time.

| File | Source | Version | License |
| --- | --- | --- | --- |
| `react.production.min.js` | https://unpkg.com/react@18.3.1/umd/react.production.min.js | 18.3.1 | MIT (license header kept) |
| `react-dom.production.min.js` | https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js | 18.3.1 | MIT (license header kept) |
| `vue.global.prod.js` | https://unpkg.com/vue@3.4.38/dist/vue.global.prod.js | 3.4.38 | MIT (license header kept) |

These files are test fixtures for ReproCase's framework-application baselines and are not part
of the ReproCase npm package.
