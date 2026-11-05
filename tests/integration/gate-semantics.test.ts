import { afterAll, describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PROJECT_ROOT } from '../helpers/demo-server.js';

/**
 * Integration tests for the v0.5.1 fail-on-new and compare-exit semantics
 * that the composite action's gate step relies on. Each test runs the real
 * `reprocase compare` CLI and asserts the exit code, mirroring the action.
 */

const CLI = path.join(PROJECT_ROOT, 'dist', 'cli.js');

function makeResult(message: string, url: string, status: string) {
  return {
    tool: { name: 'ReproCase', version: '0.5.1-test' },
    startedAt: '2026-11-06T00:00:00.000Z',
    finishedAt: '2026-11-06T00:00:10.000Z',
    target: { entry: 'http://127.0.0.1:4640/', allowedDomains: ['127.0.0.1'] },
    config: {},
    stats: { pagesVisited: 1, actionsPerformed: 1, requestsObserved: 10, linksChecked: 2, durationMs: 5000, findingsRaw: 1, findingsAfterDedupe: 1 },
    findings: [{
      id: 'fp-' + Math.abs(message.length * 31 + url.length),
      fingerprint: message + '|' + url,
      type: 'js-exception',
      severity: 'high',
      status,
      confidence: 1,
      title: `Uncaught JS exception: ${message}`,
      url,
      pages: [url],
      evidence: { message },
      steps: [],
      repro: { attempts: 1, successes: 1, observedCount: 1 },
      screenshots: [],
      traces: [],
      plan: { kind: 'js-error', url, message }
    }],
    pages: [{ url, depth: 0, status: 200, actions: 1, jsErrors: 1, resourceErrors: 0, overflow: false, durationMs: 1000 }],
    exploration: [],
    notChecked: [],
    clusters: [],
    summary: {
      verified: status === 'verified' ? 1 : 0,
      suspected: status === 'verified' ? 0 : 1,
      bySeverity: { critical: 0, high: 1, medium: 0, low: 0 },
      byType: { 'js-exception': 1 }
    }
  };
}

function runCompare(baselineFile: string, currentFile: string, extraArgs: string[]): { code: number; stdout: string } {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'reprocase-gate-'));
  try {
    execSync(
      `node dist/cli.js compare "${baselineFile}" "${currentFile}" --out "${out}" ${extraArgs.join(' ')}`,
      { cwd: PROJECT_ROOT, timeout: 30000, stdio: 'pipe' }
    );
    return { code: 0, stdout: '' };
  } catch (e: unknown) {
    const err = e as { status?: number };
    return { code: err.status ?? -1, stdout: '' };
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
}

function writeResult(dir: string, name: string, data: object): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(data), 'utf8');
  return file;
}

describe('compare gate semantics (v0.5.1 reliability)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reprocase-gate-test-'));

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('baseline has verified finding, current has the same (no new) → exit 0 with --fail-on new', () => {
    const base = writeResult(tmp, 'base.json', makeResult('boom', 'http://x/a.html', 'verified'));
    const cur = writeResult(tmp, 'cur.json', makeResult('boom', 'http://x/a.html', 'verified'));
    const r = runCompare(base, cur, ['--fail-on', 'new']);
    expect(r.code).toBe(0);
  });

  it('baseline has 1 finding, current has a different one (new) → exit 1 with --fail-on new', () => {
    const base = writeResult(tmp, 'base2.json', makeResult('old fault', 'http://x/a.html', 'verified'));
    const cur = writeResult(tmp, 'cur2.json', makeResult('new fault', 'http://x/a.html', 'verified'));
    const r = runCompare(base, cur, ['--fail-on', 'new']);
    expect(r.code).toBe(1);
  });

  it('baseline has 1 finding, current has it + a new one → exit 1 with --fail-on new', () => {
    const base = writeResult(tmp, 'base3.json', makeResult('old fault', 'http://x/a.html', 'verified'));
    const cur = writeResult(tmp, 'cur3.json', makeResult('old fault', 'http://x/a.html', 'verified'));
    const cur3 = writeResult(tmp, 'cur3b.json', {
      ...makeResult('old fault', 'http://x/a.html', 'verified'),
      findings: [
        ...(makeResult('old fault', 'http://x/a.html', 'verified').findings),
        makeResult('new fault', 'http://x/a.html', 'verified').findings[0]
      ]
    });
    const r = runCompare(base, cur3, ['--fail-on', 'new']);
    expect(r.code).toBe(1);
  });

  it('old finding fixed → exit 0 with --fail-on new (resolved is not new)', () => {
    const base = writeResult(tmp, 'base4.json', makeResult('old fault', 'http://x/a.html', 'verified'));
    const noFindings = { ...makeResult('nothing', 'http://x/a.html', 'verified'), findings: [], summary: { ...makeResult('nothing', 'http://x/a.html', 'verified').summary, verified: 0, suspected: 0, byType: {} } };
    const cur = writeResult(tmp, 'cur4.json', noFindings);
    const r = runCompare(base, cur, ['--fail-on', 'new']);
    expect(r.code).toBe(0);
  });

  it('no --fail-on flag → exit 0 regardless of new findings (report only)', () => {
    const base = writeResult(tmp, 'base5.json', makeResult('old fault', 'http://x/a.html', 'verified'));
    const cur = writeResult(tmp, 'cur5.json', makeResult('new fault', 'http://x/a.html', 'verified'));
    const r = runCompare(base, cur, []);
    expect(r.code).toBe(0);
  });

  it('baseline file missing → exit 2 (error, not success)', () => {
    const cur = writeResult(tmp, 'cur6.json', makeResult('boom', 'http://x/a.html', 'verified'));
    const r = runCompare(path.join(tmp, 'nonexistent.json'), cur, ['--fail-on', 'new']);
    expect(r.code).toBe(2);
  });
});
