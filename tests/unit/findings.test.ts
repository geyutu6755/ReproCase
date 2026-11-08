import { describe, expect, it } from 'vitest';
import { FindingCollector } from '../../src/findings.js';
import type { ObservationInput } from '../../src/findings.js';

function obs(overrides: Partial<ObservationInput> = {}): ObservationInput {
  return {
    type: 'js-exception',
    url: 'http://127.0.0.1:4610/page.html',
    evidence: { message: 'Boom: crash' },
    steps: [],
    ...overrides
  };
}

describe('FindingCollector dedupe', () => {
  it('merges identical js-exception observations into one finding', () => {
    const c = new FindingCollector(true);
    const a = c.observe(obs());
    const b = c.observe(obs());
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.finding).toBe(a.finding);
    expect(a.finding.repro.observedCount).toBe(2);
    expect(c.list()).toHaveLength(1);
    expect(c.rawCount).toBe(2);
  });

  it('keeps distinct messages as separate findings', () => {
    const c = new FindingCollector(true);
    c.observe(obs({ evidence: { message: 'Boom: crash' } }));
    c.observe(obs({ evidence: { message: 'Boom: different crash' } }));
    expect(c.list()).toHaveLength(2);
  });

  it('normalizes whitespace in messages before fingerprinting', () => {
    const c = new FindingCollector(true);
    c.observe(obs({ evidence: { message: 'Boom:   crash\nwith  spaces' } }));
    const r = c.observe(obs({ evidence: { message: 'Boom: crash with spaces' } }));
    expect(r.created).toBe(false);
  });

  it('merges horizontal overflow per viewport', () => {
    const c = new FindingCollector(true);
    c.observe(obs({ type: 'horizontal-overflow', evidence: { viewport: 'mobile', scrollWidth: 736, clientWidth: 390 } }));
    const r = c.observe(obs({ type: 'horizontal-overflow', evidence: { viewport: 'desktop', scrollWidth: 1400, clientWidth: 1280 } }));
    expect(r.created).toBe(true);
    expect(c.list()).toHaveLength(2);
  });

  it('merges broken links by target across source pages', () => {
    const c = new FindingCollector(true);
    const a = c.observe(obs({ type: 'broken-internal-link', url: 'http://127.0.0.1:4610/a.html', targetUrl: 'http://127.0.0.1:4610/gone.html', evidence: { statusCode: 404 } }));
    const b = c.observe(obs({ type: 'broken-internal-link', url: 'http://127.0.0.1:4610/b.html', targetUrl: 'http://127.0.0.1:4610/gone.html', evidence: { statusCode: 404 } }));
    expect(b.created).toBe(false);
    expect(a.finding.pages).toHaveLength(2);
    expect(a.finding.pages).toContain('http://127.0.0.1:4610/b.html');
  });

  it('deduplicates resource failures by resource URL regardless of page', () => {
    const c = new FindingCollector(true);
    const a = c.observe(obs({ type: 'resource-load-failure', url: 'http://127.0.0.1:4610/p1.html', evidence: { resourceUrl: 'http://127.0.0.1:4610/logo.png', statusCode: 404 } }));
    const b = c.observe(obs({ type: 'resource-load-failure', url: 'http://127.0.0.1:4610/p2.html', evidence: { resourceUrl: 'http://127.0.0.1:4610/logo.png', statusCode: 404 } }));
    expect(b.created).toBe(false);
    expect(a.finding.repro.observedCount).toBe(2);
  });

  it('merges resource failures with the same URL but different failure modes (404 vs abort)', () => {
    // A real browser can observe the same missing resource twice with different
    // failure shapes (HTTP 404 on one request, net::ERR_ABORTED on a duplicate
    // request). Same root cause -> one finding, not two.
    const c = new FindingCollector(true);
    const a = c.observe(obs({ type: 'resource-load-failure', url: 'http://127.0.0.1:4610/p1.html', evidence: { resourceUrl: 'http://127.0.0.1:4610/app.js', statusCode: 404 } }));
    const b = c.observe(obs({ type: 'resource-load-failure', url: 'http://127.0.0.1:4610/p2.html', evidence: { resourceUrl: 'http://127.0.0.1:4610/app.js', failureText: 'net::ERR_ABORTED' } }));
    expect(b.created, 'same resource URL must dedupe regardless of failure mode').toBe(false);
    expect(a.finding.repro.observedCount).toBe(2);
    expect(c.list()).toHaveLength(1);
  });

  it('assigns stable ids derived from the fingerprint', () => {
    const c1 = new FindingCollector(true);
    const c2 = new FindingCollector(true);
    const a = c1.observe(obs());
    const b = c2.observe(obs());
    expect(a.finding.id).toBe(b.finding.id);
    expect(a.finding.id).toMatch(/^fp-[0-9a-f]{8}$/);
  });

  it('sorts verified before suspected and by severity rank', () => {
    const c = new FindingCollector(true);
    const low = c.observe(obs({ type: 'horizontal-overflow', evidence: { viewport: 'mobile' } })).finding;
    const js = c.observe(obs()).finding;
    low.status = 'suspected';
    js.status = 'verified';
    const list = c.list();
    expect(list[0].type).toBe('js-exception');
    expect(list[list.length - 1].type).toBe('horizontal-overflow');
  });

  it('builds repro plans for verification and test generation', () => {
    const c = new FindingCollector(true);
    const f = c.observe(
      obs({
        steps: [{ action: 'click', description: 'click button "Crash"', selector: '#crash-btn' }]
      })
    ).finding;
    expect(f.plan.kind).toBe('js-error');
    expect(f.plan.url).toBe('http://127.0.0.1:4610/page.html');
    expect(f.plan.steps).toHaveLength(1);
    expect(f.plan.steps![0].selector).toBe('#crash-btn');
  });

  it('redacts sensitive query parameters in stored URLs', () => {
    const c = new FindingCollector(true);
    const f = c.observe(obs({ url: 'http://127.0.0.1:4610/page?token=secret123&id=7' })).finding;
    expect(f.url).not.toContain('secret123');
    expect(f.url).toContain('id=7');
  });

  it('keeps query strings when redaction is disabled', () => {
    const c = new FindingCollector(false);
    const f = c.observe(obs({ url: 'http://127.0.0.1:4610/page?token=secret123' })).finding;
    expect(f.url).toContain('secret123');
  });
});
