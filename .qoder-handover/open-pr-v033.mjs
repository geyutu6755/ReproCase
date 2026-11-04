const t = process.env.TOK;
const head = process.env.HEAD;
const REF = "fix/v0.3.3-attachment-safety";
const H = { Authorization: "Bearer " + t, "User-Agent": "reprocase", Accept: "application/vnd.github+json", "Content-Type": "application/json" };
const body = {
  title: "v0.3.3 — attachment path safety + CI Node-24 action runtimes",
  head: REF, base: "main",
  body:
    "Two focused changes on the verified v0.3.2 base.\n\n" +
    "SECURITY (fixes real defect): report.html set trace `href` and screenshot `src` from result.json using only encodeURI, so a crafted/shared report could expose a clickable javascript: trace link (self-XSS) or data:/path-traversal images. Reproduced in Chromium, then fixed with one safeArtifact() guard (scheme/protocol-relative/absolute/backslash/'..' rejected) applied to trace href+download, screenshot src and the lightbox. Normal local artifacts still work. Tests 136 -> 137.\n\n" +
    "CI MAINTENANCE: Node 20 removed from GitHub runners (2026-09-16). Moved to the minimal Node-24 majors verified from each action's action.yml `runs.using`: checkout@v5, setup-node@v5, upload-artifact@v6 (v5 still node20), configure-pages@v6, deploy-pages@v5. upload-pages-artifact is composite (unchanged). Project Node 20/22 test matrix preserved. This PR's 4-platform CI run also verifies the new action versions actually work.\n\n" +
    "Version/docs/lock -> 0.3.3.\n\nHead: " + head.slice(0, 7)
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
      console.log("try " + i + " unexpected " + JSON.stringify(j).slice(0, 180));
    } catch (e) { console.log("try " + i + " err " + String(e).slice(0, 120)); }
    await new Promise((r) => setTimeout(r, 3000));
  }
})();
