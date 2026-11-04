const t = process.env.TOK;
const num = process.env.PR;
const H = { Authorization: "Bearer " + t, "User-Agent": "reprocase", Accept: "application/vnd.github+json", "Content-Type": "application/json" };
async function get() {
  const d = await (await fetch(`https://api.github.com/repos/geyutu6755/ReproCase/pulls/${num}`, { headers: H })).json();
  return d;
}
(async () => {
  const pr = await get();
  console.log("PR#" + num, "mergeable=" + pr.mergeable, "state=" + pr.mergeable_state, "head=" + pr.head.sha.slice(0, 10));
  if (pr.merged) { console.log("already merged; merge_sha=" + pr.merge_commit_sha); return; }
  const r = await fetch(`https://api.github.com/repos/geyutu6755/ReproCase/pulls/${num}/merge`, {
    method: "PUT", headers: H,
    body: JSON.stringify({ sha: pr.head.sha, merge_method: "merge", commit_title: `Merge v0.3.${num === "2" ? "2" : ""} release PR`, commit_message: "Release acceptance: 136/136 local + CI matrix green on the v0.3.2 commit (ubuntu Node 20/22, macOS 22, Windows 22)." })
  });
  const d = await r.json();
  console.log("merge HTTP", r.status, "| merged", d.merged, "| sha", d.sha);
})();
