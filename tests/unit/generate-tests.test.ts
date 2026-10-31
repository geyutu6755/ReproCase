import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateTests } from '../../src/generate-tests.js';
import { makeFinding } from '../helpers/fixtures.js';

function tmpOut(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'reprocase-gen-'));
}

const VIEWPORTS = {
  desktop: { width: 1280, height: 720 },
  mobile: { width: 390, height: 844 }
};

describe('generateTests', () => {
  it('creates a spec per verified finding plus config and README', () => {
    const out = tmpOut();
    const findings = [
      makeFinding({ id: 'fp-aaaa1111' }),
      makeFinding({ id: 'fp-bbbb2222', status: 'suspected' }),
      makeFinding({
        id: 'fp-cccc3333',
        type: 'horizontal-overflow',
        title: 'Horizontal overflow on mobile viewport',
        evidence: { viewport: 'mobile', scrollWidth: 736, clientWidth: 390 },
        plan: { kind: 'overflow', url: 'http://127.0.0.1:4610/overflow.html', viewport: 'mobile' },
        steps: []
      })
    ];
    const files = generateTests(findings, out, VIEWPORTS);
    expect(files.filter((f) => f.endsWith('.spec.ts'))).toHaveLength(2); // suspected one is skipped
    expect(fs.existsSync(path.join(out, 'generated-tests', 'playwright.config.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'generated-tests', 'README.md'))).toBe(true);

    const jsSpec = fs.readFileSync(path.join(out, 'generated-tests', 'reprocase-fp-aaaa1111-01.spec.ts'), 'utf8');
    expect(jsSpec).toContain("import { test, expect } from '@playwright/test';");
    expect(jsSpec).toContain("page.goto(\"http://127.0.0.1:4610/demo.html\"");
    expect(jsSpec).toContain('page.click("#break-btn")');
    expect(jsSpec).toContain('Boom: test error');
    expect(jsSpec).toContain('reproduces');

    const overflowSpec = fs.readFileSync(
      path.join(out, 'generated-tests', 'reprocase-fp-cccc3333-02.spec.ts'),
      'utf8'
    );
    expect(overflowSpec).toContain('test.use({ viewport: { width: 390, height: 844 } })');
    expect(overflowSpec).toContain('toBeGreaterThan(2)');
    expect(overflowSpec).toContain('/overflow.html');
  });

  it('generates status-based specs for load failures', () => {
    const out = tmpOut();
    const findings = [
      makeFinding({
        id: 'fp-dddd4444',
        type: 'page-load-failure',
        title: 'Page failed to load with HTTP 404',
        evidence: { statusCode: 404 },
        steps: [],
        plan: { kind: 'goto-status', url: 'http://127.0.0.1:4610/gone.html', statusCode: 404 }
      })
    ];
    generateTests(findings, out, VIEWPORTS);
    const spec = fs.readFileSync(path.join(out, 'generated-tests', 'reprocase-fp-dddd4444-01.spec.ts'), 'utf8');
    expect(spec).toContain('page.goto("http://127.0.0.1:4610/gone.html"');
    expect(spec).toContain('resp.status() >= 400');
    expect(spec).toContain('After fixing the bug');
  });

  it('sets generatedTest on each verified finding and skips suspected ones', () => {
    const out = tmpOut();
    const verified = makeFinding({ id: 'fp-eeee5555' });
    const suspected = makeFinding({ id: 'fp-ffff6666', status: 'suspected' });
    generateTests([verified, suspected], out, VIEWPORTS);
    expect(verified.generatedTest).toMatch(/^generated-tests\/reprocase-fp-eeee5555-01\.spec\.ts$/);
    expect(suspected.generatedTest).toBeUndefined();
  });
});
