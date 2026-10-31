import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Scanner } from '../../src/scanner.js';
import { resolveConfig } from '../../src/config.js';
import { startStaticServer, type StaticServer } from '../../src/dev-server.js';

/**
 * Regression tests for two defects found by the v0.1.0 independent audit:
 *  1. scan scope leaked across ports (same host, different app);
 *  2. the explorer spent its action budget on header nav links and left pages
 *     before ever exercising their buttons (systematic false negatives).
 */

let serverA: StaticServer;
let serverB: StaticServer;
let mainDir: string;
let otherDir: string;

beforeAll(async () => {
  mainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprocase-scope-main-'));
  otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprocase-scope-other-'));

  fs.writeFileSync(
    path.join(mainDir, 'index.html'),
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
     <title>scope main</title></head><body>
     <a href="PAGE_B_URL">other app</a>
     <a href="./internal.html">internal page</a>
     </body></html>`.replace('PAGE_B_URL', 'PLACEHOLDER-B'),
    'utf8'
  );
  // The link to the other app needs serverB's port, known only after listen();
  // written again in the test body below.
  fs.writeFileSync(
    path.join(mainDir, 'internal.html'),
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><p>internal</p></body></html>`,
    'utf8'
  );
  fs.writeFileSync(
    path.join(otherDir, 'outside.html'),
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>
     <script>console.error('OUTSIDE_SCOPE_VISITED');</script></body></html>`,
    'utf8'
  );

  serverA = await startStaticServer(mainDir);
  serverB = await startStaticServer(otherDir);
  fs.writeFileSync(
    path.join(mainDir, 'index.html'),
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
     <title>scope main</title></head><body>
     <a href="${serverB.url}outside.html">other app</a>
     <a href="./internal.html">internal page</a>
     </body></html>`,
    'utf8'
  );
});

afterAll(async () => {
  await serverA.close();
  await serverB.close();
  fs.rmSync(mainDir, { recursive: true, force: true });
  fs.rmSync(otherDir, { recursive: true, force: true });
});

function tmpOut(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'reprocase-scope-out-'));
}

describe('audit regression: scan scope', () => {
  it(
    'never visits a different app that shares only the loopback host (different port)',
    async () => {
      const out = tmpOut();
      const { config } = resolveConfig({
        entry: serverA.url,
        maxPages: 6,
        runTimeoutMs: 120_000,
        verification: { attempts: 1 }
      });
      const { result } = await new Scanner(config, out).run();

      const pageUrls = result.pages.map((p) => p.url);
      expect(pageUrls.some((u) => u.startsWith(serverB.url))).toBe(false);
      expect(JSON.stringify(result.findings)).not.toContain('OUTSIDE_SCOPE_VISITED');
      // The internal link is still followed.
      expect(pageUrls.some((u) => u.includes('internal.html'))).toBe(true);
      expect(result.findings).toEqual([]);
    },
    180_000
  );

  it(
    'exercises buttons before header navigation links (no more drive-by leave)',
    async () => {
      // Fixture: the nav link comes FIRST in the DOM, a faulting button after it.
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprocase-order-'));
      fs.writeFileSync(
        path.join(dir, 'index.html'),
        `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>
         <nav><a href="./other.html">Home</a></nav>
         <button id="boom" type="button">Trigger batch action</button>
         <script>document.getElementById('boom').addEventListener('click', function () {
           throw new Error('ExplorerOrderBoom: fault behind the nav (audit regression)');
         });</script></body></html>`,
        'utf8'
      );
      fs.writeFileSync(
        path.join(dir, 'other.html'),
        `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><p>other</p></body></html>`,
        'utf8'
      );
      const server = await startStaticServer(dir);
      try {
        const out = tmpOut();
        const { config } = resolveConfig({
          entry: server.url,
          maxPages: 4,
          runTimeoutMs: 120_000,
          verification: { attempts: 1 }
        });
        const { result } = await new Scanner(config, out).run();
        const boom = result.findings.find((f) => f.type === 'js-exception');
        expect(boom, 'fault behind a nav link must be found').toBeDefined();
        expect(boom!.status).toBe('verified');
        expect(boom!.steps.some((s) => s.selector === '#boom')).toBe(true);
      } finally {
        await server.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    180_000
  );

  it(
    'attributes faults to the destination page after a button navigation (D5)',
    async () => {
      // Fixture: button navigates to a page that throws on its own. The fault
      // must be verified against the DESTINATION page, with an empty click
      // path (the source click is not part of its reproduction) and a
      // redacted plan URL (D7).
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprocase-navdest-'));
      fs.writeFileSync(
        path.join(dir, 'index.html'),
        `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>
         <button id="go" type="button">Open detail</button>
         <script>document.getElementById('go').addEventListener('click', function () {
           window.location.href = './detail.html?token=sekrit42&fine=1';
         });</script></body></html>`,
        'utf8'
      );
      fs.writeFileSync(
        path.join(dir, 'detail.html'),
        `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><p>detail</p>
         <script>setTimeout(function () {
           throw new Error('NavDestBoom: fault on destination page (audit regression)');
         }, 150);</script></body></html>`,
        'utf8'
      );
      const server = await startStaticServer(dir);
      try {
        const out = tmpOut();
        const { config } = resolveConfig({
          entry: server.url,
          maxPages: 4,
          runTimeoutMs: 120_000,
          verification: { attempts: 2 }
        });
        const { result } = await new Scanner(config, out).run();
        const boom = result.findings.find((f) => f.title.includes('NavDestBoom'));
        expect(boom, 'destination-page fault must be found').toBeDefined();
        expect(boom!.status, 'must reproduce on the destination page itself').toBe('verified');
        expect(boom!.steps, 'source-page clicks must not leak into the plan').toEqual([]);
        const raw = JSON.stringify(result);
        expect(raw).not.toContain('sekrit42');
        expect(boom!.plan.url).toContain('token=***');
        expect(boom!.plan.url).toContain('fine=1');
        expect(result.pages.some((p) => p.url.includes('/detail.html'))).toBe(true);
      } finally {
        await server.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    180_000
  );

  it(
    'continues exploring after a same-document (SPA) transition and deep-links the final URL',
    async () => {
      // Fixture: button 1 performs history.pushState (no document load); the
      // server hosts the SPA with an index fallback so /app/view1 is openable.
      // Button 2 throws — it must still be explored AFTER the SPA transition.
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reprocase-spa-'));
      fs.writeFileSync(
        path.join(dir, 'index.html'),
        `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>
         <button id="spa-nav" type="button">Open view</button>
         <button id="boom" type="button">Trigger load</button>
         <script>
         document.getElementById('spa-nav').addEventListener('click', function () {
           history.pushState({}, '', '/app/view1');
         });
         document.getElementById('boom').addEventListener('click', function () {
           throw new Error('SpaSecondBoom: fault after SPA transition (v0.2.0 regression)');
         });
         </script></body></html>`,
        'utf8'
      );
      const server = await startStaticServer(dir, { spaFallback: true });
      try {
        const out = tmpOut();
        const { config } = resolveConfig({
          entry: server.url,
          maxPages: 5,
          runTimeoutMs: 120_000,
          verification: { attempts: 1 }
        });
        const { result } = await new Scanner(config, out).run();

        const boom = result.findings.find((f) => f.title.includes('SpaSecondBoom'));
        expect(boom, 'fault behind the SPA transition must still be explored').toBeDefined();
        expect(boom!.status).toBe('verified');

        // The deep-link check queued and opened /app/view1 (server fallback 200).
        expect(result.pages.some((p) => p.url.includes('/app/view1'))).toBe(true);
        // The deep link re-renders the app, so the same JS fault may be
        // observed again under its own URL fingerprint — expected. What must
        // NOT happen is a load/resource false positive on a healthy fallback.
        expect(
          result.findings.filter(
            (f) =>
              ['page-load-failure', 'resource-load-failure', 'broken-internal-link'].includes(f.type) &&
              JSON.stringify(f).includes('/app/')
          ),
          'SPA deep link must not produce load/resource false positives on a healthy fallback'
        ).toEqual([]);

        // The exploration log records the same-document transition explicitly.
        const spaEntry = result.exploration.find((e) => (e.note || '').includes('same-document navigation'));
        expect(spaEntry, 'same-document navigation must be logged').toBeDefined();
        expect(spaEntry!.outcome).toBe('explored');
      } finally {
        await server.close();
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
    180_000
  );
});
