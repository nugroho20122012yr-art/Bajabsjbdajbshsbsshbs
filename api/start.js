"use strict";
const L = require("./_lib");

// Langkah 1: validasi form -> buat repo acak dari template -> kembalikan sesi bertanda tangan
module.exports = async (req, res) => {
  if (req.method !== "POST") return L.send(res, 405, { error: "Method tidak diizinkan." });
  if (!L.configured()) return L.send(res, 500, { error: "Server belum dikonfigurasi: isi GITHUB_USERNAME dan GITHUB_TOKEN di Environment Variables Vercel." });

  // validasi dulu: salah ketik tidak boleh menghabiskan jatah
  const v = L.validateMeta(L.body(req).meta);
  if (v.error) return L.send(res, 400, { error: v.error });
  if (!L.rateLimit("start:" + L.clientIp(req), 4, 15 * 60 * 1000))
    return L.send(res, 429, { error: "Terlalu banyak permintaan. Tunggu sekitar 15 menit lalu coba lagi." });

  const c = L.cfg();
  let repo = null;
  for (let i = 0; i < 4 && !repo; i++) {
    const name = L.randomRepoName();
    const r = await L.gh("POST", `/repos/${c.templateOwner}/${c.templateRepo}/generate`, {
      owner: c.owner, name, description: "Web2APK build", private: false, include_all_branches: false,
    });
    if (r.status === 201) { repo = name; break; }
    const msg = JSON.stringify(r.data || {});
    console.error("generate gagal", r.status, msg.slice(0, 300));
    if (r.status === 422 && /already exists/i.test(msg)) continue; // nama bentrok -> acak ulang
    return L.send(res, 502, { error: "Gagal membuat repo di GitHub. Coba lagi beberapa saat lagi." });
  }
  if (!repo) return L.send(res, 502, { error: "Gagal membuat nama repo unik. Coba lagi." });

  if (!(await L.waitReady(repo, 35000)))
    return L.send(res, 504, { error: "Repo belum siap di GitHub. Coba lagi." });

  const build = L.randomBuildId();
  return L.send(res, 200, { repo, owner: c.owner, build, sig: L.sign(repo, build) });
};
