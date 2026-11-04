const fs = require("fs");
const t = process.env.TOK;
const TAG = "v0.3.2";
const H = { Authorization: "Bearer " + t, "User-Agent": "reprocase", Accept: "application/vnd.github+json", "Content-Type": "application/json" };
const body = fs.readFileSync(".qoder-handover/release-notes-v032.md", "utf8");
const tarPath = "reprocase-0.3.2.tgz";
const buf = fs.readFileSync(tarPath);

async function existingRelease() {
  const r = await fetch(`https://api.github.com/repos/geyutu6755/ReproCase/releases/tags/${TAG}`, { headers: H });
  if (r.status === 200) return r.json();
  return null;
}

(async () => {
  let rel = await existingRelease();
  if (!rel) {
    const r = await fetch("https://api.github.com/repos/geyutu6755/ReproCase/releases", {
      method: "POST", headers: H,
      body: JSON.stringify({ tag_name: TAG, name: "ReproCase v0.3.2 — report URL-scheme hardening & trace-link honesty", body, draft: false, prerelease: false, target_commitish: "43898eff1c30571ba31306b2b50f80629f86ebc0" })
    });
    rel = await r.json();
    console.log("release HTTP", r.status, "| id", rel.id, "| url", rel.html_url);
  } else {
    console.log("release exists | id", rel.id, "| url", rel.html_url);
  }

  const assets = rel.assets || [];
  const have = assets.find((a) => a.name === "reprocase-0.3.2.tgz");
  if (have) {
    console.log("asset already present:", have.name, have.size, have.browser_download_url);
    return;
  }
  const up = await fetch(`https://uploads.github.com/repos/geyutu6755/ReproCase/releases/${rel.id}/assets?name=reprocase-0.3.2.tgz`, {
    method: "POST",
    headers: { Authorization: "Bearer " + t, "User-Agent": "reprocase", Accept: "application/vnd.github+json", "Content-Type": "application/gzip", "Content-Length": String(buf.length) },
    body: buf
  });
  const d = await up.json();
  console.log("asset HTTP", up.status, "|", d.name, "|", d.size, "|", d.browser_download_url);
})();
