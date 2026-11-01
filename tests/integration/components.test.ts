import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Scanner } from '../../src/scanner.js';
import { resolveConfig } from '../../src/config.js';
import { startStaticServer, type StaticServer } from '../../src/dev-server.js';
import { PROJECT_ROOT } from '../helpers/demo-server.js';

/**
 * v0.3.0 component-detection regressions: open shadow DOM and same-origin
 * iframes are explored and verified; cross-origin iframe content is
 * suppressed and logged, never reported.
 */

let server: StaticServer;

beforeAll(async () => {
  server = await startStaticServer(path.join(PROJECT_ROOT, 'audit', 'apps', 'components'));
});

afterAll(async () => {
  await server.close();
});

function tmpOut(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'reprocase-comp-'));
}

describe('component detection (shadow DOM + iframes)', () => {
  it(
    'explores open shadow DOM with a working repro plan (verified 3/3)',
    async () => {
      const out = tmpOut();
      const { config } = resolveConfig({
        entry: server.url,
        maxPages: 2,
        runTimeoutMs: 150_000,
        verification: { attempts: 3 }
      });
      const { result } = await new Scanner(config, out).run();

      const boom = result.findings.find((f) => f.title.includes('ShadowBoom'));
      expect(boom, 'shadow-root fault must be detected').toBeDefined();
      expect(boom!.status).toBe('verified');
      expect(boom!.repro.successes).toBe(3);
      // The shadow button has an id — the fast path wins, and Playwright's
      // CSS engine pierces the open shadow root so the id resolves.
      expect(boom!.steps[0].selector).toBe('#shadow-crash-btn');
      expect(boom!.steps[0].locatorStrategy).toBe('id');
      const shadowAsset = result.findings.find(
        (f) => f.type === 'resource-load-failure' && (f.evidence.resourceUrl || '').includes('missing-shadow.png')
      );
      expect(shadowAsset, 'missing shadow asset must be reported').toBeDefined();
    },
    240_000
  );

  it(
    'same-origin iframe: fault attributed to the frame URL and verified by direct replay',
    async () => {
      const out = tmpOut();
      const { config } = resolveConfig({
        entry: server.url,
        maxPages: 2,
        runTimeoutMs: 150_000,
        verification: { attempts: 3 }
      });
      const { result } = await new Scanner(config, out).run();

      const boom = result.findings.find((f) => f.title.includes('FrameBoom'));
      expect(boom, 'iframe fault must be detected').toBeDefined();
      expect(boom!.status).toBe('verified');
      expect(boom!.repro.successes).toBe(3);
      // Attributed to the frame document, not the host page.
      expect(boom!.url).toContain('frame-child.html');
      // The repro plan targets the frame document directly with the recorded click.
      expect(boom!.plan.url).toContain('frame-child.html');
      expect(boom!.steps.some((s) => s.selector === '#frame-crash-btn')).toBe(true);
      const frameAsset = result.findings.find(
        (f) => f.type === 'resource-load-failure' && (f.evidence.resourceUrl || '').includes('missing-frame.png')
      );
      expect(frameAsset, 'missing frame asset must be reported').toBeDefined();
    },
    240_000
  );

  it(
    'cross-origin iframe: content suppressed, logged, never reported',
    async () => {
      // The sample embeds an iframe pointing at 127.0.0.1:4641 — serve it so
      // the scenario is deterministic. If the port is already in use (a
      // leftover server from a previous run), that server serves the same
      // fixture, so the scenario is equivalent.
      const { startStaticServer: start } = await import('../../src/dev-server.js');
      let outside: StaticServer | undefined;
      try {
        outside = await start(path.join(PROJECT_ROOT, 'audit', 'outside-site'), { port: 4641 });
      } catch {
        outside = undefined; // already served by another process
      }
      try {
        const out = tmpOut();
        const { config } = resolveConfig({
          entry: server.url,
          maxPages: 2,
          runTimeoutMs: 150_000,
          verification: { attempts: 1 }
        });
        const { result } = await new Scanner(config, out).run();
        // Findings stay clean: the tripwire text appears ONLY in the
        // exploration log (which honestly records what was suppressed).
        const findingsJson = JSON.stringify(result.findings);
        expect(findingsJson).not.toContain('OUTSIDE_SCOPE_VISITED');
        expect(result.findings.filter((f) => (f.url || '').includes(':4641'))).toEqual([]);
        const suppressed = result.exploration.filter((e) => e.outcome === 'skipped-off-scope');
        expect(
          suppressed.some((e) => e.description.includes('cross-origin iframe')),
          'cross-origin iframe must be logged'
        ).toBe(true);
        expect(
          suppressed.some((e) => e.description.includes('suppressed console error')),
          'out-of-scope console traffic must be logged'
        ).toBe(true);
      } finally {
        await outside?.close().catch(() => undefined);
      }
    },
    240_000
  );
});
