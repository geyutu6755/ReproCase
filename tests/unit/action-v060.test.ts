import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROJECT_ROOT } from '../helpers/demo-server.js';

const ACTION_YML = path.join(PROJECT_ROOT, '.github', 'actions', 'reprocase-scan', 'action.yml');
const yml = fs.readFileSync(ACTION_YML, 'utf8');

describe('v0.6.0 ref normalisation (P0 fix)', () => {
  it('normalises refs/tags/ to bare tag', () => {
    expect(yml).toContain("refs/tags/*)   REF=\"${REF#refs/tags/}\"");
  });

  it('normalises refs/heads/ to bare branch', () => {
    expect(yml).toContain("refs/heads/*)  REF=\"${REF#refs/heads/}\"");
  });

  it('strips generic refs/ prefix as last resort', () => {
    expect(yml).toContain("refs/*)        REF=\"${REF#refs/}\"");
  });

  it('detects 40-char SHA and uses full clone (not --branch)', () => {
    expect(yml).toContain("grep -qP '^[0-9a-f]{40}$'");
    expect(yml).toContain('IS_SHA=true');
  });

  it('SHA mode uses full clone + git checkout (not --branch)', () => {
    expect(yml).toContain('git clone https://github.com/geyutu6755/ReproCase.git');
    expect(yml).toContain('git checkout "$REF"');
  });

  it('verifies SHA checkout matches the requested SHA', () => {
    expect(yml).toContain("does not match requested SHA");
  });

  it('rejects shell injection characters in the ref', () => {
    expect(yml).toContain('unsafe characters');
    expect(yml).toContain('[;&|`$(){}!\\[\\]<>\\\\]');
  });

  it('rejects path traversal in the ref', () => {
    expect(yml).toContain("path traversal");
    expect(yml).toContain("'..'");
  });

  it('rejects empty ref with explicit error', () => {
    expect(yml).toContain('reprocase-ref is empty');
  });

  it('does NOT use caller github.ref — only github.action_ref for defaults', () => {
    // github.ref would be the CALLER's branch/tag, not the action's version.
    // Using it would install the wrong code.
    const installBlock = yml.slice(
      yml.indexOf('    - name: Install ReproCase'),
      yml.indexOf('    - name: Install Chromium')
    );
    expect(installBlock).not.toContain('github.ref');
    expect(installBlock).toContain('github.action_ref');
  });

  it('resolves ref BEFORE clone (normalisation happens first)', () => {
    const normalisePos = yml.indexOf("refs/tags/*)");
    const clonePos = yml.indexOf('git clone --depth 1 --branch');
    expect(normalisePos).toBeLessThan(clonePos);
  });

  it('exports reprocase-commit and reprocase-ref-resolved outputs', () => {
    expect(yml).toContain('reprocase-commit=');
    expect(yml).toContain('reprocase-ref-resolved=');
  });
});

describe('v0.6.0 Job Summary (GITHUB_STEP_SUMMARY)', () => {
  it('writes to GITHUB_STEP_SUMMARY', () => {
    expect(yml).toContain('GITHUB_STEP_SUMMARY');
  });

  it('generates summary even when scan fails (if: always())', () => {
    const summaryStep = yml.slice(
      yml.indexOf('    - name: Generate Job Summary'),
      yml.indexOf('    - name: Publish privacy-stripped report')
    );
    expect(summaryStep).toContain('if: ${{ always() }}');
  });

  it('sanitises scanned-site text in the summary (HTML entity escaping)', () => {
    expect(yml).toContain('&amp;');
    expect(yml).toContain('&lt;');
    expect(yml).toContain('&gt;');
    expect(yml).toContain('&quot;');
  });

  it('truncates long values in the summary', () => {
    expect(yml).toContain("s.slice(0, max)");
  });

  it('shows observation timeouts when present', () => {
    expect(yml).toContain('observationTimeouts');
    expect(yml).toContain('not fully observed');
  });

  it('shows compare results when baseline is provided', () => {
    expect(yml).toContain('Changes vs baseline');
    expect(yml).toContain('resolvedUnconfirmedCount');
    expect(yml).toContain('coverageShrunk');
  });

  it('shows the gate result with clear reasoning', () => {
    expect(yml).toContain('Gate result:');
    expect(yml).toContain('Baseline gate FAILED');
    expect(yml).toContain('Baseline gate passed');
  });

  it('references the report artifact by name', () => {
    expect(yml).toContain('reprocase-report/report.html');
  });

  it('notes that traces are private', () => {
    expect(yml).toContain('private evidence');
  });
});
