"use strict";
const L = require("./_lib");

// Langkah 3: commit config + www ke repo, lalu jalankan workflow "Build APK"
module.exports = async (req, res) => {
  if (req.method !== "POST") return L.send(res, 405, { error: "Method tidak diizinkan." });
  if (!L.configured()) return L.send(res, 500, { error: "Server belum dikonfigurasi." });

  const b = L.body(req);
  const bad = L.checkAuth(b);
  if (bad) return L.send(res, bad.code, { error: bad.error });

  const v = L.validateMeta(b.meta);
  if (v.error) return L.send(res, 400, { error: v.error });
  const m = v.value;

  // validasi blob dari klien
  const seen = new Set();
  const blobs = [];
  for (const x of Array.isArray(b.blobs) ? b.blobs : []) {
    if (!x || typeof x.path !== "string" || typeof x.sha !== "string" || !L.SHA_RE.test(x.sha) || !L.isUploadPathOk(x.path))
      return L.send(res, 400, { error: "Daftar file tidak valid." });
    if (x.path === "www/url.txt" || seen.has(x.path)) continue;   // url.txt dibuat server
    seen.add(x.path);
    blobs.push(x);
  }
  if (blobs.length > L.LIMIT_FILES) return L.send(res, 400, { error: "Terlalu banyak file (maks " + L.LIMIT_FILES + ")." });
  if (m.source !== "url" && !seen.has("www/index.html"))
    return L.send(res, 400, { error: "www/index.html tidak ditemukan. Pastikan HTML atau ZIP kamu punya index.html." });

  const c = L.cfg();
  const base = `/repos/${c.owner}/${b.repo}`;
  try {
    // satu repo = satu build (cegah dipakai ulang untuk memicu build berulang)
    const hist = await L.gh("GET", `${base}/commits?per_page=2`);
    if (hist.status !== 200 || !Array.isArray(hist.data)) throw new Error("commits " + hist.status);
    if (hist.data.length > 1) return L.send(res, 409, { error: "Repo ini sudah dipakai. Mulai lagi dari awal." });

    const ref = await L.gh("GET", `${base}/git/ref/heads/${L.BRANCH}`);
    if (ref.status !== 200) throw new Error("ref " + ref.status);
    const parent = ref.data.object.sha;
    const pc = await L.gh("GET", `${base}/git/commits/${parent}`);
    if (pc.status !== 200) throw new Error("commit " + pc.status);

    const appJson = JSON.stringify({
      appName: m.appName, packageName: m.packageName, orientation: m.orientation, permissions: m.permissions,
    }, null, 2) + "\n";

    const tree = [{ path: "config/app.json", mode: "100644", type: "blob", content: appJson }];
    if (m.source === "url") {
      tree.push({ path: "www/index.html", mode: "100644", type: "blob", content: L.redirectHtml(m.url) });
      tree.push({ path: "www/url.txt", mode: "100644", type: "blob", content: m.url + "\n" });
    } else {
      tree.push({ path: "www/url.txt", mode: "100644", type: "blob", content: "\n" });
    }
    for (const x of blobs) tree.push({ path: x.path, mode: "100644", type: "blob", sha: x.sha });

    const t = await L.gh("POST", `${base}/git/trees`, { base_tree: pc.data.tree.sha, tree });
    if (t.status !== 201) throw new Error("tree " + t.status + " " + JSON.stringify(t.data).slice(0, 200));
    const cm = await L.gh("POST", `${base}/git/commits`, { message: "Konfigurasi dari website", tree: t.data.sha, parents: [parent] });
    if (cm.status !== 201) throw new Error("commit " + cm.status);
    const up = await L.gh("PATCH", `${base}/git/refs/heads/${L.BRANCH}`, { sha: cm.data.sha });
    if (up.status !== 200) throw new Error("update ref " + up.status);

    // jalankan workflow (GitHub butuh jeda sampai workflow terdaftar -> coba ulang)
    let started = false;
    for (let i = 0; i < 10 && !started; i++) {
      const d = await L.gh("POST", `${base}/actions/workflows/${L.WORKFLOW}/dispatches`, { ref: L.BRANCH, inputs: { build_id: b.build } });
      if (d.status === 204) { started = true; break; }
      console.error("dispatch belum siap", d.status);
      await L.sleep(c.delay + 500);
    }
    if (!started) return L.send(res, 502, { error: "Workflow belum bisa dijalankan. Buka tab Actions di repo lalu jalankan \"Build APK\" manual." });

    return L.send(res, 200, { ok: true });
  } catch (e) {
    console.error("finish gagal", e.message);
    return L.send(res, 502, { error: "Gagal menyimpan konfigurasi ke GitHub. Coba lagi." });
  }
};
