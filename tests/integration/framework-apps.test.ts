import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Scanner } from '../../src/scanner.js';
import { resolveConfig } from '../../src/config.js';
import { startStaticServer, type StaticServer } from '../../src/dev-server.js';
import { PROJECT_ROOT } from '../helpers/demo-server.js';

/**
 * Framework-application regressions (v0.2.2): React/Vue views swap content in
 * place without URL changes, so candidate re-collection must run after every
 * non-navigating click, and CSS fallback selectors must be document-unique.
 * These tests scan real vendored framework runtimes (audit/apps).
 */

const APPS = path.join(PROJECT_ROOT, 'audit', 'apps');

describe('framework applications (real React/Vue runtimes)', () => {
  let reactServer: StaticServer;
  let vueServer: StaticServer;

  beforeAll(async () => {
    reactServer = await startStaticServer(path.join(APPS, 'react-app'));
    vueServer = await startStaticServer(path.join(APPS, 'vue-app'));
  });

  afterAll(async () => {
    await reactServer.close();
    await vueServer.close();
  });

  function tmpOut(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'reprocase-fw-'));
  }

  it(
    'React: explores controls rendered after an in-place state switch (no URL change)',
    async () => {
      const out = tmpOut();
      const { config } = resolveConfig({
        entry: reactServer.url,
        maxPages: 3,
        runTimeoutMs: 120_000,
        verification: { attempts: 1 }
      });
      const { result } = await new Scanner(config, out).run();

      const boom = result.findings.find((f) => f.title.includes('ReactBoom'));
      expect(boom, 'fault behind a React state switch must be explored').toBeDefined();
      expect(boom!.status).toBe('verified');
      expect(boom!.steps.some((s) => s.selector === '#react-build-btn')).toBe(true);
      // The missing asset on the Deploy tab is found with its interaction path.
      const res = result.findings.find((f) => f.type === 'resource-load-failure');
      expect(res).toBeDefined();
      expect(res!.steps.length).toBeGreaterThan(0);
      // No false positives: the healthy Overview tab contributes nothing.
      expect(result.findings.length).toBe(2);
    },
    240_000
  );

  it(
    'Vue: reproduces a console-reported handler error 3/3 with a unique-locator path',
    async () => {
      const out = tmpOut();
      const { config } = resolveConfig({
        entry: vueServer.url,
        maxPages: 3,
        runTimeoutMs: 120_000,
        verification: { attempts: 3 }
      });
      const { result } = await new Scanner(config, out).run();

      const boom = result.findings.find((f) => (f.evidence.message || '').includes('VueBoom'));
      expect(boom, 'Vue handler error must be captured').toBeDefined();
      expect(boom!.type).toBe('console-error');
      expect(boom!.status).toBe('suspected'); // console errors stay informational
      expect(boom!.stability).toBe('stable');
      expect(boom!.repro.successes).toBe(boom!.repro.attempts);
      // The Recount button is located by its id — document-unique, replay-stable.
      expect(boom!.steps.some((s) => s.selector === '#vue-recount-btn')).toBe(true);
      const res = result.findings.find((f) => f.type === 'resource-load-failure');
      expect(res, 'missing asset inside the v-if view must be found').toBeDefined();
      expect(res!.status).toBe('verified');
    },
    240_000
  );
});
