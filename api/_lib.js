"use strict";
const crypto = require("crypto");

// ---------------------------------------------------------------------------
// Konfigurasi (dibaca dari Environment Variables Vercel)
//   GITHUB_USERNAME : username GitHub pemilik template & pembuat repo baru
//   GITHUB_TOKEN    : Personal Access Token (classic: scope "repo" + "workflow")
//   APP_SECRET      : (opsional) kunci penanda tangan sesi; default diturunkan dari token
//   TEMPLATE_REPO / TEMPLATE_OWNER : (opsional) ganti template
// ---------------------------------------------------------------------------
const DEFAULT_TEMPLATE_OWNER = "nugroho20122012yr-art";
const DEFAULT_TEMPLATE_REPO = "Gctdacceccecscehcdhdhyhehgositrusrusyrsraarsdaurarusurzruseuzrzyezdu";

const cfg = () => ({
  owner: process.env.GITHUB_USERNAME || process.env.GITHUB_USER || "",
  token: process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "",
  templateOwner: process.env.TEMPLATE_OWNER || DEFAULT_TEMPLATE_OWNER,
  templateRepo: process.env.TEMPLATE_REPO || DEFAULT_TEMPLATE_REPO,
  api: process.env.GITHUB_API || "https://api.github.com",
  delay: Number(process.env.W2A_DELAY_MS) || 1500,
});

const BRANCH = "main";
const WORKFLOW = "build-apk.yml";
const LIMIT_FILE = 3 * 1024 * 1024;       // per file
const LIMIT_BATCH = 3.6 * 1024 * 1024;    // per request upload
const LIMIT_FILES = 400;
const SESSION_MS = 45 * 60 * 1000;

const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{9,79}$/;
const BUILD_RE = /^[a-f0-9]{12}$/;
const SHA_RE = /^[0-9a-f]{40}$/;

const JAVA_KW = new Set(["abstract","assert","boolean","break","byte","case","catch","char","class","const",
  "continue","default","do","double","else","enum","extends","final","finally","float","for","goto","if",
  "implements","import","instanceof","int","interface","long","native","new","package","private","protected",
  "public","return","short","static","strictfp","super","switch","synchronized","this","throw","throws",
  "transient","try","void","volatile","while"]);
const PERMS = ["notification","bluetooth","file_manager","camera","video","audio","location","vibrate","wifi_state","wake_lock"];
const ORIENTATIONS = ["portrait","landscape","auto"];
const SOURCES = ["url","html","zip"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const configured = () => { const c = cfg(); return !!(c.owner && c.token); };

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
function send(res, code, obj, headers) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (headers) for (const k of Object.keys(headers)) res.setHeader(k, headers[k]);
  res.end(JSON.stringify(obj));
}

function body(req) {
  let b = req.body;
  if (typeof b === "string") { try { b = JSON.parse(b); } catch (e) { b = null; } }
  return b && typeof b === "object" ? b : {};
}

function clientIp(req) {
  const h = req.headers || {};
  return String(h["x-real-ip"] || String(h["x-forwarded-for"] || "").split(",")[0] || (req.socket && req.socket.remoteAddress) || "x").trim();
}

// Pembatas laju sederhana (best-effort; memori instance serverless)
const hits = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { hits.set(key, arr); return false; }
  arr.push(now);
  hits.set(key, arr);
  if (hits.size > 5000) { for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > windowMs) hits.delete(k); }
  return true;
}

async function gh(method, path, payload) {
  const c = cfg();
  const headers = {
    Authorization: "Bearer " + c.token,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "web2apk-site",
  };
  if (payload !== undefined) headers["Content-Type"] = "application/json";
  const r = await fetch(c.api + path, { method, headers, body: payload !== undefined ? JSON.stringify(payload) : undefined });
  const text = await r.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch (e) { data = { raw: text.slice(0, 300) }; } }
  return { status: r.status, ok: r.ok, data };
}

async function mapLimit(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

// ---------------------------------------------------------------------------
// Nama repo acak: A-Z a-z 0-9 _ -  (GitHub TIDAK mengizinkan @ dan #), panjang 10-80
// ---------------------------------------------------------------------------
const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const REST = ALNUM + "_-";
function randomRepoName() {
  const len = crypto.randomInt(10, 81);
  let s = ALNUM[crypto.randomInt(ALNUM.length)];
  for (let i = 1; i < len; i++) s += REST[crypto.randomInt(REST.length)];
  return s;
}
const randomBuildId = () => crypto.randomBytes(6).toString("hex");

// ---------------------------------------------------------------------------
// Tanda tangan sesi: mencegah orang menulis ke repo lain di akun ini
// ---------------------------------------------------------------------------
function secret() {
  return process.env.APP_SECRET || crypto.createHash("sha256").update("web2apk:" + cfg().token).digest("hex");
}
const mac = (repo, build, ts) => crypto.createHmac("sha256", secret()).update(repo + "|" + build + "|" + ts).digest("hex");
function sign(repo, build) { const ts = Date.now(); return ts + "." + mac(repo, build, ts); }
function checkAuth(b) {
  const repo = b.repo, build = b.build, sig = b.sig;
  if (typeof repo !== "string" || !REPO_RE.test(repo) || typeof build !== "string" || !BUILD_RE.test(build) || typeof sig !== "string")
    return { code: 400, error: "Data sesi tidak valid. Muat ulang halaman lalu coba lagi." };
  const [ts, m] = sig.split(".");
  if (!/^\d+$/.test(ts || "") || !/^[a-f0-9]{64}$/.test(m || ""))
    return { code: 403, error: "Sesi tidak valid. Muat ulang halaman lalu coba lagi." };
  if (Date.now() - Number(ts) > SESSION_MS)
    return { code: 403, error: "Sesi kedaluwarsa. Muat ulang halaman lalu mulai lagi." };
  const a = Buffer.from(m, "hex"), e = Buffer.from(mac(repo, build, ts), "hex");
  if (a.length !== e.length || !crypto.timingSafeEqual(a, e))
    return { code: 403, error: "Sesi tidak valid. Muat ulang halaman lalu coba lagi." };
  return null;
}

// ---------------------------------------------------------------------------
// Validasi input (cermin dari prepare.py - server TIDAK percaya input klien)
// ---------------------------------------------------------------------------
function validateMeta(m) {
  if (!m || typeof m !== "object") return { error: "Data form kosong." };
  const appName = typeof m.appName === "string" ? m.appName.trim() : "";
  if (!appName || appName.length > 50 || /[\u0000-\u001f\u007f]/.test(appName))
    return { error: "Nama aplikasi wajib diisi (maksimal 50 karakter)." };
  const packageName = typeof m.packageName === "string" ? m.packageName.trim() : "";
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(packageName) || packageName.length > 150 ||
      packageName.split(".").some((p) => JAVA_KW.has(p)))
    return { error: "Package name tidak valid. Pakai huruf kecil dan titik, contoh: com.nama.app" };
  const orientation = ORIENTATIONS.includes(m.orientation) ? m.orientation : null;
  if (!orientation) return { error: "Pilih orientasi layar." };
  if (!Array.isArray(m.permissions) || m.permissions.length > 30) return { error: "Daftar izin tidak valid." };
  const permissions = [];
  for (const p of m.permissions) {
    if (!PERMS.includes(p)) return { error: "Ada izin yang tidak dikenal." };
    if (!permissions.includes(p)) permissions.push(p);
  }
  const source = SOURCES.includes(m.source) ? m.source : null;
  if (!source) return { error: "Pilih sumber isi aplikasi (link, HTML, atau ZIP)." };
  let url = "";
  if (source === "url") {
    try {
      const u = new URL(String(m.url || "").trim());
      if (u.protocol !== "https:" || u.username || u.password || u.href.length > 2000) throw new Error("x");
      url = u.href;
    } catch (e) { return { error: "Link website harus diawali https:// dan valid." }; }
  }
  return { value: { appName, packageName, orientation, permissions, source, url } };
}

const SEG = "[\\p{L}\\p{N}._\\-@+() \\[\\]]+";
const WWW_RE = new RegExp("^www/(?:" + SEG + "/)*" + SEG + "$", "u");
function isUploadPathOk(p) {
  if (p === "config/icon.png") return true;
  if (typeof p !== "string" || p.length > 200 || !WWW_RE.test(p)) return false;
  return !p.split("/").some((s) => s === "." || s === ".." || s.trim() === "");
}

function redirectHtml(href) {
  const attr = href.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;");
  const js = JSON.stringify(href).replace(/</g, "\\u003c");
  return '<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0">\n' +
    '<meta http-equiv="Refresh" content="0; url=' + attr + '" />\n' +
    "<script>window.location.replace(" + js + ");</script>\n</head>\n" +
    '<body style="margin:0;padding:0;background-color:#ffffff;display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;">\nMemuat...\n</body>\n</html>\n';
}

async function waitReady(repo, maxMs) {
  const c = cfg();
  const end = Date.now() + maxMs;
  while (Date.now() < end) {
    const r = await gh("GET", `/repos/${c.owner}/${repo}/git/ref/heads/${BRANCH}`);
    if (r.status === 200) return true;
    await sleep(c.delay);
  }
  return false;
}

module.exports = {
  cfg, configured, send, body, clientIp, rateLimit, gh, mapLimit, sleep,
  randomRepoName, randomBuildId, sign, checkAuth, validateMeta, isUploadPathOk, redirectHtml, waitReady,
  BRANCH, WORKFLOW, LIMIT_FILE, LIMIT_BATCH, LIMIT_FILES, REPO_RE, BUILD_RE, SHA_RE,
};
