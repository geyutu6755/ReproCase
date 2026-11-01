import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium } from 'playwright';
import { renderHtml } from '../../src/report/html.js';
import { compareResults } from '../../src/compare.js';
import { aggregateFindings } from '../../src/aggregate.js';
import type { ScanResult } from '../../src/types.js';
import { makeFinding } from '../helpers/fixtures.js';

/**
 * Real-browser UX audit of the HTML report — layout, keyboard accessibility,
 * search, copy fallback, empty state and mobile layout. Unit tests cannot
 * catch client-side runtime problems, so every assertion here runs in
 * Chromium against the actual rendered report.
 */
function makeResult(findings: ReturnType<typeof makeFinding>[], pages = 3): ScanResult {
  return {
    tool: { name: 'ReproCase', version: '0.2.1-test' },
    startedAt: '2026-11-01T10:00:00.000Z',
    finishedAt: '2026-11-01T10:00:20.000Z',
    target: { entry: 'http://127.0.0.1:4640/', allowedDomains: ['127.0.0.1'] },
    config: {} as ScanResult['config'],
    stats: {
      pagesVisited: pages, actionsPerformed: 4, requestsObserved: 25, linksChecked: 5,
      durationMs: 20000, findingsRaw: findings.length, findingsAfterDedupe: findings.length
    },
    findings,
    pages: Array.from({ length: pages }, (_, i) => ({
      url: `http://127.0.0.1:4640/page${i}.html`, depth: 0, status: 200, actions: 2,
      jsErrors: 0, resourceErrors: 0, overflow: false, durationMs: 1000
    })),
    exploration: [
      { page: 'http://127.0.0.1:4640/page0.html', description: 'click button "Run report"', outcome: 'skipped-risky', note: 'soft risky keyword' },
      { page: 'http://127.0.0.1:4640/page0.html', description: 'click button "Toggle theme"', outcome: 'explored' }
    ],
    notChecked: [{ area: 'Forms', reason: 'Not exercised.' }],
    summary: {
      verified: findings.filter((f) => f.status === 'verified').length,
      suspected: findings.filter((f) => f.status === 'suspected').length,
      bySeverity: { critical: 0, high: findings.length, medium: 0, low: 0 },
      byType: { 'js-exception': findings.length }
    }
  };
}

describe('HTML report UX (real browser audit)', () => {
  let htmlFile: string;
  let emptyFile: string;
  let browser: import('playwright').Browser;

  beforeAll(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprocase-reportux-'));
    const withFinding = makeResult([
      makeFinding({
        title: 'Uncaught JS exception: Boom with a very long unbroken token aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        evidence: {
          message: 'Boom with a very long unbroken token aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          stack: 'Error: boom\n    at http://127.0.0.1:4640/js-error.html?token=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:1:1'
        },
        steps: [{ action: 'click', description: 'click button "Break it"', selector: '#break-btn' }]
      })
    ]);
    htmlFile = path.join(dir, 'report.html');
    fs.writeFileSync(htmlFile, renderHtml(withFinding), 'utf8');
    emptyFile = path.join(dir, 'empty.html');
    fs.writeFileSync(emptyFile, renderHtml(makeResult([])), 'utf8');
  });

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await browser.close().catch(() => undefined);
  });

  it('keyboard: toolbar controls are reachable, screenshots open/close with Enter and Escape', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.goto('file:///' + htmlFile.replace(/\\/g, '/'));
    // The search field and all toolbar controls are keyboard-reachable.
    const focused: string[] = [];
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      focused.push(await page.evaluate(() => (document.activeElement as HTMLElement).id || (document.activeElement as HTMLElement).tagName));
    }
    expect(focused, 'search must be keyboard-reachable').toContain('q');
    for (const id of ['sev', 'status', 'type', 'sort']) {
      expect(focused, `${id} select must be keyboard-reachable`).toContain(id);
    }
    // Keyboard-operable screenshot lightbox.
    await page.focus('.shots img');
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => document.getElementById('lightbox')!.style.display)).toBe('flex');
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => document.getElementById('lightbox')!.style.display)).toBe('none');
    expect(pageErrors).toEqual([]);
    await page.close();
  }, 120_000);

  it('search filters findings live and the copy button works from file:// (fallback path)', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto('file:///' + htmlFile.replace(/\\/g, '/'));
    await page.fill('#q', 'zzz-no-match');
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => document.querySelectorAll('.finding').length)).toBe(0);
    expect(await page.evaluate(() => document.getElementById('findings')!.textContent)).toContain('No findings match');
    await page.fill('#q', 'boom');
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => document.querySelectorAll('.finding').length)).toBe(1);
    // file:// has no clipboard permission — the fallback (execCommand) must work.
    await page.click('.copy-btn');
    await page.waitForTimeout(250);
    expect((await page.textContent('.copy-btn'))).toBe('Copied!');
    await page.close();
  }, 120_000);

  it('long unbroken tokens never cause horizontal page overflow (desktop + mobile)', async () => {
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport });
      await page.goto('file:///' + htmlFile.replace(/\\/g, '/'));
      await page.waitForTimeout(300);
      const overflow = await page.evaluate(() => ({
        client: document.documentElement.clientWidth,
        scroll: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)
      }));
      expect(overflow.scroll - overflow.client, `viewport ${viewport.width}px`).toBeLessThanOrEqual(2);
      await page.close();
    }
  }, 120_000);

  it('empty scan shows a clear all-clear state and hides the toolbar', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto('file:///' + emptyFile.replace(/\\/g, '/'));
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => document.querySelector('#findings .empty')!.textContent)).toContain('No issues found');
    expect(await page.evaluate(() => (document.getElementById('toolbar') as HTMLElement).style.display)).toBe('none');
    // No findings page must also be overflow-safe on mobile.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(250);
    const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(2);
    await page.close();
  }, 120_000);

  it('clusters render with expandable affected pages (v0.3.0)', async () => {
    // Two pages hitting the same root cause -> one cluster with 2 members.
    const members = [
      makeFinding({ url: 'http://127.0.0.1:4640/a.html', evidence: { message: 'Boom: shared', stack: 'Error: Boom: shared\n    at save (http://127.0.0.1:4640/app.js:1:1)' } }),
      makeFinding({ url: 'http://127.0.0.1:4640/b.html', evidence: { message: 'Boom: shared', stack: 'Error: Boom: shared\n    at save (http://127.0.0.1:4640/app.js:1:1)' } })
    ];
    const clustered = { ...makeResult(members), clusters: aggregateFindings(members) };
    const file = path.join(path.dirname(htmlFile), 'clustered.html');
    fs.writeFileSync(file, renderHtml(clustered as ScanResult), 'utf8');

    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.goto('file:///' + file.replace(/\\/g, '/'));
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => document.querySelectorAll('#clusters .finding').length)).toBe(1);
    const summaryText = await page.evaluate(() => document.querySelector('#clusters h3')!.textContent);
    expect(summaryText).toContain('2 pages');
    // Expandable: affected pages hidden until the details element opens.
    const visibleBefore = await page.evaluate(() => {
      const d = document.querySelector('#clusters details') as HTMLDetailsElement;
      return d.open;
    });
    await page.click('#clusters details summary');
    const visibleAfter = await page.evaluate(() => {
      const d = document.querySelector('#clusters details') as HTMLDetailsElement;
      const rows = d.querySelectorAll('.member-row').length;
      return { open: d.open, rows };
    });
    expect(visibleBefore).toBe(false);
    expect(visibleAfter.open).toBe(true);
    expect(visibleAfter.rows).toBe(2);
    expect(pageErrors).toEqual([]);
    await page.close();
  }, 120_000);

  it('stability filter narrows findings (v0.3.0)', async () => {
    const mixed = makeResult([
      makeFinding({ title: 'stable one', evidence: { message: 'a' }, stability: 'stable' }),
      makeFinding({ title: 'flaky two', evidence: { message: 'b' }, stability: 'unreproducible', status: 'suspected', repro: { attempts: 3, successes: 0, observedCount: 1 } })
    ]);
    const file = path.join(path.dirname(htmlFile), 'mixed.html');
    fs.writeFileSync(file, renderHtml(mixed), 'utf8');
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto('file:///' + file.replace(/\\/g, '/'));
    expect(await page.evaluate(() => document.querySelectorAll('.finding').length)).toBe(2);
    await page.selectOption('#stab', 'stable');
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => document.querySelectorAll('.finding').length)).toBe(1);
    await page.close();
  }, 120_000);

  it('embedded compare section shows new/resolved/persistent with coverage warning (v0.3.0)', async () => {
    const base = makeResult([
      makeFinding({ title: 'kept fault', evidence: { message: 'boom-kept' } }),
      makeFinding({ title: 'gone fault', evidence: { message: 'boom-gone' } })
    ]);
    const cur = makeResult([
      makeFinding({ title: 'kept fault', evidence: { message: 'boom-kept' } }),
      makeFinding({ title: 'fresh fault', evidence: { message: 'boom-new' } })
    ]);
    // Coverage shrank: drop one page from current.
    cur.pages = cur.pages.slice(0, 1);
    const diff = compareResults(base, cur);
    const file = path.join(path.dirname(htmlFile), 'with-compare.html');
    fs.writeFileSync(file, renderHtml(cur, diff), 'utf8');

    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.goto('file:///' + file.replace(/\\/g, '/'));
    await page.waitForTimeout(300);
    const state = await page.evaluate(() => ({
      section: (document.getElementById('compareSect') as HTMLElement).style.display,
      groups: [...document.querySelectorAll('#compareSect .compare-group')].map((h) => h.textContent),
      warn: document.querySelector('#compareSect .warnbox') ? 'shown' : 'missing'
    }));
    expect(state.section).not.toBe('none');
    expect(state.groups?.length).toBe(3);
    expect(state.warn).toBe('shown'); // coverage shrank -> unconfirmed warning, never "fixed"
    expect(pageErrors).toEqual([]);
    await page.close();
  }, 120_000);
});
