// Red/green verification of ReproCase-generated Playwright reproduction tests.
//
// Phase GREEN (fault present):  the specs recorded against the faulted audit
//                               site must PASS (stable reproduction).
// Phase RED (fault fixed):      against a patched site where the two faults
//                               are removed, the same specs must FAIL —
//                               proving they actually detect the fault.
// Phase SWAP (regression mode): replacing the reproduction assertion with the
//                               generated "after fix" assertion must make the
//                               specs PASS again against the fixed site.
//
// Usage: node audit/redgreen.mjs <scanOutputDir>   (scan of audit site on :4640)
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const scanDir = path.resolve(process.argv[2] || 'audit/.out-fixed/report');
const workDir = path.resolve('audit/.out-redgreen');
const siteDir = path.join(workDir, 'site');
const testsDir = path.join(workDir, 'tests');
const MAIN_PORT = 4640;
const FIXED_PORT = 4642;
const results = [];

function log(msg) {
  console.log(msg);
  results.push(msg);
}

function run(cmd, cwd) {
  const r = spawnSync(cmd, { shell: true, cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

// --- prepare work dirs -------------------------------------------------------
fs.rmSync(workDir, { recursive: true, force: true });
fs.mkdirSync(siteDir, { recursive: true });
fs.cpSync(path.resolve('audit/audit-site'), siteDir, { recursive: true });
fs.cpSync(path.join(scanDir, 'generated-tests'), testsDir, { recursive: true });

// --- pick the two specs under test -------------------------------------------
const specFiles = fs.readdirSync(testsDir).filter((f) => f.endsWith('.spec.ts'));
const jsSpec = specFiles.find((f) => fs.readFileSync(path.join(testsDir, f), 'utf8').includes('AuditSyncBoom'));
const ovSpec = specFiles.find((f) => fs.readFileSync(path.join(testsDir, f), 'utf8').includes('audit-inject-wide'));
if (!jsSpec || !ovSpec) {
  console.error('required specs not found', { jsSpec, ovSpec });
  process.exit(1);
}
log(`specs under test: ${jsSpec}, ${ovSpec}`);

function retargetPort(file) {
  const p = path.join(testsDir, file);
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').split(`:${MAIN_PORT}`).join(`:${FIXED_PORT}`), 'utf8');
}

// --- RED-phase site: remove exactly the two faults ---------------------------
const jsClick = path.join(siteDir, 'js-click.html');
fs.writeFileSync(
  jsClick,
  fs
    .readFileSync(jsClick, 'utf8')
    .replace("throw new Error('AuditSyncBoom: crash after click (audit fault)');", '/* fixed: handler no longer throws */'),
  'utf8'
);
const overflow = path.join(siteDir, 'overflow-dynamic.html');
fs.writeFileSync(
  overflow,
  fs.readFileSync(overflow, 'utf8').replace('width:900px;', 'width:100px;'),
  'utf8'
);
log('fixed site prepared: sync crash removed, injected panel narrowed to 100px');

retargetPort(jsSpec);
retargetPort(ovSpec);

const pw = (files) => run(`npx playwright test ${files.join(' ')} --config playwright.config.mjs`, testsDir);

// --- start the fixed-site server ---------------------------------------------
const fixedServer = spawn('node', ['audit/audit-server.mjs', String(FIXED_PORT), siteDir], {
  stdio: 'ignore'
});
await new Promise((r) => setTimeout(r, 800));

let ok = true;
try {
  // --- Phase GREEN: faulted site, reproduction assertions --------------------
  const green = run(`npx playwright test ${JSON.stringify(jsSpec)} ${JSON.stringify(ovSpec)} --config playwright.config.mjs`, path.join(scanDir, 'generated-tests'));
  const greenPassed = green.code === 0 && /2 passed/.test(green.out);
  log(`GREEN (fault present, original specs): ${greenPassed ? 'PASS — 2/2 reproduced' : 'FAIL'}${greenPassed ? '' : '\n' + green.out.slice(-800)}`);
  ok = ok && greenPassed;

  // --- Phase RED: fixed site, same specs must fail ---------------------------
  const red = pw([jsSpec, ovSpec]);
  const redFailed = red.code !== 0 && /2 failed/.test(red.out);
  log(`RED (faults fixed, reproduction assertions): ${redFailed ? 'PASS — 2/2 correctly FAILED (fault no longer reproduces)' : 'FAIL'}${redFailed ? '' : '\n' + red.out.slice(-800)}`);
  ok = ok && redFailed;

  // --- Phase SWAP: switch to the generated "after fix" assertions ------------
  const jsPath = path.join(testsDir, jsSpec);
  fs.writeFileSync(
    jsPath,
    fs
      .readFileSync(jsPath, 'utf8')
      .replace(
        "expect(reproduced, 'Expected the original fault to still reproduce. If this fails, the bug may be fixed — swap in the regression assertion.').toBe(true);",
        "expect(errors, 'page must stay free of JS errors').toEqual([]);"
      ),
    'utf8'
  );
  const ovPath = path.join(testsDir, ovSpec);
  fs.writeFileSync(
    ovPath,
    fs
      .readFileSync(ovPath, 'utf8')
      .replace(
        "expect(m.scrollWidth - m.clientWidth, 'Expected horizontal overflow to still reproduce. If this fails, the bug may be fixed — swap in the regression assertion.').toBeGreaterThan(2);",
        "expect(m.scrollWidth - m.clientWidth, 'no horizontal overflow allowed').toBeLessThanOrEqual(2);"
      ),
    'utf8'
  );
  const swapped = pw([jsSpec, ovSpec]);
  const swappedPassed = swapped.code === 0 && /2 passed/.test(swapped.out);
  log(`SWAP (regression assertions on fixed site): ${swappedPassed ? 'PASS — 2/2 green as regression guards' : 'FAIL'}${swappedPassed ? '' : '\n' + swapped.out.slice(-800)}`);
  ok = ok && swappedPassed;
} finally {
  fixedServer.kill();
}

fs.writeFileSync(path.join(workDir, 'results.md'), results.join('\n') + '\n', 'utf8');
console.log(ok ? 'REDGREEN: ALL_PASS' : 'REDGREEN: FAIL');
process.exit(ok ? 0 : 1);
