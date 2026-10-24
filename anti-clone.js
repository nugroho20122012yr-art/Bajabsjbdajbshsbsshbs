/*!
 * anti-clone.js
 * Fungsi: VERIFIKASI untuk index.html (halaman gerbang) di root proyek.
 *
 * Alur mode "gate" (index.html):
 *   1. Domain harus ada di ALLOWED_HOSTS.
 *   2. anti-clone.js harus dimuat dari domain yang sama.
 *   3. Isi index.html harus utuh: hanya teks pelindung, satu <p>, satu <script>,
 *      tanpa iframe / form / link / gambar / stylesheet luar.
 *   4. Lolos semua -> pengunjung diarahkan ke website utama (MAIN_SITE).
 *      Gagal       -> tetap di halaman ini dengan pesan "Verifikasi gagal".
 *
 * Mode "guard" (<script src="/anti-clone.js" data-mode="guard">) dipakai website
 * utama: hanya memeriksa domain (langkah 1), lalu memblokir halaman jika tidak cocok.
 *
 * CATATAN JUJUR: ini pencegah ringan di sisi browser. Orang yang paham bisa
 * mengakalinya (mis. mematikan JavaScript). Bagian yang benar-benar aman ada di
 * server: token GitHub tidak pernah keluar dari /api.
 */
(function () {
  "use strict";

  // ============================ KONFIGURASI ============================
  // WAJIB diisi: domain tempat website ini dipasang. Contoh:
  //   "web2apk-kamu.vercel.app"   -> domain persis
  //   "*.domainku.com"            -> semua subdomain domainku.com
  var ALLOWED_HOSTS = [
    "web2apk-cid-nyr-dev.vercel.app"
    // , "web2apk-kamu.vercel.app"
  ];
  var MAIN_SITE = "/web2apk-site/";
  var NOTICE = "halaman ini dilindungi oleh anti-clone.js";
  // =====================================================================

  var script = document.currentScript;
  var mode = (script && script.getAttribute("data-mode")) || "gate";
  var host = location.hostname.toLowerCase();

  function hostAllowed() {
    return ALLOWED_HOSTS.some(function (h) {
      h = String(h).toLowerCase();
      if (h.indexOf("*.") === 0) {
        var suffix = h.slice(1);
        return host.length > suffix.length && host.slice(-suffix.length) === suffix;
      }
      return host === h;
    });
  }

  function whenReady(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  function showMessage(text) {
    var b = document.body;
    while (b.firstChild) b.removeChild(b.firstChild);
    b.style.cssText = "margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;" +
      "box-sizing:border-box;padding:24px;text-align:center;background:#DCE3EA;color:#000;" +
      "font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-weight:600";
    var p = document.createElement("p");
    p.id = "notice";
    p.style.margin = "0";
    p.textContent = text;
    b.appendChild(p);
  }

  function hostMessage() {
    return "Verifikasi gagal: domain \"" + host + "\" belum terdaftar. " +
      "Pemilik situs: tambahkan domain ini ke ALLOWED_HOSTS di anti-clone.js.";
  }

  // Mengembalikan "" jika lolos, atau alasan gagal.
  function verifyGate() {
    if (!hostAllowed()) return hostMessage();

    try {
      if (!script || !script.src || new URL(script.src, location.href).host !== location.host)
        return "Verifikasi gagal: anti-clone.js tidak dimuat dari domain ini.";
    } catch (e) { return "Verifikasi gagal: sumber skrip tidak valid."; }

    var body = document.body;
    var text = (body.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
    if (text !== NOTICE) return "Verifikasi gagal: isi index.html sudah diubah.";

    var scripts = document.scripts;
    if (scripts.length !== 1 || scripts[0] !== script) return "Verifikasi gagal: ada skrip tambahan di index.html.";

    var elems = Array.prototype.filter.call(body.querySelectorAll("*"), function (n) { return n.tagName !== "SCRIPT"; });
    if (elems.length !== 1 || elems[0].tagName !== "P" || elems[0].id !== "notice")
      return "Verifikasi gagal: struktur index.html sudah diubah.";

    if (document.querySelector("iframe,form,a,img,object,embed,link[rel~='stylesheet']"))
      return "Verifikasi gagal: ada elemen asing di index.html.";

    return "";
  }

  if (mode === "guard") {
    if (!hostAllowed()) {
      window.__W2A_BLOCKED__ = true;
      whenReady(function () { showMessage(hostMessage()); });
    }
    return;
  }

  whenReady(function () {
    var problem = verifyGate();
    if (problem) { showMessage(problem); return; }
    window.__ANTI_CLONE_OK__ = true;
    setTimeout(function () { location.replace(MAIN_SITE); }, 500);
  });
})();
