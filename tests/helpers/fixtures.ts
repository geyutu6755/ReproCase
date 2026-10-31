import type { Finding, FindingType, ReproCaseConfig } from '../../src/types.js';
import { resolveConfig } from '../../src/config.js';

let idCounter = 0;

/** Minimal valid Finding for reporter/generator unit tests. */
export function makeFinding(overrides: Partial<Finding> = {}): Finding {
  idCounter++;
  const type: FindingType = overrides.type ?? 'js-exception';
  const base: Finding = {
    id: `fp-test${String(idCounter).padStart(4, '0')}`,
    fingerprint: `test|fingerprint|${idCounter}`,
    type,
    severity: 'high',
    status: 'verified',
    confidence: 1,
    title: `Test finding ${idCounter}`,
    url: 'http://127.0.0.1:4610/demo.html',
    pages: ['http://127.0.0.1:4610/demo.html'],
    evidence: { message: 'Boom: test error' },
    steps: [{ action: 'click', description: 'click button "Break it"', selector: '#break-btn' }],
    repro: { attempts: 3, successes: 3, observedCount: 1 },
    screenshots: ['artifacts/screenshots/demo.png'],
    traces: ['artifacts/traces/trace-demo.zip'],
    plan: {
      kind: 'js-error',
      url: 'http://127.0.0.1:4610/demo.html',
      message: 'Boom: test error',
      steps: [{ action: 'click', description: 'click button "Break it"', selector: '#break-btn' }]
    },
    firstSeenAt: '2026-10-31T10:00:00.000Z',
    lastSeenAt: '2026-10-31T10:00:05.000Z'
  };
  return { ...base, ...overrides };
}

export function demoConfig(overrides: Record<string, unknown> = {}): ReproCaseConfig {
  return resolveConfig({ entry: 'http://127.0.0.1:4610/', ...overrides }).config;
}
