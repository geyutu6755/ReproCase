import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Browser, Page } from 'playwright';
import type { Finding, ReproCaseConfig } from './types.js';
import { measureOverflowInPage, OVERFLOW_TOLERANCE_PX, UNHANDLED_REJECTION_SCRIPT } from './util/selectors.js';
import { normalizeUrl } from './util/net.js';
import { log } from './util/log.js';

async function screenshot(page: Page, outDir: string, findingId: string): Promise<void> {
  try {
    const dir = path.join(outDir, 'artifacts', 'screenshots');
    fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, `${findingId}.png`), fullPage: false });
  } catch {
    // Page may be mid-navigation or already closed; verification evidence is optional.
  }
}

async function replaySteps(page: Page, steps: { action: string; selector?: string; url?: string }[]): Promise<boolean> {
  for (const step of steps) {
    try {
      if (step.action === 'goto' && step.url) {
        await page.goto(step.url, { waitUntil: 'load', timeout: 15000 });
      } else if (step.action === 'click' && step.selector) {
        await page.click(step.selector, { timeout: 3000 });
      }
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Attempts to reproduce one finding in a fresh browser context.
 * Returns true when the original fault signature was observed again.
 */
async function attemptRepro(
  browser: Browser,
  finding: Finding,
  cfg: ReproCaseConfig,
  outDir: string
): Promise<boolean> {
  const plan = finding.plan;
  const viewport =
    plan.viewport === 'mobile'
      ? { ...cfg.viewports.mobile }
      : { ...cfg.viewports.desktop };
  const context = await browser.newContext({ viewport });
  try {
    const page = await context.newPage();

    if (plan.kind === 'goto-status' || plan.kind === 'link-status' || plan.kind === 'resource-status') {
      const target = plan.targetUrl ?? plan.url;
      let ok = false;
      try {
        const resp = await page.goto(target, { waitUntil: 'load', timeout: cfg.navigationTimeoutMs });
        ok = resp ? resp.status() >= 400 : false;
      } catch {
        // For page-level load failures a thrown navigation error IS the fault.
        ok = plan.kind === 'goto-status';
        if (!ok) {
          // Some targets (e.g. binary downloads) abort navigation; fall back to a plain request.
          const res = await context.request.get(target).catch(() => undefined);
          ok = res ? res.status() >= 400 : false;
        }
      }
      if (ok) await screenshot(page, outDir, finding.id);
      return ok;
    }

    if (plan.kind === 'resource-request-error') {
      const failedUrls: string[] = [];
      page.on('requestfailed', (req) => failedUrls.push(normalizeUrl(req.url())));
      await page.goto(plan.url, { waitUntil: 'load', timeout: cfg.navigationTimeoutMs }).catch(() => undefined);
      await page.waitForTimeout(500);
      const ok = failedUrls.includes(normalizeUrl(plan.targetUrl ?? ''));
      if (ok) await screenshot(page, outDir, finding.id);
      return ok;
    }

    if (plan.kind === 'js-error' || plan.kind === 'console-error') {
      const messages: string[] = [];
      page.on('pageerror', (err) => messages.push('pageerror:' + String(err?.message ?? err)));
      page.on('console', (msg) => {
        if (msg.type() === 'error') messages.push('console:' + msg.text());
      });
      await page.addInitScript(UNHANDLED_REJECTION_SCRIPT);
      await page.goto(plan.url, { waitUntil: 'load', timeout: cfg.navigationTimeoutMs }).catch(() => undefined);
      const stepsOk = await replaySteps(page, plan.steps ?? []);
      await page.waitForTimeout(800);
      const rejections = await page
        .evaluate(() => (window as unknown as { __reprocaseRejections?: { reason: string }[] }).__reprocaseRejections?.splice(0) ?? [])
        .catch(() => [] as { reason: string }[]);
      for (const rej of rejections) messages.push('pageerror:' + rej.reason);
      const needle = (plan.message ?? '').trim().slice(0, 120);
      const ok = stepsOk && (needle ? messages.some((m) => m.includes(needle)) : messages.length > 0);
      if (ok) await screenshot(page, outDir, finding.id);
      return ok;
    }

    // plan.kind === 'overflow'
    await page.goto(plan.url, { waitUntil: 'load', timeout: cfg.navigationTimeoutMs }).catch(() => undefined);
    // Interaction-injected overflow needs the recorded clicks replayed first.
    const stepsOk = await replaySteps(page, plan.steps ?? []);
    await page.waitForTimeout(400);
    const m = await page.evaluate(measureOverflowInPage, OVERFLOW_TOLERANCE_PX).catch(() => undefined);
    const ok = stepsOk && m?.overflow === true;
    if (ok) await screenshot(page, outDir, finding.id);
    return ok;
  } finally {
    await context.close().catch(() => undefined);
  }
}

/**
 * Re-tests every finding independently, `verification.attempts` times, each in
 * a fresh browser context. Only findings that reproduce at least once may
 * become 'verified'; console errors stay 'suspected' (informational) by design.
 */
export async function verifyFindings(
  browser: Browser,
  findings: Finding[],
  cfg: ReproCaseConfig,
  outDir: string
): Promise<void> {
  for (const finding of findings) {
    const attempts = Math.max(1, cfg.verification.attempts);
    let successes = 0;
    for (let i = 0; i < attempts; i++) {
      try {
        if (await attemptRepro(browser, finding, cfg, outDir)) successes++;
      } catch (e) {
        log.verbose(`verification of ${finding.id} threw: ${(e as Error).message}`);
      }
    }
    finding.repro.attempts = attempts;
    finding.repro.successes = successes;
    if (successes > 0) {
      // Console errors stay 'suspected' by design: a reproduced console.error
      // is still only informational, not proof of a fault.
      finding.status = finding.type === 'console-error' ? 'suspected' : 'verified';
      finding.confidence = Math.round((successes / attempts) * 100) / 100;
    } else {
      finding.status = 'suspected';
      finding.confidence = finding.type === 'console-error' ? 0.3 : 0.25;
    }
    log.verbose(
      `verify ${finding.id} [${finding.type}] ${successes}/${attempts} -> ${finding.status}`
    );
  }
}
