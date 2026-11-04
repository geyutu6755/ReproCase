const t = process.env.TOK;
const id = process.env.RUN;
const H = { Authorization: "Bearer " + t, "User-Agent": "reprocase", Accept: "application/vnd.github+json" };
async function j(u) {
  const r = await fetch(u, { headers: H });
  return r.json();
}
(async () => {
  for (let i = 0; i < 45; i++) {
    let body;
    try {
      body = await j(`https://api.github.com/repos/geyutu6755/ReproCase/actions/runs/${id}`);
    } catch (e) {
      console.log("poll error", String(e).slice(0, 120));
      await new Promise((r) => setTimeout(r, 20000));
      continue;
    }
    const st = body.status;
    console.log(new Date().toISOString(), "run#" + id, st, body.conclusion || "-");
    if (st === "completed") {
      const jobs = await j(`https://api.github.com/repos/geyutu6755/ReproCase/actions/runs/${id}/jobs`);
      console.log("=== JOBS ===");
      console.log((jobs.jobs || []).map((x) => `${x.name} => ${x.conclusion}`).join("\n"));
      break;
    }
    await new Promise((r) => setTimeout(r, 20000));
  }
})();
