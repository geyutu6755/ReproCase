#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { Command, InvalidArgumentError } from 'commander';
import { ConfigError, loadConfigFile, resolveConfig } from './config.js';
import { Scanner } from './scanner.js';
import { generateTests } from './generate-tests.js';
import { writeReports } from './report/write.js';
import { startStaticServer } from './dev-server.js';
import { collectDoctorChecks, printDoctorReport, runInit } from './setup.js';
import { compareResults, loadResultFile, type CompareResult } from './compare.js';
import { runCompare } from './compare.js';
import { log } from './util/log.js';
import { VERSION } from './version.js';
import type { ScanResult } from './types.js';

type FailOn = 'verified' | 'suspected' | 'never';

/**
 * Strips one layer of wrapping quotes from an option value. Some Windows
 * shells and CI wrappers pass quoted arguments through verbatim; without
 * this, `--config "path"` arrives as `"path"` and fails with a confusing
 * doubled-quote path in errors.
 */
function unquote(v: string | undefined): string | undefined {
  if (v === undefined) return v;
  const t = v.trim();
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) {
    return t.slice(1, -1);
  }
  return t;
}

function intArg(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new InvalidArgumentError('expected a positive integer');
  return n;
}

function failOnArg(value: string): FailOn {
  if (value !== 'verified' && value !== 'suspected' && value !== 'never') {
    throw new InvalidArgumentError('expected "verified", "suspected" or "never"');
  }
  return value;
}

/**
 * Exit codes (CI-friendly):
 *   0 — scan completed, no findings at or above the --fail-on threshold
 *   1 — scan completed and findings exist at or above the threshold
 *   2 — scan could not run properly (bad config, entry unreachable, crash)
 */
function exitCodeFor(result: ScanResult, failOn: FailOn): number {
  if (result.entryUnreachable) return 2;
  if (failOn === 'never') return 0;
  if (failOn === 'suspected') return result.findings.length > 0 ? 1 : 0;
  return result.summary.verified > 0 ? 1 : 0;
}

function printSummary(result: ScanResult, outDir: string): void {
  const s = result.summary;
  const secs = Math.round(result.stats.durationMs / 1000);
  log.out('');
  log.out(`ReproCase v${result.tool.version} — scan finished in ${secs}s`);
  log.out(`Target: ${result.target.entry}`);
  log.out(
    `Checked ${result.stats.pagesVisited} page(s), ${result.stats.actionsPerformed} interaction(s), ` +
      `${result.stats.linksChecked} link(s); ${result.stats.findingsRaw} observations -> ${result.stats.findingsAfterDedupe} deduplicated finding(s).`
  );
  if (result.truncated) log.out(`Note: partial scan — ${result.truncated}.`);
  log.out('');
  if (result.entryUnreachable) {
    log.out('The entry URL could not be reached at all — nothing meaningful was scanned.');
    log.out('Start the site, fix the entry URL, then re-run. Tip: npx reprocase doctor checks reachability.');
    log.out('');
  }
  if (result.findings.length === 0) {
    log.out('No findings. No verified or suspected faults were detected.');
  } else {
    log.out(`Verified: ${s.verified}   Suspected: ${s.suspected}`);
    for (const f of result.findings) {
      log.out(
        `  [${f.severity.toUpperCase()}][${f.status}] ${f.title} (${f.id}, ${f.repro.successes}/${f.repro.attempts} repro)`
      );
    }
  }
  log.out('');
  log.out(`HTML report:        ${path.join(outDir, 'report.html')}`);
  log.out(`Machine-readable:   ${path.join(outDir, 'result.json')}`);
  log.out(`GitHub issue text:  ${path.join(outDir, 'issues.md')}`);
  log.out(`Generated tests:    ${path.join(outDir, 'generated-tests')}`);
  log.out('');
}

function openInBrowser(filePath: string): void {
  try {
    if (process.platform === 'win32') {
      spawn('rundll32', ['url.dll,FileProtocolHandler', filePath], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [filePath], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [filePath], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    // Opening a browser is a convenience, never a requirement.
  }
}

interface ScanCliOptions {
  url?: string;
  config?: string;
  out: string;
  maxPages?: number;
  depth?: number;
  timeout?: number;
  detectionWindowMs?: number;
  failOn: FailOn;
  compareWith?: string;
  screenshots: boolean;
  traces: boolean;
  verbose?: boolean;
  quiet?: boolean;
}

async function runScan(opts: ScanCliOptions): Promise<void> {
  if (opts.quiet) log.setLevel('quiet');
  else if (opts.verbose) log.setLevel('verbose');

  let partial: Record<string, unknown> = {};
  const cfgPath = unquote(opts.config) ?? (fs.existsSync('reprocase.config.json') ? 'reprocase.config.json' : undefined);
  if (cfgPath) {
    partial = loadConfigFile(cfgPath);
    log.info(`[config] using ${cfgPath}`);
  }
  if (unquote(opts.url)) partial.entry = unquote(opts.url);
  if (opts.maxPages !== undefined) partial.maxPages = opts.maxPages;
  if (opts.depth !== undefined) partial.maxDepth = opts.depth;
  if (opts.timeout !== undefined) partial.runTimeoutMs = opts.timeout;
  if (opts.detectionWindowMs !== undefined) {
    partial.detection = { ...(partial.detection as Record<string, unknown> | undefined), windowMs: opts.detectionWindowMs };
  }

  const { config, warnings } = resolveConfig(partial);
  if (!opts.screenshots) config.capture.screenshots = false;
  if (!opts.traces) config.capture.traces = false;
  for (const w of warnings) log.warn(w);

  const outDir = unquote(opts.out) ?? 'reprocase-report';
  log.info(`[scan] entry ${config.entry} (allowed: ${(config.allowedDomains.join(', ') || 'localhost')})`);
  const scanner = new Scanner(config, outDir);
  const { result } = await scanner.run();

  let compare: CompareResult | undefined;
  const compareFile = unquote(opts.compareWith);
  if (compareFile) {
    const baseline = loadResultFile(compareFile);
    compare = compareResults(baseline, result, {
      baseline: path.resolve(compareFile),
      current: path.resolve(outDir, 'result.json')
    });
    log.info(
      `[compare] vs ${compareFile}: new ${compare.summary.newCount}, resolved ${compare.summary.resolvedCount}` +
        (compare.summary.resolvedUnconfirmedCount > 0
          ? ` (${compare.summary.resolvedUnconfirmedCount} unconfirmed — coverage shrank)`
          : '') +
        `, persistent ${compare.summary.persistentCount}`
    );
  }

  generateTests(result.findings, outDir, config.viewports);
  writeReports(outDir, result, compare);
  printSummary(result, outDir);

  const code = exitCodeFor(result, opts.failOn);
  if (code === 2 && result.entryUnreachable) {
    log.out('Exit code 2 — the entry URL was unreachable (scan could not run properly).');
  } else if (code !== 0) {
    log.out(`Exit code ${code} — findings at or above --fail-on ${opts.failOn} exist (use --fail-on never to always exit 0).`);
  }
  process.exitCode = code;
}

interface DemoCliOptions {
  out: string;
  open: boolean;
  verbose?: boolean;
  quiet?: boolean;
}

async function runDemo(opts: DemoCliOptions): Promise<void> {
  if (opts.quiet) log.setLevel('quiet');
  else if (opts.verbose) log.setLevel('verbose');

  const demoDir = fileURLToPath(new URL('../examples/demo-site', import.meta.url));
  if (!fs.existsSync(path.join(demoDir, 'index.html'))) {
    throw new Error(`Bundled demo site not found at "${demoDir}".`);
  }
  const server = await startStaticServer(demoDir);
  try {
    log.info(`[demo] serving bundled demo site at ${server.url}`);
    const { config } = resolveConfig({
      entry: server.url,
      allowedDomains: ['127.0.0.1'],
      maxPages: 15,
      runTimeoutMs: 180_000
    });
    const scanner = new Scanner(config, opts.out);
    const { result } = await scanner.run();
    generateTests(result.findings, opts.out, config.viewports);
    writeReports(opts.out, result);
    printSummary(result, opts.out);
    log.out('This report was produced against the bundled demo site, which intentionally');
    log.out('contains four planted faults. Inspect report.html to see how ReproCase reports them.');
    log.out('');
    if (opts.open && !process.env.CI) openInBrowser(path.resolve(opts.out, 'report.html'));
    process.exitCode = 0;
  } finally {
    await server.close();
  }
}

const program = new Command();
program
  .name('reprocase')
  .showHelpAfterError('(run "reprocase --help" for the command list)')
  .description(
    'Automated website fault detection & reproduction: scans a site in a real browser, ' +
      'independently verifies every fault, and emits reproducible Playwright tests plus HTML/JSON/Issue reports.'
  )
  .version(VERSION, '-V, --version', 'print the ReproCase version');

program
  .command('scan')
  .description('Scan a website and generate verified findings, evidence and reproducible tests.')
  .option('-u, --url <url>', 'entry URL to scan (overrides the config file entry)')
  .option('-c, --config <path>', 'path to a reprocase config JSON file (default: ./reprocase.config.json if present)')
  .option('-o, --out <dir>', 'output directory for the report bundle', 'reprocase-report')
  .option('--max-pages <n>', 'maximum number of pages to visit', intArg)
  .option('--depth <n>', 'maximum crawl depth from the entry page', intArg)
  .option('--timeout <ms>', 'overall run timeout in milliseconds', intArg)
  .option('--detection-window-ms <ms>', 'async observation window in ms (default 1500; higher catches later hydration faults)', intArg)
  .option('--fail-on <mode>', 'exit 1 when "verified" or "suspected" findings exist, or "never"', failOnArg, 'verified')
  .option('--compare-with <file>', 'diff against a previous result.json and embed the comparison in the report')
  .option('--no-screenshots', 'disable screenshot capture')
  .option('--no-traces', 'disable Playwright trace capture')
  .option('-v, --verbose', 'log every step')
  .option('-q, --quiet', 'only print the final summary')
  .action(async (opts: ScanCliOptions) => {
    await runScan(opts);
  });

program
  .command('demo')
  .description('Scan the bundled demo website (with four planted faults) and produce a full report — the fastest way to try ReproCase.')
  .option('-o, --out <dir>', 'output directory for the report bundle', 'reprocase-demo-report')
  .option('--no-open', 'do not open the report in a browser')
  .option('-v, --verbose', 'log every step')
  .option('-q, --quiet', 'only print the final summary')
  .action(async (opts: DemoCliOptions) => {
    await runDemo(opts);
  });

program
  .command('init')
  .description('Create a starter reprocase.config.json in the current directory.')
  .option('-u, --entry <url>', 'entry URL to prefill (default: http://127.0.0.1:3000/)')
  .option('-o, --out <path>', 'config file path to write', 'reprocase.config.json')
  .option('--force', 'overwrite an existing config file')
  .action(async (opts: { entry?: string; out: string; force?: boolean }) => {
    const file = runInit(opts);
    if (file) {
      log.out('');
      log.out(`Starter config written to ${file}`);
      log.out('Next steps:');
      log.out('  1. Edit "entry" to point at the site you are authorized to test.');
      log.out('     Scanning anything beyond localhost requires listing its host in "allowedDomains".');
      log.out('  2. npx reprocase doctor        # verify the environment');
      log.out('  3. npx reprocase scan          # run your first scan');
    }
    process.exitCode = 0;
  });

program
  .command('doctor')
  .description(
    'Diagnose the environment: Node version, Chromium browser, config file, scan target reachability and output writability.'
  )
  .action(async () => {
    const checks = await collectDoctorChecks();
    const healthy = printDoctorReport(checks);
    process.exitCode = healthy ? 0 : 1;
  });

program
  .command('compare <baseline> <current>')
  .description(
    'Compare two scan results (result.json files) by stable fingerprint: new, resolved (coverage-aware) and persistent findings.'
  )
  .option('-o, --out <dir>', 'output directory for compare.json / compare.html', 'reprocase-compare')
  .option('--fail-on <mode>', 'exit 1 on "new" findings or on "any" difference', (v: string) => {
    if (v !== 'new' && v !== 'any') throw new InvalidArgumentError('expected "new" or "any"');
    return v;
  })
  .action(async (baseline: string, current: string, opts: { out: string; failOn?: string }) => {
    const result = runCompare(baseline, current, opts.out);
    const s = result.summary;
    log.out('');
    log.out(`ReproCase v${result.tool.version} — comparison finished`);
    log.out(`Baseline: ${result.baseline.entry} (${result.baseline.pagesVisited} pages, ${result.baseline.startedAt})`);
    log.out(`Current:  ${result.current.entry} (${result.current.pagesVisited} pages, ${result.current.startedAt})`);
    log.out('');
    log.out(`New:        ${s.newCount}`);
    log.out(
      `Resolved:   ${s.resolvedCount}` +
        (s.resolvedUnconfirmedCount > 0
          ? ` (${s.resolvedUnconfirmedCount} unconfirmed — page not covered by the current scan)`
          : '')
    );
    log.out(`Persistent: ${s.persistentCount} (status changed: ${s.statusChangedCount})`);
    log.out(
      `Coverage:   +${result.coverage.addedPages.length} page(s), -${result.coverage.removedPages.length} page(s)` +
        (result.coverage.coverageShrunk ? ' — COVERAGE SHRANK, resolved entries are unconfirmed' : '')
    );
    log.out('');
    log.out(`HTML diff: ${path.join(opts.out, 'compare.html')}`);
    log.out(`JSON diff: ${path.join(opts.out, 'compare.json')}`);
    log.out('');
    if (opts.failOn === 'new' && s.newCount > 0) {
      log.out(`Exit code 1 — ${s.newCount} new finding(s) (--fail-on new).`);
      process.exitCode = 1;
    } else if (opts.failOn === 'any' && s.newCount + s.resolvedCount + s.statusChangedCount > 0) {
      log.out('Exit code 1 — differences exist (--fail-on any).');
      process.exitCode = 1;
    } else {
      process.exitCode = 0;
    }
  });

program
  .parseAsync(process.argv)
  .catch((e: unknown) => {
    if (e instanceof ConfigError) {
      log.error(e.message);
      process.exitCode = 2;
    } else {
      log.error(`Unexpected failure: ${(e as Error)?.message ?? String(e)}`);
      if ((e as Error)?.stack && log.isVerbose) log.error((e as Error).stack!);
      process.exitCode = 2;
    }
  });
