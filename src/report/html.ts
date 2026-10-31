import type { FindingType, ScanResult } from '../types.js';
import { VERSION } from '../version.js';

/** Safe to embed inside a <script> block: escapes </, <!-- and line separators. */
export function jsonForScript(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}

const CSS = `
:root {
  --bg: #f5f6f8; --card: #ffffff; --ink: #111827; --muted: #6b7280; --line: #e5e7eb;
  --accent: #2563eb; --critical: #b91c1c; --high: #c2410c; --medium: #a16207; --low: #64748b;
  --ok: #047857; --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { background: var(--bg); color: var(--ink); font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
code { font-family: var(--mono); font-size: 12.5px; background: #eef1f5; border-radius: 4px; padding: 1px 5px; word-break: break-all; }
.topbar { background: #0f172a; color: #e2e8f0; padding: 18px 24px; }
.topbar .inner { max-width: 1080px; margin: 0 auto; display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.logo { width: 34px; height: 34px; flex: none; }
.brand { font-size: 20px; font-weight: 700; color: #fff; letter-spacing: .2px; }
.brand small { font-weight: 500; color: #94a3b8; margin-left: 6px; }
.topmeta { margin-left: auto; text-align: right; font-size: 12.5px; color: #94a3b8; line-height: 1.5; }
.topmeta a { color: #93c5fd; word-break: break-all; }
main { max-width: 1080px; margin: 0 auto; padding: 20px 24px 60px; }
.summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin: 4px 0 16px; }
.stat { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; }
.stat .num { font-size: 26px; font-weight: 700; line-height: 1.2; }
.stat .lbl { color: var(--muted); font-size: 12.5px; margin-top: 2px; }
.stat.red .num { color: var(--critical); }
.stat.amber .num { color: var(--medium); }
.stat.blue .num { color: var(--accent); }
.sevbar { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; margin-bottom: 20px; }
.sevbar h4 { margin: 0 0 10px; font-size: 13px; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: .4px; }
.sevrow { display: grid; grid-template-columns: 70px 1fr 28px; align-items: center; gap: 10px; margin: 6px 0; font-size: 12.5px; }
.sevrow .name { color: var(--muted); font-weight: 600; }
.sevrow .track { background: #eef1f5; border-radius: 99px; height: 8px; overflow: hidden; }
.sevrow .fill { height: 100%; border-radius: 99px; }
.sevrow .cnt { text-align: right; color: var(--muted); font-variant-numeric: tabular-nums; }
.toolbar { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-bottom: 14px; }
.toolbar input, .toolbar select { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; font: inherit; font-size: 13.5px; color: var(--ink); }
.toolbar input { flex: 1 1 220px; }
.count { color: var(--muted); font-size: 13px; margin-left: auto; white-space: nowrap; }
.copy-btn { font: inherit; font-size: 12px; border: 1px solid var(--line); background: #f8fafc; color: var(--accent); border-radius: 6px; padding: 3px 10px; cursor: pointer; }
.copy-btn:hover { border-color: var(--accent); }
.finding { background: var(--card); border: 1px solid var(--line); border-left: 4px solid var(--muted); border-radius: 10px; padding: 16px 18px; margin-bottom: 14px; }
.finding.critical { border-left-color: var(--critical); }
.finding.high { border-left-color: var(--high); }
.finding.medium { border-left-color: var(--medium); }
.finding.low { border-left-color: var(--low); }
.chips { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.chip { font-size: 11px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase; border-radius: 99px; padding: 3px 10px; }
.chip.critical { background: #fef2f2; color: var(--critical); }
.chip.high { background: #fff7ed; color: var(--high); }
.chip.medium { background: #fefce8; color: var(--medium); }
.chip.low { background: #f1f5f9; color: var(--low); }
.chip.verified { background: var(--critical); color: #fff; }
.chip.suspected { background: transparent; color: var(--muted); border: 1px dashed #cbd5e1; }
.chip.type { background: #eff6ff; color: var(--accent); text-transform: none; letter-spacing: 0; }
.finding h3 { margin: 10px 0 4px; font-size: 16.5px; line-height: 1.35; }
.meta { color: var(--muted); font-size: 12.5px; display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 10px; }
.meta b { color: var(--ink); font-weight: 600; }
.conf { display: inline-block; width: 70px; height: 6px; background: #eef1f5; border-radius: 99px; vertical-align: middle; margin: 0 6px 2px 2px; }
.conf i { display: block; height: 100%; border-radius: 99px; background: var(--accent); }
pre.evidence { background: #0f172a; color: #e2e8f0; border-radius: 8px; padding: 12px 14px; font-family: var(--mono); font-size: 12.5px; overflow: auto; max-height: 320px; white-space: pre-wrap; word-break: break-word; margin: 8px 0; }
.steps { margin: 8px 0; padding-left: 22px; }
.steps li { margin: 3px 0; font-size: 13.5px; }
.sect-label { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; color: var(--muted); margin: 14px 0 6px; }
.shots { display: flex; gap: 10px; flex-wrap: wrap; }
.shots img { max-width: 260px; max-height: 170px; border: 1px solid var(--line); border-radius: 8px; cursor: zoom-in; background: #fff; }
.artifacts { font-size: 13px; color: var(--muted); display: flex; flex-direction: column; gap: 3px; margin-top: 8px; }
.artifacts .privacy-note { color: #92400e; background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 4px 8px; }
table.pages { width: 100%; border-collapse: collapse; background: var(--card); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; font-size: 13px; }
table.pages th, table.pages td { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--line); }
table.pages th { background: #f8fafc; color: var(--muted); font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: .4px; }
table.pages tr:last-child td { border-bottom: none; }
td.url { max-width: 380px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bad { color: var(--critical); font-weight: 600; }
.warnbox { background: #fffbeb; border: 1px solid #fde68a; color: #92400e; border-radius: 10px; padding: 12px 16px; margin: 0 0 16px; font-size: 13.5px; }
h2.section { font-size: 17px; margin: 34px 0 12px; }
.notchecked { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 6px 18px; }
.notchecked .item { padding: 10px 0; border-bottom: 1px solid var(--line); }
.notchecked .item:last-child { border-bottom: none; }
.notchecked b { display: block; font-size: 13.5px; }
.notchecked span { color: var(--muted); font-size: 13px; }
footer { color: var(--muted); font-size: 12.5px; margin-top: 34px; border-top: 1px solid var(--line); padding-top: 14px; }
.empty { background: #ecfdf5; border: 1px solid #a7f3d0; color: #065f46; border-radius: 10px; padding: 22px; text-align: center; font-size: 15px; }
#lightbox { display: none; position: fixed; inset: 0; background: rgba(15,23,42,.85); z-index: 50; cursor: zoom-out; align-items: center; justify-content: center; }
#lightbox img { max-width: 94vw; max-height: 94vh; border-radius: 8px; }
@media (max-width: 640px) { .topmeta { text-align: left; margin-left: 0; } }
`;

const LOGO_SVG = `<svg class="logo" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect x="6" y="10" width="36" height="30" rx="6" stroke="#38bdf8" stroke-width="3"/><path d="M14 10V7M34 10V7" stroke="#38bdf8" stroke-width="3" stroke-linecap="round"/><circle cx="24" cy="26" r="7" stroke="#f87171" stroke-width="3"/><path d="M29 31l5 5" stroke="#f87171" stroke-width="3" stroke-linecap="round"/></svg>`;

const CLIENT_JS = `
(function () {
  var D = window.__REPROCASE_DATA__ || { findings: [], pages: [], summary: {}, stats: {}, notChecked: [] };
  var SEV_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
  var SEV_COLOR = { critical: '#b91c1c', high: '#c2410c', medium: '#a16207', low: '#64748b' };
  var state = { q: '', severity: 'all', status: 'all', type: 'all', sort: 'severity' };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = String(text);
    return e;
  }
  function chip(cls, text) { return el('span', 'chip ' + cls, text); }
  function fmtSec(ms) { return ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : ms + 'ms'; }

  var findings = (D.findings || []).slice().sort(function (a, b) {
    if (a.status !== b.status) return a.status === 'verified' ? -1 : 1;
    return (SEV_ORDER[a.severity] - SEV_ORDER[b.severity]) || a.title.localeCompare(b.title);
  });

  function sortFindings(list) {
    var sorted = list.slice();
    if (state.sort === 'type') {
      sorted.sort(function (a, b) { return a.type.localeCompare(b.type) || (SEV_ORDER[a.severity] - SEV_ORDER[b.severity]); });
    } else if (state.sort === 'status') {
      sorted.sort(function (a, b) {
        if (a.status !== b.status) return a.status === 'verified' ? -1 : 1;
        return (SEV_ORDER[a.severity] - SEV_ORDER[b.severity]) || a.title.localeCompare(b.title);
      });
    } else if (state.sort === 'repro') {
      sorted.sort(function (a, b) {
        var ra = a.repro.successes / Math.max(1, a.repro.attempts);
        var rb = b.repro.successes / Math.max(1, b.repro.attempts);
        return rb - ra || (SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
      });
    } else {
      sorted.sort(function (a, b) { return (SEV_ORDER[a.severity] - SEV_ORDER[b.severity]) || a.title.localeCompare(b.title); });
    }
    return sorted;
  }

  function issueText(f) {
    var lines = [];
    lines.push('## [' + f.severity.toUpperCase() + '] [' + f.status + '] ' + f.title);
    lines.push('');
    lines.push('- Type: ' + f.type);
    lines.push('- ID: ' + f.id);
    lines.push('- Reproduction: ' + f.repro.successes + '/' + f.repro.attempts + ' verification attempts');
    lines.push('- Page: ' + f.url);
    (f.steps || []).forEach(function (s, i) { lines.push((i + 1) + '. ' + s.description + (s.selector ? ' (' + s.selector + ')' : '')); });
    var ev = evidenceLines(f);
    if (ev) { lines.push(''); lines.push('~~~text'); lines.push(ev); lines.push('~~~'); }
    return lines.join('\\n');
  }

  function copyIssue(f, btn) {
    var text = issueText(f);
    function done() { btn.textContent = 'Copied!'; setTimeout(function () { btn.textContent = 'Copy issue text'; }, 1500); }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { btn.textContent = 'Copy failed'; }
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else {
      fallback();
    }
  }

  function matches(f) {
    if (state.severity !== 'all' && f.severity !== state.severity) return false;
    if (state.status !== 'all' && f.status !== state.status) return false;
    if (state.type !== 'all' && f.type !== state.type) return false;
    if (state.q) {
      var hay = (f.title + ' ' + f.url + ' ' + (f.evidence.message || '') + ' ' + (f.evidence.resourceUrl || '')).toLowerCase();
      if (hay.indexOf(state.q) === -1) return false;
    }
    return true;
  }

  function renderSummary() {
    var s = D.summary || {};
    var st = D.stats || {};
    var box = document.getElementById('summary');
    function stat(numId, num, lbl, cls) {
      var d = el('div', 'stat' + (cls ? ' ' + cls : ''));
      d.appendChild(el('div', 'num', num));
      d.appendChild(el('div', 'lbl', lbl));
      box.appendChild(d);
    }
    stat('verified', s.verified != null ? s.verified : 0, 'verified findings', 'red');
    stat('suspected', s.suspected != null ? s.suspected : 0, 'suspected (unproven)', 'amber');
    stat('pages', st.pagesVisited || 0, 'pages checked', 'blue');
    stat('actions', st.actionsPerformed || 0, 'interactions performed');
    stat('duration', fmtSec(st.durationMs || 0), 'total scan time');
    stat('dedupe', (st.findingsRaw || 0) + ' → ' + (st.findingsAfterDedupe || 0), 'observations after dedupe');
  }

  function renderSevBars() {
    var bySev = (D.summary && D.summary.bySeverity) || {};
    var box = document.getElementById('sevbars');
    box.appendChild(el('h4', null, 'Findings by severity'));
    ['critical', 'high', 'medium', 'low'].forEach(function (sev) {
      var n = bySev[sev] || 0;
      var row = el('div', 'sevrow');
      row.appendChild(el('span', 'name', sev));
      var track = el('div', 'track');
      var fill = el('div', 'fill');
      fill.style.width = (n > 0 ? Math.max(6, n * 12) : 0) + '%';
      fill.style.background = SEV_COLOR[sev];
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(el('span', 'cnt', String(n)));
      box.appendChild(row);
    });
  }

  function evidenceLines(f) {
    var e = f.evidence || {};
    var lines = [];
    if (e.message) lines.push('message: ' + e.message);
    if (e.statusCode !== undefined && e.statusCode !== null) lines.push('http status: ' + e.statusCode);
    if (e.resourceUrl) lines.push('resource: ' + e.resourceUrl);
    if (e.failureText) lines.push('failure: ' + e.failureText);
    if (e.selector) lines.push('selector: ' + e.selector);
    if (e.scrollWidth !== undefined) lines.push('overflow: scrollWidth=' + e.scrollWidth + 'px, clientWidth=' + e.clientWidth + 'px');
    (e.offenders || []).forEach(function (o) {
      lines.push('offender: <' + o.tag + '> right=' + o.right + 'px width=' + o.width + 'px ' + o.snippet);
    });
    if (e.stack) lines.push('stack:\\n' + e.stack);
    return lines.join('\\n');
  }

  function renderFindings() {
    var wrap = document.getElementById('findings');
    wrap.textContent = '';
    var visible = 0;
    if (findings.length === 0) {
      var ok = el('div', 'empty');
      ok.textContent = 'No issues found. The checked pages loaded, ran and laid out without detectable faults.';
      wrap.appendChild(ok);
      document.getElementById('toolbar').style.display = 'none';
      return;
    }
    sortFindings(findings).forEach(function (f) {
      if (!matches(f)) return;
      visible++;
      var card = el('article', 'finding ' + f.severity);
      card.dataset.findingId = f.id;
      var chips = el('div', 'chips');
      chips.appendChild(chip(f.severity, f.severity));
      chips.appendChild(chip(f.status, f.status));
      chips.appendChild(chip('type', f.type));
      if (f.stability) chips.appendChild(chip('type', 'stability: ' + f.stability));
      var copyBtn = el('button', 'copy-btn', 'Copy issue text');
      copyBtn.type = 'button';
      copyBtn.addEventListener('click', function () { copyIssue(f, copyBtn); });
      chips.appendChild(copyBtn);
      card.appendChild(chips);
      card.appendChild(el('h3', null, f.title));

      var meta = el('div', 'meta');
      meta.appendChild(el('span', null, '')).appendChild(el('code', null, f.id));
      var page = el('span');
      page.appendChild(el('span', null, 'page: '));
      var a = el('a', null, f.url);
      a.href = f.url; a.target = '_blank'; a.rel = 'noreferrer';
      page.appendChild(a);
      meta.appendChild(page);
      var rep = el('span');
      rep.appendChild(el('span', null, 'reproduced: '));
      rep.appendChild(el('b', null, f.repro.successes + '/' + f.repro.attempts + (f.repro.observedCount > 1 ? ' (seen ' + f.repro.observedCount + 'x)' : '')));
      meta.appendChild(rep);
      var conf = el('span');
      conf.appendChild(el('span', null, 'confidence:'));
      var bar = el('span', 'conf');
      var fill = el('i');
      fill.style.width = Math.round((f.confidence || 0) * 100) + '%';
      bar.appendChild(fill);
      conf.appendChild(bar);
      conf.appendChild(el('b', null, Math.round((f.confidence || 0) * 100) + '%'));
      meta.appendChild(conf);
      if (f.pages && f.pages.length > 1) meta.appendChild(el('span', null, 'on ' + f.pages.length + ' pages'));
      card.appendChild(meta);

      var ev = evidenceLines(f);
      if (ev) card.appendChild(el('pre', 'evidence', ev));

      if (f.steps && f.steps.length) {
        card.appendChild(el('div', 'sect-label', 'Reproduction steps (recorded during the scan)'));
        var ol = el('ol', 'steps');
        var li0 = el('li', null, '');
        var a0 = el('a', null, 'Open ' + (f.plan && f.plan.url ? f.plan.url : f.url));
        a0.href = (f.plan && f.plan.url) || f.url; a0.target = '_blank'; a0.rel = 'noreferrer';
        li0.appendChild(a0);
        ol.appendChild(li0);
        f.steps.forEach(function (s) { ol.appendChild(el('li', null, s.description + (s.selector ? ' — ' + s.selector : ''))); });
        ol.appendChild(el('li', null, 'Observe the fault described above.'));
        card.appendChild(ol);
      }

      if (f.screenshots && f.screenshots.length) {
        card.appendChild(el('div', 'sect-label', 'Screenshots'));
        var shots = el('div', 'shots');
        f.screenshots.forEach(function (p) {
          var img = el('img');
          img.src = encodeURI(p);
          img.alt = 'Screenshot for ' + f.id;
          img.loading = 'lazy';
          img.addEventListener('click', function () { openLightbox(img.src); });
          shots.appendChild(img);
        });
        card.appendChild(shots);
      }

      var arts = [];
      (f.traces || []).forEach(function (t) {
        var row = el('span');
        var link = el('a', null, 'browser trace (playwright show-trace)');
        link.href = encodeURI(t); link.download = t.split('/').pop();
        row.appendChild(link);
        row.appendChild(el('span', null, ' — ' + t));
        arts.push(row);
      });
      if (f.generatedTest) {
        var row = el('span');
        row.appendChild(el('span', null, 'generated reproduction test: '));
        row.appendChild(el('code', null, f.generatedTest));
        arts.push(row);
      }
      if ((f.traces || []).length || (f.screenshots || []).length) {
        // Traces record raw network traffic and screenshots capture raw page
        // content — neither can be reliably redacted automatically, so the
        // report itself must restrict public sharing (v0.1.1).
        arts.push(el('span', 'privacy-note',
          'Privacy: browser traces and screenshots may contain unredacted page content, URLs and query strings — review them before sharing this report publicly.'));
      }
      if (arts.length) {
        var box = el('div', 'artifacts');
        arts.forEach(function (r) { box.appendChild(r); });
        card.appendChild(box);
      }
      wrap.appendChild(card);
    });
    if (visible === 0) {
      var none = el('div', 'empty');
      none.textContent = 'No findings match the current filters.';
      wrap.appendChild(none);
    }
    document.getElementById('count').textContent = visible + ' of ' + findings.length + ' findings shown';
  }

  function renderPages() {
    var tbody = document.querySelector('#pagesTbl tbody');
    (D.pages || []).forEach(function (p) {
      var tr = el('tr');
      var urlTd = el('td', 'url');
      var a = el('a', null, p.url);
      a.href = p.url; a.target = '_blank'; a.rel = 'noreferrer';
      urlTd.appendChild(a);
      tr.appendChild(urlTd);
      var status = el('td');
      if (p.error) { status.appendChild(el('span', 'bad', 'network error')); status.title = p.error; }
      else status.appendChild(el('span', p.status >= 400 ? 'bad' : null, p.status || '—'));
      tr.appendChild(status);
      tr.appendChild(el('td', null, String(p.depth)));
      tr.appendChild(el('td', null, String(p.actions)));
      tr.appendChild(el('td', null, String(p.jsErrors)));
      tr.appendChild(el('td', null, String(p.resourceErrors)));
      tr.appendChild(el('td', null, p.overflow ? 'yes' : 'no'));
      tr.appendChild(el('td', null, fmtSec(p.durationMs || 0)));
      tbody.appendChild(tr);
    });
    if ((D.pages || []).length === 0) document.getElementById('pagesSect').style.display = 'none';
  }

  function renderNotChecked() {
    var box = document.getElementById('notchecked');
    (D.notChecked || []).forEach(function (item) {
      var d = el('div', 'item');
      d.appendChild(el('b', null, item.area));
      d.appendChild(el('span', null, item.reason));
      box.appendChild(d);
    });
  }

  function renderExploration() {
    var box = document.getElementById('exploration');
    var entries = D.exploration || [];
    if (!entries.length) {
      box.appendChild(el('div', 'item'));
      box.lastChild.appendChild(el('span', null, 'No interactive exploration was performed for this scan.'));
      return;
    }
    var colors = {
      explored: '#065f46', navigated: '#1e40af', forbidden: '#b91c1c', 'skipped-risky': '#92400e',
      'skipped-denied': '#92400e', 'skipped-off-scope': '#b91c1c', 'not-covered': '#92400e', 'click-failed': '#6b7280'
    };
    entries.forEach(function (entry) {
      var d = el('div', 'item');
      var head = el('b', null, '');
      var tag = el('span', null, '[' + entry.outcome + '] ');
      tag.style.color = colors[entry.outcome] || '#6b7280';
      head.appendChild(tag);
      head.appendChild(document.createTextNode(entry.description));
      d.appendChild(head);
      var detail = entry.page + (entry.note ? ' — ' + entry.note : '');
      d.appendChild(el('span', null, detail));
      box.appendChild(d);
    });
  }

  function renderFooter() {
    var st = D.stats || {};
    var f = document.getElementById('footer');
    f.appendChild(el('span', null,
      'ReproCase v' + (D.tool && D.tool.version ? D.tool.version : '?') +
      ' · scan of ' + (D.target && D.target.entry ? D.target.entry : '') +
      ' · ' + (st.pagesVisited || 0) + ' pages, ' + (st.actionsPerformed || 0) + ' interactions, ' +
      (st.requestsObserved || 0) + ' requests observed, ' + (st.linksChecked || 0) + ' links re-checked' +
      ' · ' + (D.finishedAt || '')));
    f.appendChild(el('div', null,
      'Evidence files (screenshots, browser traces) may contain unredacted page content, URLs and query parameters. Review them before sharing this report publicly.'));
  }

  function openLightbox(src) {
    var lb = document.getElementById('lightbox');
    var img = lb.querySelector('img');
    img.src = src;
    lb.style.display = 'flex';
  }

  function wireToolbar() {
    var q = document.getElementById('q');
    q.addEventListener('input', function () { state.q = q.value.trim().toLowerCase(); renderFindings(); });
    [['sev', 'severity'], ['status', 'status'], ['type', 'type'], ['sort', 'sort']].forEach(function (pair) {
      var sel = document.getElementById(pair[0]);
      sel.addEventListener('change', function () { state[pair[1]] = sel.value; renderFindings(); });
    });
  }

  var lb = document.getElementById('lightbox');
  lb.addEventListener('click', function () { lb.style.display = 'none'; });

  renderSummary();
  renderSevBars();
  wireToolbar();
  renderFindings();
  renderPages();
  renderExploration();
  renderNotChecked();
  renderFooter();
})();
`;

/** Renders the self-contained offline HTML report. No external resources. */
export function renderHtml(result: ScanResult): string {
  const target = result.target?.entry ?? '';
  const typeOptions = ([
    'page-load-failure',
    'js-exception',
    'console-error',
    'resource-load-failure',
    'broken-internal-link',
    'horizontal-overflow'
  ] as FindingType[])
    .filter((t) => (result.summary.byType[t] ?? 0) > 0)
    .map((t) => `<option value="${t}">${t}</option>`)
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="ReproCase v${VERSION}">
<title>ReproCase report — ${escapeHtml(target)}</title>
<style>${CSS}</style>
</head>
<body>
<header class="topbar">
  <div class="inner">
    ${LOGO_SVG}
    <div class="brand">ReproCase<small>v${VERSION}</small></div>
    <div class="topmeta">
      <div>target: <a href="${escapeAttr(target)}" rel="noreferrer">${escapeHtml(target)}</a></div>
      <div>finished: ${escapeHtml(result.finishedAt ?? '')} · allowed domains: ${escapeHtml((result.target?.allowedDomains ?? []).join(', ') || 'localhost')}</div>
    </div>
  </div>
</header>
<main>
  ${result.truncated ? `<div class="warnbox"><b>Partial scan:</b> ${escapeHtml(result.truncated)}. Results may be incomplete.</div>` : ''}
  <section id="summary" class="summary"></section>
  <section id="sevbars" class="sevbar"></section>
  <div id="toolbar" class="toolbar">
    <input id="q" type="search" placeholder="Search title, URL, message…" aria-label="Search findings">
    <select id="sev" aria-label="Filter by severity">
      <option value="all">all severities</option>
      <option value="critical">critical</option>
      <option value="high">high</option>
      <option value="medium">medium</option>
      <option value="low">low</option>
    </select>
    <select id="status" aria-label="Filter by status">
      <option value="all">all statuses</option>
      <option value="verified">verified</option>
      <option value="suspected">suspected</option>
    </select>
    <select id="type" aria-label="Filter by type">
      <option value="all">all types</option>
      ${typeOptions}
    </select>
    <select id="sort" aria-label="Sort findings">
      <option value="severity">sort: severity</option>
      <option value="status">sort: status</option>
      <option value="type">sort: type</option>
      <option value="repro">sort: reproducibility</option>
    </select>
    <span id="count" class="count"></span>
  </div>
  <section id="findings"></section>

  <h2 class="section">Pages checked</h2>
  <section id="pagesSect">
    <table class="pages" id="pagesTbl">
      <thead><tr><th>URL</th><th>HTTP</th><th>Depth</th><th>Actions</th><th>JS errors</th><th>Res. errors</th><th>Overflow</th><th>Time</th></tr></thead>
      <tbody></tbody>
    </table>
  </section>

  <h2 class="section">Exploration log</h2>
  <section id="exploration" class="notchecked"></section>

  <h2 class="section">Not checked (out of scope by design)</h2>
  <section id="notchecked" class="notchecked"></section>

  <footer id="footer"></footer>
</main>
<div id="lightbox" role="dialog" aria-label="Screenshot preview"><img alt="Screenshot preview"></div>
<script>window.__REPROCASE_DATA__ = ${jsonForScript(result)};</script>
<script>${CLIENT_JS}</script>
</body>
</html>
`;
}
