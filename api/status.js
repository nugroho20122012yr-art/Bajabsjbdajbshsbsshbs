"use strict";
const L = require("./_lib");

// Pantau build: antrean -> berjalan -> selesai (tautan unduh APK dari Releases)
module.exports = async (req, res) => {
  if (req.method !== "GET") return L.send(res, 405, { error: "Method tidak diizinkan." });
  if (!L.configured()) return L.send(res, 500, { error: "Server belum dikonfigurasi." });

  const q = req.query || Object.fromEntries(new URL(req.url, "http://x").searchParams);
  const repo = String(q.repo || ""), build = String(q.build || "");
  if (!L.REPO_RE.test(repo) || !L.BUILD_RE.test(build)) return L.send(res, 400, { error: "Parameter tidak valid." });

  const c = L.cfg();
  const base = `/repos/${c.owner}/${repo}`;
  const out = { stage: "waiting", steps: [], repoUrl: `https://github.com/${c.owner}/${repo}`, runUrl: null, download: null };
  const cache = { "Cache-Control": "public, s-maxage=5, stale-while-revalidate=5" };

  try {
    const runs = await L.gh("GET", `${base}/actions/runs?event=workflow_dispatch&per_page=3`);
    const run = runs.status === 200 && runs.data && runs.data.workflow_runs && runs.data.workflow_runs[0];
    if (!run) return L.send(res, 200, out, cache);
    out.runUrl = run.html_url;

    const jobs = await L.gh("GET", `${base}/actions/runs/${run.id}/jobs`);
    const job = jobs.status === 200 && jobs.data && jobs.data.jobs && jobs.data.jobs[0];
    if (job && Array.isArray(job.steps)) {
      out.steps = job.steps
        .filter((s) => !/^(Set up job|Complete job|Post )/.test(s.name))
        .map((s) => ({ name: String(s.name).slice(0, 80), status: s.status, conclusion: s.conclusion }));
    }

    if (run.status !== "completed") { out.stage = run.status === "in_progress" ? "building" : "queued"; return L.send(res, 200, out, cache); }
    if (run.conclusion !== "success") { out.stage = "failed"; return L.send(res, 200, out, cache); }

    const rel = await L.gh("GET", `${base}/releases?per_page=5`);
    const hit = rel.status === 200 && Array.isArray(rel.data) &&
      rel.data.find((r) => typeof r.body === "string" && r.body.includes("build_id: " + build));
    const asset = hit && (hit.assets || []).find((a) => /\.apk$/i.test(a.name));
    if (asset) { out.stage = "done"; out.download = asset.browser_download_url; return L.send(res, 200, out, cache); }
    out.stage = "finalizing";
    return L.send(res, 200, out);
  } catch (e) {
    console.error("status gagal", e.message);
    return L.send(res, 502, { error: "Gagal membaca status dari GitHub." });
  }
};
