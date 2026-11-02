import * as fs from 'node:fs';
import * as path from 'node:path';
import { chromium } from 'playwright';
import { loadConfigFile, resolveConfig } from './config.js';
import { VERSION } from './version.js';
import { log } from './util/log.js';

export interface CheckResult {
  id: string;
  title: string;
  status: 'ok' | 'fail' | 'warn' | 'skip';
  detail: string;
  fix?: string;
}

export const STARTER_CONFIG: Record<string, unknown> = {
  entry: 'http://127.0.0.1:3000/',
  allowedDomains: [],
  maxPages: 25,
  maxDepth: 3,
  maxActionsPerPage: 10,
  verification: { attempts: 3 },
  capture: { screenshots: true, traces: 'auto' },
  report: { redactQuery: true }
};

/**
 * `reprocase init` — write a starter config without overwriting anything.
 * Returns the file path written, or null when the user declined/exists.
 */
export function runInit(options: { entry?: string; force?: boolean; out?: string }): string | null {
  const target = path.resolve(options.out ?? 'reprocase.config.json');
  if (fs.existsSync(target) && !options.force) {
    throw new Error(
      `"${target}" already exists. Use --force to overwrite it, or edit the file in place.`
    );
  }
  const config: Record<string, unknown> = { ...STARTER_CONFIG };
  if (options.entry) config.entry = options.entry;
  // Validate what we are about to write so init never produces a broken file.
  const { warnings } = resolveConfig(config);
  fs.writeFileSync(target, JSON.stringify(config, null, 2) + '\n', 'utf8');
  for (const w of warnings) log.warn(w);
  return target;
}

async function checkBrowser(): Promise<CheckResult> {
  try {
    const executable = chromium.executablePath();
    if (fs.existsSync(executable)) {
      return {
        id: 'browser',
        title: 'Playwright Chromium browser',
        status: 'ok',
        detail: executable
      };
    }
    return {
      id: 'browser',
      title: 'Playwright Chromium browser',
      status: 'fail',
      detail: `not found at ${executable}`,
      fix: 'npx playwright install chromium'
    };
  } catch (e) {
    return {
      id: 'browser',
      title: 'Playwright Chromium browser',
      status: 'fail',
      detail: (e as Error).message,
      fix: 'npm install && npx playwright install chromium'
    };
  }
}

function checkNode(): CheckResult {
  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 22) {
    return { id: 'node', title: 'Node.js version', status: 'ok', detail: process.versions.node };
  }
  return {
    id: 'node',
    title: 'Node.js version',
    status: 'fail',
    detail: `${process.versions.node} is unsupported — ReproCase requires Node >= 22 (Node 18 & 20 are End-of-Life)`,
    fix: 'install an LTS runtime: Node 22 or 24 (https://nodejs.org)'
  };
}

function checkConfig(): CheckResult {
  const file = path.resolve('reprocase.config.json');
  if (!fs.existsSync(file)) {
    return {
      id: 'config',
      title: 'Config file (reprocase.config.json)',
      status: 'warn',
      detail: 'not found in the current directory',
      fix: 'reprocase init   # creates a starter config'
    };
  }
  try {
    const partial = loadConfigFile(file);
    const { warnings } = resolveConfig(partial);
    if (warnings.length > 0) {
      return {
        id: 'config',
        title: 'Config file (reprocase.config.json)',
        status: 'warn',
        detail: warnings.join('; ')
      };
    }
    return { id: 'config', title: 'Config file (reprocase.config.json)', status: 'ok', detail: file };
  } catch (e) {
    return {
      id: 'config',
      title: 'Config file (reprocase.config.json)',
      status: 'fail',
      detail: (e as Error).message,
      fix: 'fix the JSON syntax, or delete the file and run reprocase init'
    };
  }
}

async function checkEntry(): Promise<CheckResult> {
  const file = path.resolve('reprocase.config.json');
  if (!fs.existsSync(file)) {
    return { id: 'entry', title: 'Scan target reachability', status: 'skip', detail: 'no config file' };
  }
  let entry: string;
  try {
    entry = String(loadConfigFile(file).entry ?? '');
  } catch {
    return { id: 'entry', title: 'Scan target reachability', status: 'skip', detail: 'config unreadable' };
  }
  if (!entry) {
    return {
      id: 'entry',
      title: 'Scan target reachability',
      status: 'warn',
      detail: 'config has no "entry"',
      fix: 'set "entry" in reprocase.config.json or pass --url when scanning'
    };
  }
  try {
    const res = await fetch(entry, { signal: AbortSignal.timeout(5000) });
    await res.body?.cancel().catch(() => undefined);
    if (res.ok) {
      return {
        id: 'entry',
        title: 'Scan target reachability',
        status: 'ok',
        detail: `${entry} -> HTTP ${res.status}`
      };
    }
    return {
      id: 'entry',
      title: 'Scan target reachability',
      status: 'warn',
      detail: `${entry} -> HTTP ${res.status} (the server responded; a failing page is a valid scan target)`
    };
  } catch (e) {
    return {
      id: 'entry',
      title: 'Scan target reachability',
      status: 'fail',
      detail: `${entry} unreachable: ${(e as Error).message.split('\n')[0]}`,
      fix: 'start the site (e.g. npm run dev) or correct "entry" in the config'
    };
  }
}

function checkOutDir(): CheckResult {
  try {
    fs.accessSync(process.cwd(), fs.constants.W_OK);
    return { id: 'out', title: 'Output location writable', status: 'ok', detail: process.cwd() };
  } catch {
    return {
      id: 'out',
      title: 'Output location writable',
      status: 'fail',
      detail: `${process.cwd()} is not writable`,
      fix: 'run ReproCase from a writable directory'
    };
  }
}

/** Collects all doctor checks. Browser check may take a moment on cold start. */
export async function collectDoctorChecks(): Promise<CheckResult[]> {
  return [checkNode(), await checkBrowser(), checkConfig(), await checkEntry(), checkOutDir()];
}

export function printDoctorReport(checks: CheckResult[]): boolean {
  log.out(`ReproCase doctor v${VERSION}`);
  let failures = 0;
  let warnings = 0;
  for (const c of checks) {
    const icon = c.status === 'ok' ? '[ok]' : c.status === 'fail' ? '[!!]' : c.status === 'warn' ? '[ !]' : '[--]';
    if (c.status === 'fail') failures++;
    if (c.status === 'warn') warnings++;
    log.out(`${icon} ${c.title}: ${c.detail}`);
    if (c.fix) log.out(`     fix: ${c.fix}`);
  }
  log.out('');
  const healthy = failures === 0;
  log.out(
    healthy
      ? `Environment is ready (${checks.length - failures - warnings} ok, ${warnings} warning(s), 0 failures).`
      : `${failures} check(s) failed — fix the [!!] items above and re-run reprocase doctor.`
  );
  return healthy;
}
