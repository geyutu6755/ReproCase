import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Finding, ScanResult } from './types.js';
import { jsonForScript, escapeHtml } from './report/html.js';
import { VERSION } from './version.js';

/**
 * Scan comparison based on STABLE fingerprints.
 *
 * Finding.id is a hash of the fingerprint and the fingerprint contains the
 * redacted page URL *including* query strings — volatile parameters (session
 * ids, pagination, cache busters) would split identical faults across runs.
 * Comparisons therefore use a stable key: type + URL path + error signature.
 * Timestamps and verification counters are never part of identity.
 */
export function stableKey(f: Finding): string {
  const pathname = pathnameOf(f.url);
  const e = f.evidence;
  const signature =
    e.message ??
    (e.resourceUrl ? pathnameOf(e.resourceUrl) : undefined) ??
    (f.plan.targetUrl ? pathnameOf(f.plan.targetUrl) : undefined) ??
    String(e.statusCode ?? e.failureText ?? '');
  return [f.type, pathname, String(signature).trim()].join('|');
}

function pathnameOf(u: string): string {
  try {
    return new URL(u).pathname;
  } catch {
    return u;
  }
}

export interface CompareEntryChange {
  field: string;
  from: string;
  to: string;
}

export interface CompareResult {
  tool: { name: 'ReproCase'; version: string };
  baseline: { file: string; startedAt: string; entry: string; pagesVisited: number };
  current: { file: string; startedAt: string; entry: string; pagesVisited: number };
  summary: {
    newCount: number;
    resolvedCount: number;
    resolvedUnconfirmedCount: number;
    persistentCount: number;
    statusChangedCount: number;
  };
  new: Array<{ finding: Finding; coveredInBaseline: boolean }>;
  resolved: Array<{ finding: Finding; confirmed: boolean; reason: string }>;
  persistent: Array<{ baseline: Finding; current: Finding; changes: CompareEntryChange[] }>;
  coverage: {
    baselinePages: string[];
    currentPages: string[];
    addedPages: string[];
    removedPages: string[];
    coverageShrunk: boolean;
  };
}

function stripVolatile(f: Finding): Finding {
  // Timestamps and dedupe counters never affect comparison output.
  const { firstSeenAt: _fs, lastSeenAt: _ls, ...rest } = f;
  void _fs;
  void _ls;
  return rest as Finding;
}

function covered(paths: Set<string>, finding: Finding): boolean {
  return paths.has(pathnameOf(finding.url));
}

export function compareResults(baseline: ScanResult, current: ScanResult, files?: { baseline: string; current: string }): CompareResult {
  const baselineByKey = new Map<string, Finding>();
  for (const f of baseline.findings) baselineByKey.set(stableKey(f), f);
  const currentByKey = new Map<string, Finding>();
  for (const f of current.findings) currentByKey.set(stableKey(f), f);

  const baselinePaths = new Set(baseline.pages.map((p) => pathnameOf(p.url)));
  const currentPaths = new Set(current.pages.map((p) => pathnameOf(p.url)));

  const newFindings: CompareResult['new'] = [];
  const resolved: CompareResult['resolved'] = [];
  const persistent: CompareResult['persistent'] = [];

  for (const [key, cur] of currentByKey) {
    const base = baselineByKey.get(key);
    if (!base) {
      newFindings.push({ finding: stripVolatile(cur), coveredInBaseline: covered(baselinePaths, cur) });
      continue;
    }
    const changes: CompareEntryChange[] = [];
    if (base.status !== cur.status) {
      changes.push({ field: 'status', from: base.status, to: cur.status });
    }
    if (base.severity !== cur.severity) {
      changes.push({ field: 'severity', from: base.severity, to: cur.severity });
    }
    if (
      base.repro.successes !== cur.repro.successes ||
      base.repro.attempts !== cur.repro.attempts
    ) {
      changes.push({
        field: 'reproduction',
        from: `${base.repro.successes}/${base.repro.attempts}`,
        to: `${cur.repro.successes}/${cur.repro.attempts}`
      });
    }
    if (base.pages.length !== cur.pages.length) {
      changes.push({ field: 'pages affected', from: String(base.pages.length), to: String(cur.pages.length) });
    }
    persistent.push({ baseline: stripVolatile(base), current: stripVolatile(cur), changes });
  }

  for (const [key, base] of baselineByKey) {
    if (currentByKey.has(key)) continue;
    // A fault may only be called "resolved" when the current scan actually
    // covered the page it lived on. Shrunk coverage = unconfirmed, never "fixed".
    const wasCoveredNow = covered(currentPaths, base);
    resolved.push({
      finding: stripVolatile(base),
      confirmed: wasCoveredNow,
      reason: wasCoveredNow
        ? 'page covered by the current scan and the fault signature is gone'
        : 'page was NOT visited by the current scan — cannot confirm the fix'
    });
  }

  const addedPages = [...currentPaths].filter((p) => !baselinePaths.has(p));
  const removedPages = [...baselinePaths].filter((p) => !currentPaths.has(p));
  const resolvedUnconfirmed = resolved.filter((r) => !r.confirmed).length;

  return {
    tool: { name: 'ReproCase', version: VERSION },
    baseline: {
      file: files?.baseline ?? '',
      startedAt: baseline.startedAt,
      entry: baseline.target.entry,
      pagesVisited: baseline.stats.pagesVisited
    },
    current: {
      file: files?.current ?? '',
      startedAt: current.startedAt,
      entry: current.target.entry,
      pagesVisited: current.stats.pagesVisited
    },
    summary: {
      newCount: newFindings.length,
      resolvedCount: resolved.length,
      resolvedUnconfirmedCount: resolvedUnconfirmed,
      persistentCount: persistent.length,
      statusChangedCount: persistent.filter((p) => p.changes.some((c) => c.field === 'status')).length
    },
    new: newFindings,
    resolved,
    persistent,
    coverage: {
      baselinePages: [...baselinePaths].sort(),
      currentPages: [...currentPaths].sort(),
      addedPages,
      removedPages,
      coverageShrunk: removedPages.length > 0
    }
  };
}

export function loadResultFile(file: string): ScanResult {
  if (!fs.existsSync(file)) {
    throw new Error(`File not found: "${file}". Run "reprocase scan" first — the result lives in <out>/result.json.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`"${file}" is not valid JSON: ${(e as Error).message}`);
  }
  const r = parsed as ScanResult;
  if (!r || !Array.isArray(r.findings) || !r.summary || !r.stats || !r.target) {
    throw new Error(
      `"${file}" is not a ReproCase scan result (missing findings/summary/stats). Point compare at <scan-out>/result.json files.`
    );
  }
  return r;
}

/** Reads both results, compares and writes compare.json + compare.html. */
export function runCompare(
  baselineFile: string,
  currentFile: string,
  outDir: string
): CompareResult {
  const baseline = loadResultFile(baselineFile);
  const current = loadResultFile(currentFile);
  const result = compareResults(baseline, current, {
    baseline: path.resolve(baselineFile),
    current: path.resolve(currentFile)
  });

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'compare.json'), JSON.stringify(result, null, 2), 'utf8');
  fs.writeFileSync(path.join(outDir, 'compare.html'), renderCompareHtml(result), 'utf8');
  return result;
}

const COMPARE_CSS = `
:root { --bg:#f5f6f8; --card:#fff; --ink:#111827; --muted:#6b7280; --line:#e5e7eb; --accent:#2563eb; --critical:#b91c1c; --high:#c2410c; --medium:#a16207; --low:#64748b; --ok:#047857; }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif; }
code { font-family: ui-monospace,Consolas,monospace; font-size:12.5px; background:#eef1f5; border-radius:4px; padding:1px 5px; word-break:break-all; }
.topbar { background:#0f172a; color:#e2e8f0; padding:16px 24px; }
.topbar .inner { max-width:1080px; margin:0 auto; display:flex; gap:12px; align-items:center; flex-wrap:wrap; }
.brand { font-weight:700; font-size:19px; color:#fff; } .brand small { color:#94a3b8; font-weight:500; margin-left:6px; }
.topmeta { margin-left:auto; font-size:12.5px; color:#94a3b8; text-align:right; }
main { max-width:1080px; margin:0 auto; padding:20px 24px 60px; }
.summary { display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:12px; margin-bottom:18px; }
.stat { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:14px 16px; }
.stat .num { font-size:26px; font-weight:700; } .stat .lbl { color:var(--muted); font-size:12.5px; margin-top:2px; }
.stat.red .num { color:var(--critical); } .stat.ok .num { color:var(--ok); } .stat.blue .num { color:var(--accent); } .stat.amber .num { color:var(--medium); }
.warnbox { background:#fffbeb; border:1px solid #fde68a; color:#92400e; border-radius:10px; padding:12px 16px; margin-bottom:16px; font-size:13.5px; }
h2 { font-size:17px; margin:28px 0 10px; }
.card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:12px 16px; margin-bottom:10px; border-left:4px solid var(--muted); }
.card.high { border-left-color:var(--high); } .card.medium { border-left-color:var(--medium); } .card.low { border-left-color:var(--low); }
.chip { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.4px; border-radius:99px; padding:2px 9px; margin-right:6px; }
.chip.critical { background:#fef2f2; color:var(--critical); } .chip.high { background:#fff7ed; color:var(--high); }
.chip.medium { background:#fefce8; color:var(--medium); } .chip.low { background:#f1f5f9; color:var(--low); }
.chip.status { background:#eff6ff; color:var(--accent); text-transform:none; }
.chip.new { background:#fee2e2; color:var(--critical); } .chip.resolved { background:#d1fae5; color:var(--ok); }
.chip.unconfirmed { background:#fef3c7; color:#92400e; }
.title { font-weight:600; margin:6px 0 2px; }
.meta { color:var(--muted); font-size:12.5px; }
.changes { margin-top:6px; font-size:13px; }
.changes span { display:inline-block; background:#f8fafc; border:1px solid var(--line); border-radius:6px; padding:2px 8px; margin:2px 6px 2px 0; }
.empty { background:#ecfdf5; border:1px solid #a7f3d0; color:#065f46; border-radius:10px; padding:18px; text-align:center; }
footer { color:var(--muted); font-size:12.5px; margin-top:30px; border-top:1px solid var(--line); padding-top:12px; }
`;

/**
 * Self-contained offline HTML diff report. All finding text is rendered via
 * textContent from embedded, escaped JSON — findings cannot inject markup.
 */
export function renderCompareHtml(result: CompareResult): string {
  const s = result.summary;
  const esc = escapeHtml;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="ReproCase v${VERSION} compare">
<title>ReproCase compare — ${esc(result.baseline.entry)} vs ${esc(result.current.entry)}</title>
<style>${COMPARE_CSS}</style>
</head>
<body>
<header class="topbar"><div class="inner">
  <div class="brand">ReproCase<small>compare v${VERSION}</small></div>
  <div class="topmeta">
    <div>baseline: ${esc(result.baseline.file || '(stdin)')} (${esc(result.baseline.startedAt)}, ${result.baseline.pagesVisited} pages)</div>
    <div>current:&nbsp; ${esc(result.current.file || '(stdin)')} (${esc(result.current.startedAt)}, ${result.current.pagesVisited} pages)</div>
  </div>
</div></header>
<main>
  <div id="warn"></div>
  <section id="summary" class="summary"></section>
  <h2>New findings</h2><section id="new"></section>
  <h2>Resolved</h2><section id="resolved"></section>
  <h2>Persistent</h2><section id="persistent"></section>
  <h2>Coverage</h2><section id="coverage" class="card"></section>
  <footer>Generated by ReproCase compare v${VERSION}. Matching is based on stable fingerprints (type + URL path + signature); timestamps and random ids are ignored.</footer>
</main>
<div id="lightbox" style="display:none"></div>
<script>window.__REPROCASE_COMPARE__ = ${jsonForScript(result)};</script>
<script>
(function () {
  var D = window.__REPROCASE_COMPARE__;
  var s = D.summary || { newCount: 0, resolvedCount: 0, resolvedUnconfirmedCount: 0, persistentCount: 0, statusChangedCount: 0 };
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined && text !== null) e.textContent = String(text); return e; }
  function chip(cls, text) { return el('span', 'chip ' + cls, text); }
  function findingCard(f, extraChips) {
    var c = el('div', 'card ' + f.severity);
    var chips = el('div', null, '');
    chips.appendChild(chip(f.severity, f.severity));
    chips.appendChild(chip('status', f.status));
    (extraChips || []).forEach(function (ch) { chips.appendChild(ch); });
    c.appendChild(chips);
    c.appendChild(el('div', 'title', f.title));
    c.appendChild(el('div', 'meta', f.url + '  ·  repro ' + f.repro.successes + '/' + f.repro.attempts));
    return c;
  }
  var sum = document.getElementById('summary');
  function stat(cls, num, lbl) { var d = el('div', 'stat ' + cls); d.appendChild(el('div', 'num', num)); d.appendChild(el('div', 'lbl', lbl)); sum.appendChild(d); }
  stat('red', s.newCount, 'new findings');
  stat('ok', s.resolvedCount, 'resolved' + (s.resolvedUnconfirmedCount ? ' (' + s.resolvedUnconfirmedCount + ' unconfirmed)' : ''));
  stat('blue', s.persistentCount, 'persistent');
  stat('amber', s.statusChangedCount, 'status changed');

  if (D.coverage.coverageShrunk) {
    var w = el('div', 'warnbox');
    w.textContent = 'Coverage shrank: ' + D.coverage.removedPages.length + ' page(s) visited by the baseline were not visited by the current scan. Resolved entries on those pages are marked unconfirmed — rerun with the same scope before claiming fixes.';
    document.getElementById('warn').appendChild(w);
  }

  var newBox = document.getElementById('new');
  if (!D.new.length) { newBox.appendChild(el('div', 'empty', 'No new findings.')); }
  D.new.forEach(function (entry) {
    var chips = [chip('new', 'new')];
    if (!entry.coveredInBaseline) chips.push(chip('unconfirmed', 'page not covered by baseline'));
    newBox.appendChild(findingCard(entry.finding, chips));
  });

  var resBox = document.getElementById('resolved');
  if (!D.resolved.length) { resBox.appendChild(el('div', 'empty', 'Nothing resolved.')); }
  D.resolved.forEach(function (entry) {
    var chips = [entry.confirmed ? chip('resolved', 'resolved') : chip('unconfirmed', 'unconfirmed')];
    var card = findingCard(entry.finding, chips);
    card.appendChild(el('div', 'meta', entry.reason));
    resBox.appendChild(card);
  });

  var perBox = document.getElementById('persistent');
  if (!D.persistent.length) { perBox.appendChild(el('div', 'empty', 'No persistent findings.')); }
  D.persistent.forEach(function (entry) {
    var chips = [];
    if (entry.changes.some(function (c) { return c.field === 'status'; })) chips.push(chip('unconfirmed', 'status changed'));
    perBox.appendChild(findingCard(entry.current, chips));
    if (entry.changes.length) {
      var box = el('div', 'changes');
      entry.changes.forEach(function (c) {
        box.appendChild(el('span', null, c.field + ': ' + c.from + ' → ' + c.to));
      });
      perBox.appendChild(box);
    }
  });

  var cov = document.getElementById('coverage');
  cov.appendChild(el('div', 'meta', 'baseline pages: ' + D.coverage.baselinePages.length + ' · current pages: ' + D.coverage.currentPages.length + ' · added: ' + D.coverage.addedPages.length + ' · removed: ' + D.coverage.removedPages.length));
  D.coverage.addedPages.forEach(function (p) { cov.appendChild(el('div', 'meta', '+ ' + p)); });
  D.coverage.removedPages.forEach(function (p) { cov.appendChild(el('div', 'meta', '− ' + p)); });
})();
</script>
</body>
</html>
`;
}
