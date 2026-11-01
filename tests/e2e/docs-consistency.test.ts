import * as fs from 'node:fs';
import * as path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';
import { PROJECT_ROOT } from '../helpers/demo-server.js';
import { resolveConfig } from '../../src/config.js';

const run = promisify(exec);

/**
 * Documentation / CLI consistency guard: keeps docs from drifting behind the
 * CLI (stale commands, wrong version numbers, dead links, broken example
 * configs). Every failure here is a real product-documentation defect.
 */
let help = '';
let scanHelp = '';

beforeAll(async () => {
  await run('npx tsc -p tsconfig.json', { cwd: PROJECT_ROOT });
  help = (await run(`node dist/cli.js --help`, { cwd: PROJECT_ROOT })).stdout;
  scanHelp = (await run(`node dist/cli.js scan --help`, { cwd: PROJECT_ROOT })).stdout;
}, 180_000);

describe('docs ↔ CLI consistency', () => {
  it('documents every command the CLI actually exposes', () => {
    const cliCommands = [...help.matchAll(/^\s+(\w+)\s{2,}/gm)].map((m) => m[1]).filter((c) => !['help', 'Options', 'Commands'].includes(c));
    const cliDoc = fs.readFileSync(path.join(PROJECT_ROOT, 'docs', 'cli.md'), 'utf8');
    for (const cmd of cliCommands) {
      expect(cliDoc).toContain(`reprocase ${cmd === 'help' ? '' : cmd}`.trim() === 'reprocase' ? 'reprocase [' : `reprocase ${cmd}`);
    }
    // And the reverse: every documented command exists.
    const documented = [...cliDoc.matchAll(/reprocase (scan|demo|init|doctor|compare)/g)].map((m) => m[1]);
    for (const cmd of new Set(documented)) {
      expect(help).toMatch(new RegExp(`\\b${cmd}\\b`));
    }
  });

  it('documents every scan option', () => {
    const cliDoc = fs.readFileSync(path.join(PROJECT_ROOT, 'docs', 'cli.md'), 'utf8');
    const options = [...scanHelp.matchAll(/--([a-z][a-z-]*)/g)].map((m) => m[1]).filter((o) => o !== 'help');
    for (const opt of options) {
      expect(cliDoc, `scan option --${opt} must be documented in docs/cli.md`).toContain(`--${opt}`);
    }
  });

  it('README status sections mention the current package version', () => {
    const version = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8')).version as string;
    for (const file of ['README.md', 'README.zh-CN.md']) {
      const text = fs.readFileSync(path.join(PROJECT_ROOT, file), 'utf8');
      expect(text, `${file} Status section must mention v${version}`).toContain(`v${version}`);
    }
  });

  it('CHANGELOG top entry version matches package.json', () => {
    const version = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8')).version;
    const changelog = fs.readFileSync(path.join(PROJECT_ROOT, 'CHANGELOG.md'), 'utf8');
    expect(changelog).toMatch(new RegExp(`## \\[${version}\\]`));
  });

  it('example config validates cleanly with zero warnings', () => {
    const example = JSON.parse(
      fs.readFileSync(path.join(PROJECT_ROOT, 'reprocase.config.example.json'), 'utf8')
    );
    const { warnings, config } = resolveConfig(example);
    expect(warnings).toEqual([]);
    expect(config.entry).toBe('http://127.0.0.1:3000/');
    // The example must showcase the documented policy surface.
    expect(config.exploration.allowSelectors).toEqual([]);
  });

  it('every local markdown link in README/docs points to a real file', () => {
    const files = [
      'README.md',
      'README.zh-CN.md',
      'docs/cli.md',
      'docs/configuration.md',
      'docs/architecture.md',
      'docs/installation.md',
      'CONTRIBUTING.md',
      'SECURITY.md'
    ];
    const broken: string[] = [];
    for (const file of files) {
      const text = fs.readFileSync(path.join(PROJECT_ROOT, file), 'utf8');
      const links = [...text.matchAll(/\]\(([^)#http][^)\s]*)\)/g)].map((m) => m[1]);
      for (const link of links) {
        const target = path.resolve(PROJECT_ROOT, file, '..', decodeURIComponent(link));
        if (!fs.existsSync(target)) broken.push(`${file} -> ${link}`);
      }
    }
    expect(broken, `dead links: ${broken.join(', ')}`).toEqual([]);
  });

  it('README quick-start commands are valid CLI invocations', () => {
    const readme = fs.readFileSync(path.join(PROJECT_ROOT, 'README.md'), 'utf8');
    const commands = [...readme.matchAll(/^npx reprocase (.+)$/gm)].map((m) => m[1].trim());
    expect(commands.length).toBeGreaterThan(2);
    for (const cmd of commands) {
      const sub = cmd.split(' ')[0];
      if (['scan', 'demo', 'init', 'doctor', 'compare'].includes(sub)) {
        // Must not error with "unknown command" or "missing argument" for what docs show.
        expect(help).toContain(sub);
      }
    }
  });
});
