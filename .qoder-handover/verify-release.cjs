const t = process.env.TOK;
const H = { Authorization: "Bearer " + t, "User-Agent": "reprocase", Accept: "application/vnd.github+json" };
async function j(u) { for (let i = 0; i < 4; i++) { try { return await (await fetch(u, { headers: H })).json(); } catch (e) { await new Promise((r) => setTimeout(r, 2500)); } } return {}; }
(async () => {
  const ref = await j("https://api.github.com/repos/geyutu6755/ReproCase/git/ref/heads/main");
  console.log("main ->", ref.object && ref.object.sha.slice(0, 10));
  for (const tag of ["v0.3.0", "v0.3.1", "v0.3.2"]) {
    const rel = await j(`https://api.github.com/repos/geyutu6755/ReproCase/releases/tags/${tag}`);
    const assets = (rel.assets || []).map((a) => a.name + ":" + a.size).join(", ");
    console.log(`RELEASE ${tag}: id ${rel.id || "-"} draft=${rel.draft} target=${(rel.target_commitish || "").slice(0,10)} assets=[${assets}] npmRec=${/npm i -g reprocase[^.]*\s*$/.test("") ? "?" : (/\(or `npm i reprocase`\)/.test(rel.body || "") ? "STILL-OLD" : "clean")}`);
  }
  const pg = await j("https://api.github.com/repos/geyutu6755/ReproCase/pages");
  console.log("PAGES url:", pg.html_url, "| build_type:", pg.build && pg.build.type);
})();
