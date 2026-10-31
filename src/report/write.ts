import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ScanResult } from '../types.js';
import { renderHtml } from './html.js';
import { renderIssuesMarkdown, renderSingleIssue } from './issue.js';

/**
 * Writes the complete report bundle into `outDir`:
 *   result.json            machine-readable scan result
 *   report.html            self-contained offline HTML report
 *   index.html             same document (convenient for static hosting)
 *   issues.md              combined GitHub-Issue markdown
 *   issues/<id>.md         one file per finding
 */
export function writeReports(outDir: string, result: ScanResult): string[] {
  fs.mkdirSync(path.join(outDir, 'issues'), { recursive: true });
  const written: string[] = [];

  fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(result, null, 2), 'utf8');
  written.push('result.json');

  const html = renderHtml(result);
  fs.writeFileSync(path.join(outDir, 'report.html'), html, 'utf8');
  fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf8');
  written.push('report.html', 'index.html');

  fs.writeFileSync(path.join(outDir, 'issues.md'), renderIssuesMarkdown(result), 'utf8');
  written.push('issues.md');

  for (const f of result.findings) {
    const file = path.join(outDir, 'issues', `${f.id}.md`);
    fs.writeFileSync(file, renderSingleIssue(f, result), 'utf8');
    written.push(`issues/${f.id}.md`);
  }
  return written;
}
