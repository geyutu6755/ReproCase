const t = process.env.TOK;
const head = process.env.HEAD;
const H = {
  Authorization: "Bearer " + t,
  "User-Agent": "reprocase",
  Accept: "application/vnd.github+json",
  "Content-Type": "application/json"
};

async function existing() {
  const r = await fetch("https://api.github.com/repos/geyutu6755/ReproCase/pulls?state=open&per_page=30", { headers: H });
  const d = await r.json();
  const mine = (d || []).filter((p) => p.head && p.head.ref === "fix/v0.3.2-hardening");
  return mine[0];
}

async function create() {
  const body = {
    title: "v0.3.2 — report link-scheme hardening & trace-link honesty",
    head: "fix/v0.3.2-hardening",
    base: "main",
    body:
      "Post-release hardening on the verified v0.3.1 base.\n\n" +
      "- SECURITY: report.html assigned result.json URLs to anchor `href` with no scheme check; a crafted/shared/older result.json opened as an offline report could yield a `javascript:`/`data:` link (self-XSS). All dynamic links (member/finding/plan/page) + the header target now validate http(s); unsafe URLs render as text. Reproduced (live javascript: anchors) then fixed.\n" +
      "- UX: trace links state they are local/private and absent from hosted/public copies; traces remain stripped by CI/Pages.\n" +
      "- Tests 132 -> 136 (real-browser URL-safety, header guard, trace-copy honesty). No tests removed or weakened.\n" +
      "- Version/docs/lock -> 0.3.2; v0.3.1 Release install note corrected (npm not published).\n\n" +
      "Head: " + head.slice(0, 7)
  };
  const r = await fetch("https://api.github.com/repos/geyutu6755/ReproCase/pulls", { method: "POST", headers: H, body: JSON.stringify(body) });
  return { status: r.status, data: await r.json() };
}

(async () => {
  const ex = await existing();
  if (ex) {
    console.log("EXISTING PR#" + ex.number + " | " + ex.html_url);
    return;
  }
  for (let i = 0; i < 4; i++) {
    try {
      const { status, data } = await create();
      if (data.number) {
        console.log("HTTP " + status + " | PR#" + data.number + " | " + data.html_url);
        return;
      }
      console.log("try " + i + " unexpected " + JSON.stringify(data).slice(0, 180));
    } catch (e) {
      console.log("try " + i + " err " + String(e).slice(0, 120));
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  console.log("FAILED to create PR");
})();
