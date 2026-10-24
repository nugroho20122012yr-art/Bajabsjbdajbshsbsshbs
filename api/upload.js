"use strict";
const L = require("./_lib");

// Langkah 2: unggah file (ikon / isi www) sebagai blob Git ke repo milik sesi
module.exports = async (req, res) => {
  if (req.method !== "POST") return L.send(res, 405, { error: "Method tidak diizinkan." });
  if (!L.configured()) return L.send(res, 500, { error: "Server belum dikonfigurasi." });

  const b = L.body(req);
  const bad = L.checkAuth(b);
  if (bad) return L.send(res, bad.code, { error: bad.error });

  const files = b.files;
  if (!Array.isArray(files) || !files.length || files.length > 40)
    return L.send(res, 400, { error: "Daftar file tidak valid." });

  let total = 0;
  for (const f of files) {
    if (!f || typeof f.path !== "string" || typeof f.b64 !== "string")
      return L.send(res, 400, { error: "Format file tidak valid." });
    if (!L.isUploadPathOk(f.path))
      return L.send(res, 400, { error: "Nama file tidak diizinkan: " + f.path.slice(0, 80) });
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(f.b64))
      return L.send(res, 400, { error: "Isi file rusak: " + f.path.slice(0, 80) });
    const pad = f.b64.endsWith("==") ? 2 : f.b64.endsWith("=") ? 1 : 0;
    const size = Math.floor((f.b64.length * 3) / 4) - pad;
    if (size > L.LIMIT_FILE)
      return L.send(res, 413, { error: "File terlalu besar (maks 3 MB per file): " + f.path.slice(0, 80) });
    total += size;
    if (total > L.LIMIT_BATCH) return L.send(res, 413, { error: "Satu permintaan terlalu besar. Muat ulang lalu coba lagi." });
    if (f.path === "config/icon.png") {
      const head = Buffer.from(f.b64.slice(0, 16), "base64");
      if (size > 1.5 * 1024 * 1024 || head.length < 4 || head[0] !== 0x89 || head[1] !== 0x50 || head[2] !== 0x4e || head[3] !== 0x47)
        return L.send(res, 400, { error: "Ikon harus berupa gambar PNG (maks 1,5 MB)." });
    }
  }

  const c = L.cfg();
  try {
    const blobs = await L.mapLimit(files, 5, async (f) => {
      const r = await L.gh("POST", `/repos/${c.owner}/${b.repo}/git/blobs`, { content: f.b64, encoding: "base64" });
      if (r.status !== 201 || !r.data || !L.SHA_RE.test(r.data.sha)) throw new Error("blob " + r.status);
      return { path: f.path, sha: r.data.sha };
    });
    return L.send(res, 200, { blobs });
  } catch (e) {
    console.error("upload gagal", e.message);
    return L.send(res, 502, { error: "Gagal mengunggah file ke GitHub. Coba lagi." });
  }
};
