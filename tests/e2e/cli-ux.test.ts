import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PROJECT_ROOT, startDemoServer } from '../helpers/demo-server.js';
import type { StaticServer } from '../../src/dev-server.js';

let server: StaticServer;
let workDir: string;

beforeAll(async () => {
  server = await startDemoServer();
  workDir = fs.mkdtempSync(path.join(PROJECT_ROOT, '.e2e-ux-'));
});

afterAll(async () => {
  await server.close();
  fs.rmSync(workDir, { recursive: true, force: true });
});

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], opts: { cwd?: string; env?: Record<string, string>; timeoutMs?: number } = {}): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(PROJECT_ROOT, 'dist', 'cli.js'), ...args], {
      cwd: opts.cwd ?? workDir,
      env: { ...process.env, ...(opts.env ?? {}) },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          child.kill('SIGINT');
        }, opts.timeoutMs)
      : undefined;
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

describe('CLI failure handling and messages (v0.2.1 UX)', () => {
  it('unknown command prints the error and points at the help', async () => {
    const r = await runCli(['frobnicate']);
    expect([1, 2]).toContain(r.code);
    expect(r.stderr).toContain("unknown command 'frobnicate'");
    expect(r.stderr).toContain('reprocase --help');
  });

  it('invalid config JSON fails with the file path and a fix hint', async () => {
    fs.writeFileSync(path.join(workDir, 'broken.config.json'), '{ entry: oops', 'utf8');
    const r = await runCli(['scan', '--config', path.join(workDir, 'broken.config.json')]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('not valid JSON');
    expect(r.stderr).toContain('broken.config.json');
  });

  it('unreachable entry exits 2 with actionable guidance', async () => {
    // Reserve a port, then free it — nothing listens there afterwards.
    const http = await import('node:http');
    const probe = http.createServer();
    const port: number = await new Promise((resolve) => {
      probe.listen(0, '127.0.0.1', () => resolve((probe.address() as { port: number }).port));
    });
    await new Promise((resolve) => probe.close(resolve));

    const r = await runCli(['scan', '--url', `http://127.0.0.1:${port}/`, '--out', path.join(workDir, 'dead')]);
    expect(r.code).toBe(2);
    expect(r.stdout).toContain('could not be reached at all');
    expect(r.stdout).toContain('reprocase doctor');
  });

  it('missing Chromium produces the exact fix command instead of a raw stack', async () => {
    const emptyBrowsers = path.join(workDir, 'no-browsers');
    fs.mkdirSync(emptyBrowsers, { recursive: true });
    const r = await runCli(['scan', '--url', server.url, '--out', path.join(workDir, 'nb')], {
      env: { PLAYWRIGHT_BROWSERS_PATH: emptyBrowsers }
    });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('npx playwright install chromium');
    expect(r.stderr).toContain('reprocase doctor');
    expect(r.stderr).not.toContain('at Object.');
  });

  it('unwritable output location names the directory and the fix', async () => {
    // A nested path under an existing FILE forces mkdir to fail (ENOTDIR/EEXIST).
    const blockFile = path.join(workDir, 'not-a-dir');
    fs.writeFileSync(blockFile, 'x', 'utf8');
    const r = await runCli(['scan', '--url', server.url, '--out', path.join(blockFile, 'sub', 'dir')]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('Cannot create the output directory');
    expect(r.stderr).toContain('--out');
  });

  it('handles output paths with spaces and non-ASCII characters', async () => {
    const out = path.join(workDir, '我的 报告 directory');
    const r = await runCli(['scan', '--url', server.url, '--out', out, '-q']);
    expect(r.code).toBe(1); // demo pages contain planted faults
    expect(fs.existsSync(path.join(out, 'report.html'))).toBe(true);
    expect(fs.readdirSync(path.join(out, 'artifacts', 'screenshots')).length).toBeGreaterThan(0);
  }, 240_000);
});
