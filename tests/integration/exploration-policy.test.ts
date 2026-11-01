import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium } from 'playwright';
import { collectCandidatesInPage } from '../../src/util/selectors.js';

/**
 * v0.3.1 security regression for the exploration policy (Phase 4: "危险交互
 * 默认禁止，精确授权规则不被绕过"). Runs the real in-page collector under
 * Chromium and asserts the authorization precedence:
 *   deny > HARD-dangerous (never clickable) > SOFT (only when allowed) > click.
 */
const PAGE = `<!doctype html><html><body>
  <button id="run-btn" type="button">Run report</button>
  <button id="del-btn" type="button">Delete account</button>
  <button id="pay-btn" type="button">Pay now</button>
  <button id="save-btn" type="button">Save draft</button>
  <button id="deny-me" type="button">Toggle theme</button>
</body></html>`;

let browser: import('playwright').Browser;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser.close().catch(() => undefined);
});

async function collect(allow: string[], deny: string[]) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  await page.setContent(PAGE);
  const out = await page.evaluate(collectCandidatesInPage, { max: 20, allowSelectors: allow, denySelectors: deny });
  await page.close();
  return out;
}

describe('exploration authorization policy (real browser)', () => {
  it('never lets allowSelectors revive a HARD-dangerous control', async () => {
    const out = await collect(['#run-btn', '#del-btn', '#pay-btn'], ['#deny-me']);
    const chosen = out.candidates.map((c) => c.selector);
    const reasonOf = (sel: string) => out.skipped.find((s) => s.selector === sel)?.reason;

    // Soft keyword, explicitly authorized -> clickable.
    expect(chosen).toContain('#run-btn');
    // Neutral control -> clickable.
    expect(chosen).toContain('#save-btn');
    // HARD keywords stay forbidden even though they are in allowSelectors.
    expect(chosen).not.toContain('#del-btn');
    expect(chosen).not.toContain('#pay-btn');
    expect(reasonOf('#del-btn')).toBe('forbidden');
    expect(reasonOf('#pay-btn')).toBe('forbidden');
    // denySelectors excludes an otherwise-benign control, ahead of everything else.
    expect(chosen).not.toContain('#deny-me');
    expect(reasonOf('#deny-me')).toBe('denied');
  }, 60_000);

  it('skips a soft keyword by default and offers no candidate bypass', async () => {
    const out = await collect([], []);
    const chosen = out.candidates.map((c) => c.selector);
    const reasonOf = (sel: string) => out.skipped.find((s) => s.selector === sel)?.reason;
    // No authorization: soft "run" is skipped as risky, not clicked.
    expect(reasonOf('#run-btn')).toBe('risky');
    expect(chosen).not.toContain('#run-btn');
    // Neutral control is still explored.
    expect(chosen).toContain('#save-btn');
  }, 60_000);
});
