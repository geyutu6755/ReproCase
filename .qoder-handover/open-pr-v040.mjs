const t = process.env.TOK;
const head = process.env.HEAD;
const REF = "fix/v0.4.0-onboarding";
const H = { Authorization: "Bearer " + t, "User-Agent": "reprocase", Accept: "application/vnd.github+json", "Content-Type": "application/json" };
const body = {
  title: "v0.4.0 — lower install barrier: one-step source install, Node 22+ baseline, config fix",
  head: REF, base: "main",
  body:
    "Adoption-focused release on the verified v0.3.3 base. No new detection rules; no UI rebuild.\n\n" +
    "- Node baseline -> 22+ (Node 18/20 are EOL). engines, README(en/zh), installation, compatibility and the CI matrix (now Node 22 & 24) all aligned. doctor's Node check matches.\n" +
    "- One-step source install: added prepare:npm run build, so `npm install` builds dist/ and `npm i -g github:…#tag` actually works (previously shipped unbuilt TS). Quick start drops the manual build. Verified: clean source install rebuilds dist and runs.\n" +
    "- Vitest: removed deprecated test.poolOptions -> top-level maxWorkers:1 (isolation unchanged). Suite 137/137.\n" +
    "- Independent probe app validated accuracy: cross-page reliable clusters, lazy/async + rejection detection, same-page dedupe, out-of-scope/mailto:/javascript: ignored, risky buttons skipped, forms untouched, 2-run reproducibility (23 checks pass).\n" +
    "- README screenshots regenerated from the real v0.4.0 report.\n\n" +
    "All security constraints + legacy regressions preserved (net/report/attachment/authorization 52 tests green). This PR's 4-platform CI also validates the Node 22 & 24 matrix.\n\nHead: " + head.slice(0, 7)
};
(async () => {
  const d = await (await fetch("https://api.github.com/repos/geyutu6755/ReproCase/pulls?state=open&per_page=30", { headers: H })).json();
  const mine = (d || []).filter((p) => p.head && p.head.ref === REF);
  if (mine.length) { console.log("EXISTING PR#" + mine[0].number + " | " + mine[0].html_url); return; }
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch("https://api.github.com/repos/geyutu6755/ReproCase/pulls", { method: "POST", headers: H, body: JSON.stringify(body) });
      const j = await r.json();
      if (j.number) { console.log("HTTP " + r.status + " | PR#" + j.number + " | " + j.html_url); return; }
      console.log("try " + i + " " + JSON.stringify(j).slice(0, 160));
    } catch (e) { console.log("try " + i + " err " + String(e).slice(0, 120)); }
    await new Promise((r) => setTimeout(r, 3000));
  }
})();
