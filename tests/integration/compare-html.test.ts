import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium } from 'playwright';
import { renderCompareHtml, compareResults } from '../../src/compare.js';
import type { ScanResult } from '../../src/types.js';
import { makeFinding } from '../helpers/fixtures.js';

/**
 * compare.html must actually render in a real browser: a client-side runtime
 * error leaves the page blank while all unit tests stay green, so this guard
 * loads the report in Chromium and asserts visible, populated sections.
 */
function makeResult(message: string): ScanResult {
  return {
    tool: { name: 'ReproCase', version: '0.2.0-test' },
    startedAt: '2026-11-01T10:00:00.000Z',
    finishedAt: '2026-11-01T10:00:20.000Z',
    target: { entry: 'http://127.0.0.1:4640/', allowedDomains: ['127.0.0.1'] },
    config: {} as ScanResult['config'],
    stats: {
      pagesVisited: 1, actionsPerformed: 1, requestsObserved: 10, linksChecked: 1,
      durationMs: 5000, findingsRaw: 1, findingsAfterDedupe: 1
    },
    findings: [makeFinding({ evidence: { message } })],
    pages: [{ url: 'http://127.0.0.1:4640/demo.html', depth: 0, status: 200, actions: 1, jsErrors: 1, resourceErrors: 0, overflow: false, durationMs: 1000 }],
    exploration: [],
    notChecked: [],
    summary: { verified: 1, suspected: 0, bySeverity: { critical: 0, high: 1, medium: 0, low: 0 }, byType: { 'js-exception': 1 } }
  };
}

describe('compare.html renders in a real browser', () => {
  let htmlFile: string;

  beforeAll(() => {
    const baseline = makeResult('boom-one');
    const current = makeResult('boom-two'); // same page, different signature -> new + resolved
    const diff = compareResults(baseline, current);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprocase-cmphp-'));
    htmlFile = path.join(dir, 'compare.html');
    fs.writeFileSync(htmlFile, renderCompareHtml(diff), 'utf8');
  });

  afterAll(() => {
    fs.rmSync(path.dirname(htmlFile), { recursive: true, force: true });
  });

  it('populates summary, new/resolved/persistent sections without page errors', async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const pageErrors: string[] = [];
      page.on('pageerror', (e) => pageErrors.push(e.message));
      await page.goto('file:///' + htmlFile.replace(/\\/g, '/'));
      await page.waitForTimeout(400);
      const state = await page.evaluate(() => ({
        stats: document.querySelectorAll('#summary .stat').length,
        newCards: document.querySelectorAll('#new .card').length,
        resolvedCards: document.querySelectorAll('#resolved .card').length,
        persistentCards: document.querySelectorAll('#persistent .card').length,
        firstNewLabel: document.querySelector('#new .card .title')?.textContent ?? ''
      }));
      expect(pageErrors, pageErrors.join('; ')).toEqual([]);
      expect(state.stats).toBe(4);
      expect(state.newCards).toBe(1);
      expect(state.resolvedCards).toBe(1);
      expect(state.persistentCards).toBe(0);
      expect(state.firstNewLabel).toContain('Test finding 2');
    } finally {
      await browser.close().catch(() => undefined);
    }
  }, 120_000);
});
