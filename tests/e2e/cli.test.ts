import * as fs from 'node:fs';
import * as path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PROJECT_ROOT, startDemoServer } from '../helpers/demo-server.js';
import type { StaticServer } from '../../src/dev-server.js';

const run = promisify(exec);

let server: StaticServer;
let workDir: string;

beforeAll(async () => {
  // Build the real CLI artifact exactly like a release would.
  await run('npx tsc -p tsconfig.json', { cwd: PROJECT_ROOT });
  server = await startDemoServer();
  // Inside the project so the generated specs can resolve @playwright/test
  // from our own node_modules — exactly like a user's project would.
  workDir = fs.mkdtempSync(path.join(PROJECT_ROOT, '.e2e-'));
}, 180_000);

afterAll(async () => {
  await server.close();
  fs.rmSync(workDir, { recursive: true, force: true });
});

async function runCli(args: string): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await run(`node dist/cli.js ${args}`, {
      cwd: PROJECT_ROOT,
      maxBuffer: 16 * 1024 * 1024
    });
    return { code: 0, stdout, stderr };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? -1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

describe('CLI end-to-end', () => {
  it(
    'scan: detects the four planted faults, exits 1 and writes the full report bundle',
    async () => {
      const out = path.join(workDir, 'faults');
      fs.writeFileSync(path.join(workDir, 'faults.config.json'), JSON.stringify({ entry: server.url, maxPages: 12 }));
      const r = await runCli(`scan --config "${path.join(workDir, 'faults.config.json')}" --out "${out}" -q`);

      expect(r.code, `stderr: ${r.stderr}`).toBe(1);
      const result = JSON.parse(fs.readFileSync(path.join(out, 'result.json'), 'utf8'));
      const types = new Set(result.findings.map((f: { type: string }) => f.type));
      expect(types.has('js-exception')).toBe(true);
      expect(types.has('page-load-failure')).toBe(true);
      expect(types.has('horizontal-overflow')).toBe(true);
      expect(types.has('resource-load-failure')).toBe(true);
      expect(types.has('broken-internal-link')).toBe(true);

      for (const f of result.findings) {
        if (f.type === 'console-error') continue;
        expect(f.status).toBe('verified');
        expect(f.generatedTest).toMatch(/^generated-tests\/.+\.spec\.ts$/);
      }

      // Full bundle layout:
      expect(fs.existsSync(path.join(out, 'report.html'))).toBe(true);
      expect(fs.existsSync(path.join(out, 'index.html'))).toBe(true);
      expect(fs.existsSync(path.join(out, 'issues.md'))).toBe(true);
      const issueFiles = fs.readdirSync(path.join(out, 'issues'));
      expect(issueFiles.length).toBe(result.findings.length);
      const specs = fs.readdirSync(path.join(out, 'generated-tests')).filter((f) => f.endsWith('.spec.ts'));
      expect(specs.length).toBe(result.summary.verified);
    },
    300_000
  );

  it(
    'generated tests reproduce the faults through the real Playwright runner',
    async () => {
      const generatedDir = path.join(workDir, 'faults', 'generated-tests');
      try {
        const { stdout } = await run('npx playwright test --config playwright.config.mjs', {
          cwd: generatedDir,
          maxBuffer: 16 * 1024 * 1024
        });
        expect(stdout).toMatch(/passed/);
        expect(stdout).not.toMatch(/\b\d+ failed\b/);
      } catch (e) {
        const err = e as { message?: string; stdout?: string; stderr?: string };
        throw new Error(
          `generated tests failed: ${err.message ?? ''}\nSTDOUT:\n${err.stdout ?? ''}\nSTDERR:\n${err.stderr ?? ''}`
        );
      }
    },
    300_000
  );

  it(
    'scan: clean control entry exits 0 with zero findings',
    async () => {
      const out = path.join(workDir, 'clean');
      fs.writeFileSync(
        path.join(workDir, 'clean.config.json'),
        JSON.stringify({ entry: new URL('clean.html', server.url).href, maxPages: 4 })
      );
      const r = await runCli(`scan --config "${path.join(workDir, 'clean.config.json')}" --out "${out}" -q`);
      expect(r.code, `stderr: ${r.stderr}`).toBe(0);
      const result = JSON.parse(fs.readFileSync(path.join(out, 'result.json'), 'utf8'));
      expect(result.findings).toEqual([]);
    },
    300_000
  );

  it(
    'scan: unreachable entry exits 2 with an entryUnreachable marker',
    async () => {
      // Find a port with nothing listening on it.
      const probe = await import('node:http');
      const srv = probe.createServer();
      const port: number = await new Promise((resolve) => {
        srv.listen(0, '127.0.0.1', () => resolve((srv.address() as { port: number }).port));
      });
      await new Promise((resolve) => srv.close(resolve));

      const out = path.join(workDir, 'unreachable');
      const r = await runCli(`scan --url http://127.0.0.1:${port}/ --out "${out}" -q`);
      expect(r.code).toBe(2);
      const result = JSON.parse(fs.readFileSync(path.join(out, 'result.json'), 'utf8'));
      expect(result.entryUnreachable).toBe(true);
      expect(result.findings.length).toBeGreaterThan(0); // honestly recorded as a finding too
    },
    120_000
  );

  it('--version prints the package version', async () => {
    const r = await runCli('--version');
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
