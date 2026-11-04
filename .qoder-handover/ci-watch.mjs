const t = process.env.TOK;
const sha = process.env.SHA;
const event = process.env.EVENT || "pull_request";
const H = { Authorization: "Bearer " + t, "User-Agent": "reprocase", Accept: "application/vnd.github+json" };
async function j(u) {
  for (let i = 0; i < 4; i++) {
    try { return await (await fetch(u, { headers: H })).json(); }
    catch (e) { await new Promise((r) => setTimeout(r, 2500)); }
  }
  return {};
}
(async () => {
  let id = null;
  for (let k = 0; k < 45; k++) {
    const d = await j(`https://api.github.com/repos/geyutu6755/ReproCase/actions/runs?head_sha=${sha}&event=${event}&per_page=10`);
    const ci = (d.workflow_runs || []).find((w) => w.name === "CI");
    if (!ci) { console.log(new Date().toISOString(), "no CI run yet"); await new Promise((r) => setTimeout(r, 12000)); continue; }
    id = ci.id;
    console.log(new Date().toISOString(), "CI run#" + id, ci.status, ci.conclusion || "-");
    if (ci.status === "completed") {
      const jobs = await j(`https://api.github.com/repos/geyutu6755/ReproCase/actions/runs/${id}/jobs`);
      console.log("=== JOBS ===");
      console.log((jobs.jobs || []).map((x) => `${x.name} => ${x.conclusion}`).join("\n"));
      return;
    }
    await new Promise((r) => setTimeout(r, 15000));
  }
  console.log("watcher timed out; last run#", id);
})();
