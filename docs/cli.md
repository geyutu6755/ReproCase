# CLI usage

```
reprocase [command]

Commands:
  scan     Scan a website and generate verified findings, evidence and reproducible tests.
  demo     Scan the bundled demo website (with four planted faults) and produce a full report.
  init     Create a starter reprocase.config.json in the current directory.
  doctor   Diagnose the environment (Node, Chromium, config, target reachability).
  compare  Diff two scan results by stable fingerprint: new / resolved / persistent.
```

## `reprocase init`

| Option | Default | Description |
| --- | --- | --- |
| `-u, --entry <url>` | `http://127.0.0.1:3000/` | Entry URL to prefill |
| `-o, --out <path>` | `reprocase.config.json` | Config file path to write |
| `--force` | — | Overwrite an existing config |

Refuses to overwrite without `--force`. Validates the generated config before writing.

## `reprocase doctor`

Checks (each with a `fix:` hint when failing): Node.js version, Playwright Chromium presence,
config validity, scan-target reachability, output writability. Exit `0` when no check fails
(warnings do not fail), `1` otherwise.

## `reprocase compare <baseline> <current>`

| Option | Default | Description |
| --- | --- | --- |
| `-o, --out <dir>` | `reprocase-compare` | Output directory (`compare.json`, `compare.html`) |
| `--fail-on <mode>` | — | `new`: exit 1 when new findings exist; `any`: exit 1 on any difference |

Matching uses **stable fingerprints** (type + URL path + error signature): random ids,
timestamps and volatile query parameters are ignored. A finding is only called **resolved**
when the current scan covered its page — shrunk coverage produces *unconfirmed* entries and a
coverage warning, never a claimed fix.

## `reprocase scan`

| Option | Default | Description |
| --- | --- | --- |
| `-u, --url <url>` | — | Entry URL to scan (overrides the config file entry) |
| `-c, --config <path>` | `./reprocase.config.json` if present | Path to a config JSON file |
| `-o, --out <dir>` | `reprocase-report` | Output directory for the report bundle |
| `--max-pages <n>` | `25` | Maximum number of pages to visit |
| `--depth <n>` | `3` | Maximum crawl depth from the entry page |
| `--timeout <ms>` | `300000` | Overall run timeout |
| `--fail-on <mode>` | `verified` | Exit 1 when `verified` or `suspected` findings exist, or `never` |
| `--compare-with <file>` | — | Diff against a previous `result.json`; writes `compare.json` and embeds a "Changes vs previous scan" section in the HTML report |
| `--no-screenshots` | — | Disable screenshot capture |
| `--no-traces` | — | Disable Playwright trace capture |
| `-v, --verbose` | — | Log every step (to stderr) |
| `-q, --quiet` | — | Only print the final summary |

```bash
# Explicit URL, default budgets
npx reprocase scan --url http://localhost:3000/

# Config-driven with strict CI semantics
npx reprocase scan --config reprocase.config.json --fail-on verified

# Wide but shallow discovery pass, no screenshots
npx reprocase scan --url http://127.0.0.1:8080/ --max-pages 50 --depth 1 --no-screenshots
```

Progress goes to **stderr**; the final summary and exit-code explanation go to **stdout**,
so pipelines can parse stdout cleanly.

## `reprocase demo`

| Option | Default | Description |
| --- | --- | --- |
| `-o, --out <dir>` | `reprocase-demo-report` | Output directory |
| `--no-open` | — | Do not open the report in a browser |

Serves the bundled demo site on a random localhost port, scans it and writes the full report
bundle. The demo always exits `0` unless the tool itself crashes (it is a showcase, not a gate).

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Scan completed, no findings at or above the `--fail-on` threshold |
| `1` | Scan completed and findings exist at or above the threshold |
| `2` | Scan could not run properly: invalid config, entry URL unreachable, unexpected crash |

Notes:

- With the default `--fail-on verified`, suspected-only findings exit `0` — use
  `--fail-on suspected` to fail on any finding at all.
- An unreachable entry URL also produces an honest `page-load-failure` finding in
  `result.json` (`entryUnreachable: true`) *and* exit code `2`, so both humans and pipelines
  see the failure.

## CI example (GitHub Actions)

```yaml
- name: Install ReproCase
  run: |
    npm install -g github:geyutu6755/ReproCase
    npx playwright install --with-deps chromium
- name: Scan staging site
  run: reprocase scan --url https://staging.example.internal/ --fail-on verified
```
