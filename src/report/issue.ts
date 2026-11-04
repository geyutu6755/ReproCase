import type { Finding, ScanResult } from '../types.js';
import type { FaultCluster } from '../aggregate.js';
import { VERSION } from '../version.js';

function confidencePct(f: Finding): string {
  return Math.round(f.confidence * 100) + '%';
}

function reproLine(f: Finding): string {
  if (f.repro.attempts > 0) {
    return (
      `${f.repro.successes}/${f.repro.attempts} independent verification attempts reproduced it ` +
      `(observed ${f.repro.observedCount}x during the crawl)`
    );
  }
  return `observed ${f.repro.observedCount}x during the crawl; not re-verified`;
}

export function renderFindingBody(f: Finding): string {
  const lines: string[] = [];
  lines.push(`- **Type:** \`${f.type}\``);
  lines.push(`- **ID:** \`${f.id}\``);
  lines.push(`- **Status:** ${f.status} (confidence ${confidencePct(f)})`);
  lines.push(`- **Reproduction:** ${reproLine(f)}`);
  lines.push(`- **Page(s):** ${f.pages.map((p) => '<' + p + '>').join(', ')}`);
  if (f.evidence.viewport) lines.push(`- **Viewport:** ${f.evidence.viewport}`);
  lines.push('');
  lines.push('**Evidence**');
  lines.push('');
  lines.push('```text');
  if (f.evidence.message) lines.push('message: ' + f.evidence.message);
  if (f.evidence.statusCode !== undefined) lines.push('http status: ' + f.evidence.statusCode);
  if (f.evidence.resourceUrl) lines.push('resource: ' + f.evidence.resourceUrl);
  if (f.evidence.failureText) lines.push('failure: ' + f.evidence.failureText);
  if (f.evidence.selector) lines.push('selector: ' + f.evidence.selector);
  if (f.evidence.scrollWidth !== undefined) {
    lines.push(`overflow: scrollWidth=${f.evidence.scrollWidth}px clientWidth=${f.evidence.clientWidth}px`);
  }
  for (const o of f.evidence.offenders ?? []) {
    lines.push(`offender: <${o.tag}> right=${o.right}px width=${o.width}px ${o.snippet}`);
  }
  if (f.evidence.stack) {
    lines.push('stack:');
    lines.push(f.evidence.stack);
  }
  lines.push('```');
  lines.push('');
  lines.push('**Reproduction steps**');
  lines.push('');
  lines.push(`1. Open <${f.plan.url}> in a browser.`);
  f.steps.forEach((s, i) => {
    lines.push(`${i + 2}. ${s.description}${s.selector ? ` (selector: \`${s.selector}\`)` : ''}`);
  });
  lines.push(`${f.steps.length + 2}. Observe the fault described above.`);
  lines.push('');
  const artifacts: string[] = [];
  for (const s of f.screenshots) artifacts.push(`- Screenshot: \`${s}\``);
  for (const t of f.traces) {
    artifacts.push(`- Browser trace (open with \`npx playwright show-trace ${t}\`): \`${t}\``);
  }
  if (f.generatedTest) artifacts.push(`- Generated reproduction test: \`${f.generatedTest}\``);
  if (artifacts.length > 0) {
    lines.push('**Artifacts**');
    lines.push('');
    lines.push(...artifacts);
    lines.push('');
  }
  return lines.join('\n');
}

/** Full standalone rendering (heading + body) for one finding. */
export function renderFindingMarkdown(f: Finding): string {
  return [`## [${f.severity.toUpperCase()}] [${f.status}] ${f.title}`, '', renderFindingBody(f)].join('\n');
}

/**
 * Cluster rendering for the combined issue document: one section per
 * root-cause cluster with the aggregated status and a collapsed per-page
 * member detail block (GitHub `<details>`), keeping every member finding
 * complete and machine-traceable by id.
 */
export function renderClusterMarkdown(cluster: FaultCluster): string {
  const lines: string[] = [];
  lines.push(
    `## [${cluster.severity.toUpperCase()}] [${cluster.status}] ${cluster.title} — fault cluster, ${cluster.pages.length} page(s)`
  );
  lines.push('');
  lines.push(`- **Type:** \`${cluster.type}\``);
  lines.push(`- **Cluster ID:** \`${cluster.id}\` (signature: ${cluster.signatureQuality})`);
  lines.push(`- **Aggregated status:** ${cluster.status} — ${cluster.repro.successes}/${cluster.repro.attempts} member-verification attempts reproduced it`);
  if (cluster.stability) lines.push(`- **Stability (worst member):** ${cluster.stability}`);
  lines.push(`- **Affected pages:** ${cluster.pages.map((p) => '<' + p + '>').join(', ')}`);
  lines.push('');
  lines.push('**Per-page detail** (each member keeps its own evidence and click path)');
  lines.push('');
  for (const member of cluster.members) {
    lines.push(`<details>`);
    lines.push(
      `<summary><code>${member.id}</code> — ${member.url} — ${member.status}${member.stability ? '/' + member.stability : ''}, repro ${member.repro.successes}/${member.repro.attempts}</summary>`
    );
    lines.push('');
    lines.push(renderFindingBody(member));
    lines.push('');
    lines.push('</details>');
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Combined issue document: exception/console findings are grouped by
 * root-cause cluster (when the scan produced clusters); all other finding
 * types render individually, exactly as before.
 */
export function renderIssuesMarkdown(result: ScanResult): string {
  const s = result.summary;
  const lines: string[] = [];
  lines.push(`# ReproCase report — ${result.target.entry}`);
  lines.push('');
  lines.push(
    `**${s.verified} verified** / **${s.suspected} suspected** finding(s) across ` +
      `${result.stats.pagesVisited} page(s) in ${Math.round(result.stats.durationMs / 1000)}s.`
  );
  lines.push('');
  lines.push(
    `Generated by [ReproCase](https://github.com/geyutu6755/ReproCase) v${result.tool.version} on ${result.finishedAt}. ` +
      `Verified = reproduced in independent browser runs; suspected = observed but not proven reproducible. ` +
      `Each finding below lists its own reproduction ratio.`
  );
  if (result.truncated) {
    lines.push('');
    lines.push(`> **Note:** the scan stopped early — ${result.truncated}. Results may be incomplete.`);
  }
  lines.push('');

  const clusters = result.clusters ?? [];
  const clusteredMemberIds = new Set(clusters.flatMap((c) => c.members.map((m) => m.id)));
  const standalone = result.findings.filter((f) => !clusteredMemberIds.has(f.id));

  if (result.findings.length === 0) {
    lines.push('No findings. The checked pages loaded, ran and laid out without detectable faults.');
    lines.push('');
    return lines.join('\n');
  }

  for (const cluster of clusters) {
    lines.push(renderClusterMarkdown(cluster));
    lines.push('---');
    lines.push('');
  }
  standalone.forEach((f, i) => {
    lines.push(renderFindingMarkdown(f));
    if (i < standalone.length - 1) {
      lines.push('---');
      lines.push('');
    }
  });
  return lines.join('\n');
}

/** Individual issue file content for a single finding (unchanged granularity). */
export function renderSingleIssue(f: Finding, result: ScanResult): string {
  return [
    `# [${f.severity.toUpperCase()}] ${f.title}`,
    '',
    `Reproduced by [ReproCase](https://github.com/geyutu6755/ReproCase) v${result.tool.version} ` +
      `(${result.finishedAt}, scan of ${result.target.entry}).`,
    '',
    renderFindingMarkdown(f)
  ].join('\n');
}
