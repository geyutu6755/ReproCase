const fs = require("fs");
const t = process.env.TOK;
const TAG = "v0.3.3";
const TARGET = "fa714452dd08a6d0213364262a347744b15af3b8";
const H = { Authorization: "Bearer " + t, "User-Agent": "reprocase", Accept: "application/vnd.github+json", "Content-Type": "application/json" };
const body = fs.readFileSync(".qoder-handover/release-notes-v033.md", "utf8");
const buf = fs.readFileSync("reprocase-0.3.3.tgz");

async function existingRelease() {
  const r = await fetch(`https://api.github.com/repos/geyutu6755/ReproCase/releases/tags/${TAG}`, { headers: H });
  return r.status === 200 ? r.json() : null;
}
(async () => {
  let rel = await existingRelease();
  if (!rel) {
    const r = await fetch("https://api.github.com/repos/geyutu6755/ReproCase/releases", {
      method: "POST", headers: H,
      body: JSON.stringify({ tag_name: TAG, name: "ReproCase v0.3.3 — attachment path safety + CI Node-24 action runtimes", body, draft: false, prerelease: false, target_commitish: TARGET })
    });
    rel = await r.json();
    console.log("release HTTP", r.status, "| id", rel.id, "|", rel.html_url);
  } else console.log("release exists | id", rel.id);
  const have = (rel.assets || []).find((a) => a.name === "reprocase-0.3.3.tgz");
  if (have) { console.log("asset present:", have.name, have.size); return; }
  const up = await fetch(`https://uploads.github.com/repos/geyutu6755/ReproCase/releases/${rel.id}/assets?name=reprocase-0.3.3.tgz`, {
    method: "POST", headers: { Authorization: "Bearer " + t, "User-Agent": "reprocase", Accept: "application/vnd.github+json", "Content-Type": "application/gzip", "Content-Length": String(buf.length) }, body: buf });
  const d = await up.json();
  console.log("asset HTTP", up.status, "|", d.name, "|", d.size, "|", d.browser_download_url);
})();
