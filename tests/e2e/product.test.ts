import * as fs from 'node:fs';
import * as path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PROJECT_ROOT } from '../helpers/demo-server.js';

const run = promisify(exec);

let workDir: string;

beforeAll(() => {
  workDir = fs.mkdtempSync(path.join(PROJECT_ROOT, '.e2e-product-'));
});

afterAll(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

async function runCli(args: string, cwd = workDir): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await run(`node "${path.join(PROJECT_ROOT, 'dist', 'cli.js')}" ${args}`, {
      cwd,
      maxBuffer: 32 * 1024 * 1024
    });
    return { code: 0, stdout, stderr };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? -1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

describe('v0.2.0 product commands', () => {
  it('init writes a starter config, refuses overwrite, honors --force', async () => {
    const r1 = await runCli('init --entry http://127.0.0.1:4640/');
    expect(r1.code).toBe(0);
    expect(r1.stdout).toContain('Starter config written');
    const cfg = JSON.parse(fs.readFileSync(path.join(workDir, 'reprocase.config.json'), 'utf8'));
    expect(cfg.entry).toBe('http://127.0.0.1:4640/');

    const r2 = await runCli('init');
    expect(r2.code).toBe(2);
    expect(r2.stderr).toContain('already exists');

    const r3 = await runCli('init --force --entry http://127.0.0.1:9999/');
    expect(r3.code).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(workDir, 'reprocase.config.json'), 'utf8')).entry).toBe(
      'http://127.0.0.1:9999/'
    );
  });

  it('doctor reports a ready environment with exit 0', async () => {
    // Fresh directory without a config: config/target checks are warnings,
    // not failures — doctor must still exit 0 and list actionable hints.
    fs.rmSync(path.join(workDir, 'reprocase.config.json'), { force: true });
    const r = await runCli('doctor');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('ReproCase doctor');
    expect(r.stdout).toContain('Node.js version');
    expect(r.stdout).toContain('Chromium browser');
    expect(r.stdout).toContain('reprocase init');
  });

  it('compare classifies new/resolved/persistent and honors --fail-on new', async () => {
    const fault = (message: string, status: string) => ({
      tool: { name: 'ReproCase', version: '0.2.0-test' },
      startedAt: '2026-11-01T00:00:00.000Z',
      finishedAt: '2026-11-01T00:00:10.000Z',
      target: { entry: 'http://127.0.0.1:4640/', allowedDomains: ['127.0.0.1'] },
      config: {},
      stats: { pagesVisited: 2, actionsPerformed: 1, requestsObserved: 10, linksChecked: 2, durationMs: 5000, findingsRaw: 1, findingsAfterDedupe: 1 },
      findings: [
        {
          id: 'fp-x',
          fingerprint: 'x',
          type: 'js-exception',
          severity: 'high',
          status,
          confidence: 1,
          title: `Uncaught JS exception: ${message}`,
          url: 'http://127.0.0.1:4640/page.html',
          pages: ['http://127.0.0.1:4640/page.html'],
          evidence: { message },
          steps: [],
          repro: { attempts: 1, successes: 1, observedCount: 1 },
          screenshots: [],
          traces: [],
          plan: { kind: 'js-error', url: 'http://127.0.0.1:4640/page.html', message }
        }
      ],
      pages: [{ url: 'http://127.0.0.1:4640/page.html', depth: 0, status: 200, actions: 1, jsErrors: 1, resourceErrors: 0, overflow: false, durationMs: 1000 }],
      exploration: [],
      notChecked: [],
      summary: { verified: status === 'verified' ? 1 : 0, suspected: status === 'verified' ? 0 : 1, bySeverity: { critical: 0, high: 1, medium: 0, low: 0 }, byType: { 'js-exception': 1 } }
    });

    fs.writeFileSync(
      path.join(workDir, 'baseline.json'),
      JSON.stringify(fault('boom-kept', 'verified')),
      'utf8'
    );
    fs.writeFileSync(
      path.join(workDir, 'current.json'),
      JSON.stringify({
        ...fault('boom-kept', 'verified'),
        findings: [fault('boom-kept', 'verified').findings[0], fault('boom-fresh', 'verified').findings[0]]
      }),
      'utf8'
    );

    const r = await runCli(`compare "${path.join(workDir, 'baseline.json')}" "${path.join(workDir, 'current.json')}" --out "${path.join(workDir, 'diff')}"`);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('New:        1');
    expect(fs.existsSync(path.join(workDir, 'diff', 'compare.json'))).toBe(true);
    expect(fs.existsSync(path.join(workDir, 'diff', 'compare.html'))).toBe(true);
    const diff = JSON.parse(fs.readFileSync(path.join(workDir, 'diff', 'compare.json'), 'utf8'));
    expect(diff.summary.newCount).toBe(1);
    expect(diff.summary.persistentCount).toBe(1);

    const rFail = await runCli(`compare "${path.join(workDir, 'baseline.json')}" "${path.join(workDir, 'current.json')}" --out "${path.join(workDir, 'diff2')}" --fail-on new`);
    expect(rFail.code).toBe(1);
  });

  it('compare rejects non-ReproCase files with actionable guidance', async () => {
    fs.writeFileSync(path.join(workDir, 'junk.json'), JSON.stringify({ hello: true }), 'utf8');
    const r = await runCli(`compare "${path.join(workDir, 'junk.json')}" "${path.join(workDir, 'junk.json')}"`);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('not a ReproCase scan result');
  });

  it('npm pack installs and runs from an isolated directory', async () => {
    await runCli('--version', PROJECT_ROOT); // ensure dist exists
    const { stdout } = await run('npm pack', { cwd: PROJECT_ROOT, maxBuffer: 1024 * 1024 });
    const tarball = stdout.trim().split('\n').pop()!.trim();
    const pkgDir = path.join(workDir, 'pkg');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: 'pack-consumer', version: '1.0.0' }), 'utf8');
    const install = await runCli(`--version`, pkgDir); // sanity
    expect(install.code).toBe(0);
    await run(`npm install "${path.join(PROJECT_ROOT, tarball)}" --no-fund --no-audit`, {
      cwd: pkgDir,
      maxBuffer: 16 * 1024 * 1024
    });
    const viaPackage = await run(`npx reprocase --version`, { cwd: pkgDir, maxBuffer: 1024 * 1024 });
    expect(viaPackage.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    const initViaPackage = await run(`npx reprocase init --entry http://127.0.0.1:4640/`, { cwd: pkgDir, maxBuffer: 1024 * 1024 });
    expect(initViaPackage.stdout).toContain('Starter config written');
    expect(fs.existsSync(path.join(pkgDir, 'reprocase.config.json'))).toBe(true);
    fs.rmSync(path.join(PROJECT_ROOT, tarball), { force: true });
  }, 300_000);
});
