const t = process.env.TOK;
const RUN = process.env.RUN;
const H = { Authorization: "Bearer " + t, "User-Agent": "reprocase", Accept: "application/vnd.github+json" };
async function j(u) { for (let i = 0; i < 4; i++) { try { return await (await fetch(u, { headers: H })).json(); } catch (e) { await new Promise((r) => setTimeout(r, 2000)); } } return {}; }
(async () => {
  const jobs = await j(`https://api.github.com/repos/geyutu6755/ReproCase/actions/runs/${RUN}/jobs?per_page=50`);
  const list = jobs.jobs || [];
  console.log("jobs:", list.map((x) => x.name).join(" | "));
  for (const job of list) {
    let logs;
    try {
      const r = await fetch(job.logs, { headers: H });
      logs = await r.text();
    } catch (e) { console.log(job.name, "log fetch err", String(e).slice(0, 80)); continue; }
    const lines = logs.split(/\r?\n/);
    const hits = lines.filter((l) => /deprecat|node\.? ?20|node20|::warning|out of date|actions\/[a-z-]+@v?\d/i.test(l) && /deprecat|::warning|node/i.test(l));
    console.log("\n### " + job.name + "  (log " + lines.length + " lines, " + hits.length + " warning/deprecation-ish lines)");
    hits.slice(0, 12).forEach((h) => console.log("   " + h.trim().slice(0, 160)));
  }
})();
