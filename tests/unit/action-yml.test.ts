import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROJECT_ROOT } from '../helpers/demo-server.js';

const ACTION_YML = path.join(PROJECT_ROOT, '.github', 'actions', 'reprocase-scan', 'action.yml');
const yml = fs.readFileSync(ACTION_YML, 'utf8');

describe('composite action structure (v0.5.1 reliability)', () => {
  it('declares all documented inputs', () => {
    for (const input of ['url', 'reprocase-ref', 'config', 'compare-with', 'fail-on', 'fail-on-new', 'max-pages', 'detection-window-ms', 'report-name', 'node-version']) {
      expect(yml, `input "${input}" must be declared`).toContain(`  ${input}:`);
    }
  });

  it('declares all documented outputs', () => {
    for (const output of ['verdict', 'exit-code', 'scan-exit-code', 'new-findings']) {
      expect(yml, `output "${output}" must be declared`).toContain(`  ${output}:`);
    }
  });

  it('scan step does NOT exit 1 — decision step handles it (v0.5.1 fix)', () => {
    // The scan step must complete successfully on exit 1 so the gate step
    // can run. The final decision step produces the CI exit code.
    // Exit 2 for environment errors is still an immediate exit.
    expect(yml).toContain('exit 2');
    // The scan step must NOT contain a bare `exit "$CODE"` after case (which
    // was the v0.5.0 bug: exit 1 propagated, skipping the gate).
    expect(yml).not.toContain('exit "$CODE"');
  });

  it('gate step reads FAIL_ON_NEW env var (v0.5.0 bug: declared but unused)', () => {
    expect(yml).toContain('FAIL_ON_NEW');
    expect(yml).toContain('GATE_FLAG');
    expect(yml).toContain("GATE_FLAG=\"--fail-on new\"");
    expect(yml).toContain('GATE_FLAG=""');
  });

  it('gate step handles invalid fail-on-new values with an explicit error', () => {
    expect(yml).toContain('Invalid fail-on-new value');
  });

  it('gate step is skipped when scan has an error (exit 2)', () => {
    const gateIf = yml.match(/- name: Compare with baseline[\s\S]*?if: (.*?)(?=\n)/);
    expect(gateIf).toBeTruthy();
    expect(gateIf![1]).toContain("!= 'error'");
  });

  it('decision step prioritises: error (2) > gate (1) > findings (1) > clean (0)', () => {
    const decisionBlock = yml.slice(
      yml.indexOf('    - name: Final CI decision'),
      yml.indexOf('    - name: Publish privacy-stripped report')
    );
    expect(decisionBlock).toContain('exit 2');
    expect(decisionBlock).toContain('exit 1');
    expect(decisionBlock).toContain('exit 0');
    const errorPos = decisionBlock.indexOf('exit 2');
    const gatePos = decisionBlock.indexOf('exit 1');
    const cleanPos = decisionBlock.indexOf('exit 0');
    expect(errorPos).toBeLessThan(gatePos);
    expect(gatePos).toBeLessThan(cleanPos);
  });

  it('install step supports SHA checkout with explicit error for missing refs', () => {
    expect(yml).toContain('git checkout');
    expect(yml).toContain('git cat-file');
    expect(yml).toContain('not found as a tag, branch or commit SHA');
    expect(yml).toContain('git rev-parse HEAD');
  });

  it('install step uses npm ci (lockfile reproducibility, not npm install)', () => {
    expect(yml).toContain('npm ci');
    // The action must NOT use bare npm install for dependencies (only
    // `npm install -g .` for the final global install of the built package).
    expect(yml).not.toMatch(/npm install --no-fund --no-audit(?!\s+-g)/);
  });

  it('artifact upload skips traces and only runs when the report exists', () => {
    expect(yml).toContain('rm -rf reprocase-report/artifacts/traces');
    expect(yml).toContain("hashFiles('reprocase-report/**') != ''");
  });

  it('gate step is skipped when scan has an error (exit 2)', () => {
    const gateIf = yml.match(/- name: Compare with baseline[\s\S]*?if: (.*?)(?=\n)/);
    expect(gateIf![1]).toContain("!= 'error'");
  });

  it('final decision step references both scan verdict and gate conclusion', () => {
    expect(yml).toContain('SCAN_VERDICT');
    expect(yml).toContain('GATE_CONCLUSION');
    expect(yml).toContain('INSTALL_CONCLUSION');
  });
});
