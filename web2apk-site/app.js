(function () {
  "use strict";
  if (window.__W2A_BLOCKED__) return;      // diblokir anti-clone.js (domain tidak terdaftar)

  var API = "/api/";
  var KEY = "w2a_job";
  var LIMIT_FILE = 3 * 1024 * 1024;
  var LIMIT_TOTAL = 25 * 1024 * 1024;
  var LIMIT_B64_BATCH = 3300000;           // karakter base64 per permintaan upload (batas Vercel 4,5 MB)
  var LIMIT_FILES_BATCH = 40;
  var LIMIT_FILES = 300;
  var JAVA_KW = ("abstract assert boolean break byte case catch char class const continue default do double else enum " +
    "extends final finally float for goto if implements import instanceof int interface long native new package private " +
    "protected public return short static strictfp super switch synchronized this throw throws transient try void " +
    "volatile while").split(" ");

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var source = "url";
  var iconB64 = null;
  var zipPick = null;                      // { entries: [{ file, rel }] }
  var polling = false;

  // ------------------------------------------------------------------ util
  function b64(u8) {
    var s = "", CH = 0x8000;
    for (var i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return btoa(s);
  }
  function slug(name) {
    var s = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "").slice(0, 20);
    return s || "app";
  }
  function randTail() {
    var a = new Uint8Array(4), out = "", ch = "abcdefghijklmnopqrstuvwxyz0123456789";
    crypto.getRandomValues(a);
    for (var i = 0; i < a.length; i++) out += ch[a[i] % ch.length];
    return out;
  }
  function showError(msg) { var e = $("#formError"); e.textContent = msg; e.hidden = false; e.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
  function clearError() { $("#formError").hidden = true; }

  // ------------------------------------------------------------------ nama -> package name
  var pkgTouched = false;
  $("#pkg").addEventListener("input", function () { pkgTouched = true; });
  $("#appName").addEventListener("input", function () {
    if (pkgTouched) return;
    var s = slug(this.value);
    if (/^[0-9]/.test(s)) s = "a" + s;
    $("#pkg").value = this.value.trim() ? "com.web2apk." + s + (this._tail || (this._tail = randTail())) : "";
  });

  // ------------------------------------------------------------------ ikon
  $("#icon").addEventListener("change", function () {
    var f = this.files[0];
    iconB64 = null;
    $("#iconPreview").hidden = true; $("#iconEmpty").hidden = false;
    if (!f) return;
    if (f.size > 8 * 1024 * 1024) { showError("Gambar ikon terlalu besar (maks 8 MB)."); this.value = ""; return; }
    var img = new Image(), url = URL.createObjectURL(f);
    img.onload = function () {
      var c = document.createElement("canvas"); c.width = c.height = 512;
      var s = Math.min(img.width, img.height);
      c.getContext("2d").drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 512, 512);
      URL.revokeObjectURL(url);
      var data = c.toDataURL("image/png");
      iconB64 = data.split(",")[1];
      $("#iconPreview").src = data; $("#iconPreview").hidden = false; $("#iconEmpty").hidden = true;
      clearError();
    };
    img.onerror = function () { URL.revokeObjectURL(url); showError("Gambar ikon tidak bisa dibaca. Coba file PNG atau JPG lain."); };
    img.src = url;
  });

  // ------------------------------------------------------------------ tab sumber
  $$(".tab").forEach(function (btn) {
    btn.addEventListener("click", function () {
      source = btn.getAttribute("data-source");
      $$(".tab").forEach(function (b) { var on = b === btn; b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1; });
      $$(".panel").forEach(function (p) { p.hidden = p.id !== "panel-" + source; });
      clearError();
    });
  });

  $("#htmlFile").addEventListener("change", function () {
    var f = this.files[0];
    if (!f) return;
    if (f.size > 3 * 1024 * 1024) { showError("File HTML lebih dari 3 MB. Pakai ZIP kalau isinya besar."); this.value = ""; return; }
    var r = new FileReader();
    r.onload = function () { $("#htmlCode").value = String(r.result); };
    r.readAsText(f);
  });

  // ------------------------------------------------------------------ ZIP
  $("#zipFile").addEventListener("change", async function () {
    var info = $("#zipInfo"), f = this.files[0];
    zipPick = null; info.hidden = true;
    if (!f) return;
    try {
      if (!window.JSZip) throw new Error("Pustaka ZIP belum termuat. Periksa koneksi lalu muat ulang halaman.");
      var zip = await JSZip.loadAsync(f);
      var list = [];
      zip.forEach(function (path, file) {
        if (file.dir) return;
        var base = path.split("/").pop();
        if (/^__MACOSX\//.test(path) || base === ".DS_Store" || base.indexOf("._") === 0) return;
        list.push({ path: path, file: file });
      });
      var idx = list.filter(function (e) { return /(^|\/)index\.html$/i.test(e.path); })
        .sort(function (a, b) { return a.path.split("/").length - b.path.split("/").length; })[0];
      if (!idx) throw new Error("index.html tidak ditemukan di dalam ZIP. Tambahkan index.html lalu pilih ulang.");
      var prefix = idx.path.slice(0, idx.path.length - "index.html".length);
      var entries = list.filter(function (e) { return e.path.indexOf(prefix) === 0; })
        .map(function (e) { return { file: e.file, rel: e === idx ? "index.html" : e.path.slice(prefix.length) }; });
      if (entries.length > LIMIT_FILES) throw new Error("ZIP berisi " + entries.length + " file. Maksimal " + LIMIT_FILES + ".");
      zipPick = { entries: entries };
      info.textContent = entries.length + " file ditemukan. Halaman utama: " + (prefix ? prefix : "") + "index.html";
      info.hidden = false; clearError();
    } catch (e) {
      this.value = "";
      showError(e.message || "ZIP tidak bisa dibaca. Pastikan file ZIP valid.");
    }
  });

  async function zipFiles() {
    if (!zipPick) throw new Error("Pilih file ZIP dulu.");
    var out = [], total = 0;
    for (var i = 0; i < zipPick.entries.length; i++) {
      var e = zipPick.entries[i];
      var u8 = await e.file.async("uint8array");
      if (u8.length > LIMIT_FILE) throw new Error("File \"" + e.rel + "\" lebih dari 3 MB. Kecilkan atau keluarkan dari ZIP.");
      total += u8.length;
      if (total > LIMIT_TOTAL) throw new Error("Isi ZIP lebih dari 25 MB. Kecilkan ukurannya.");
      out.push({ path: "www/" + e.rel, b64: b64(u8) });
    }
    return out;
  }

  // ------------------------------------------------------------------ validasi form
  function collectMeta() {
    var m = {
      appName: $("#appName").value.trim(),
      packageName: $("#pkg").value.trim(),
      orientation: ($("input[name=orientation]:checked") || {}).value || "auto",
      permissions: $$("input[name=perm]:checked").map(function (i) { return i.value; }),
      source: source
    };
    if (source === "url") m.url = $("#siteUrl").value.trim();
    return m;
  }
  function checkMeta(m) {
    if (!m.appName) return "Isi nama aplikasi.";
    if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(m.packageName) ||
        m.packageName.split(".").some(function (p) { return JAVA_KW.indexOf(p) >= 0; }))
      return "Package name tidak valid. Pakai huruf kecil dan titik, contoh: com.toko.saya";
    if (source === "url") {
      try { var u = new URL(m.url); if (u.protocol !== "https:") throw 0; }
      catch (e) { return "Alamat website harus diawali https:// dan valid."; }
    }
    if (source === "html" && !$("#htmlCode").value.trim()) return "Tempel kode HTML atau pilih file .html.";
    if (source === "zip" && !zipPick) return "Pilih file ZIP yang berisi index.html.";
    return "";
  }

  // ------------------------------------------------------------------ API
  async function api(name, payload) {
    var res, data = null;
    try {
      res = await fetch(API + name, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    } catch (e) { throw new Error("Tidak bisa terhubung ke server. Periksa koneksi internet lalu coba lagi."); }
    try { data = await res.json(); } catch (e) { /* bukan JSON */ }
    if (!res.ok) {
      if (res.status === 413) throw new Error("Data terlalu besar untuk dikirim. Kecilkan file lalu coba lagi.");
      throw new Error((data && data.error) || "Terjadi kesalahan (" + res.status + "). Coba lagi.");
    }
    return data;
  }

  // ------------------------------------------------------------------ tampilan hasil
  var STAGE = {
    waiting: "Menunggu GitHub memulai build...",
    queued: "Antre di GitHub...",
    building: "Build berjalan. Biasanya butuh beberapa menit.",
    finalizing: "Hampir selesai, menyiapkan file APK...",
    done: "APK siap diunduh.",
    failed: "Build gagal. Buka log di GitHub untuk melihat sebabnya."
  };
  function setStatus(t) { $("#statusText").textContent = t; }
  function showRepo(job) {
    $("#repoName").textContent = job.repo;
    var a = $("#repoLink"); a.href = "https://github.com/" + job.owner + "/" + job.repo; a.hidden = false;
    $("#copyRepo").hidden = false;
  }
  function renderSteps(steps) {
    var ul = $("#steps");
    while (ul.firstChild) ul.removeChild(ul.firstChild);
    (steps || []).forEach(function (s) {
      var li = document.createElement("li");
      var cls = s.status === "completed" ? (s.conclusion === "success" || s.conclusion === "skipped" ? "ok" : "bad") : (s.status === "in_progress" ? "run" : "");
      if (cls) li.className = cls;
      var dot = document.createElement("span"); dot.className = "dot";
      var name = document.createElement("span"); name.textContent = s.name;
      li.appendChild(dot); li.appendChild(name); ul.appendChild(li);
    });
  }
  function revealResult() { var r = $("#result"); r.hidden = false; r.scrollIntoView({ behavior: "smooth", block: "start" }); }

  $("#copyRepo").addEventListener("click", function () {
    var text = $("#repoName").textContent, btn = this;
    function ok() { btn.textContent = "Tersalin"; setTimeout(function () { btn.textContent = "Salin nama repo"; }, 1800); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, function () {});
    else { var r = document.createRange(); r.selectNodeContents($("#repoName")); var s = getSelection(); s.removeAllRanges(); s.addRange(r); ok(); }
  });

  // ------------------------------------------------------------------ pemantauan build
  function saveJob(job) { try { localStorage.setItem(KEY, JSON.stringify(job)); } catch (e) {} }
  function clearJob() { try { localStorage.removeItem(KEY); } catch (e) {} }

  function poll(job) {
    if (polling) return;
    polling = true;
    var tries = 0;
    (async function tick() {
      tries++;
      var finished = false;
      try {
        var r = await fetch(API + "status?repo=" + encodeURIComponent(job.repo) + "&build=" + encodeURIComponent(job.build));
        var d = await r.json();
        if (r.ok) {
          setStatus(STAGE[d.stage] || STAGE.waiting);
          renderSteps(d.steps);
          if (d.runUrl) { var a = $("#repoLink"); a.textContent = "Lihat proses di GitHub"; a.href = d.runUrl; }
          if (d.stage === "done" && d.download) {
            $("#resultTitle").textContent = "APK kamu sudah jadi";
            $("#downloadBtn").href = d.download; $("#downloadBox").hidden = false;
            finished = true;
          } else if (d.stage === "failed") {
            $("#resultTitle").textContent = "Build gagal";
            finished = true;
          }
        }
      } catch (e) { /* jaringan putus sebentar: coba lagi */ }
      if (finished) { clearJob(); polling = false; return; }
      if (tries < 180) setTimeout(tick, 8000);
      else { setStatus("Pemantauan berhenti. Buka tab Releases di repo untuk melihat hasilnya."); polling = false; }
    })();
  }

  // ------------------------------------------------------------------ kirim
  function batches(files) {
    var out = [], cur = [], size = 0;
    files.forEach(function (f) {
      if (cur.length && (size + f.b64.length > LIMIT_B64_BATCH || cur.length >= LIMIT_FILES_BATCH)) { out.push(cur); cur = []; size = 0; }
      cur.push(f); size += f.b64.length;
    });
    if (cur.length) out.push(cur);
    return out;
  }

  $("#builder").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    clearError();
    var meta = collectMeta(), err = checkMeta(meta);
    if (err) return showError(err);

    var btn = $("#submitBtn");
    btn.disabled = true; btn.textContent = "Memproses...";
    try {
      var files = [];
      if (iconB64) files.push({ path: "config/icon.png", b64: iconB64 });
      if (source === "html") files.push({ path: "www/index.html", b64: b64(new TextEncoder().encode($("#htmlCode").value)) });
      if (source === "zip") files = files.concat(await zipFiles());

      // reset tampilan hasil
      $("#resultTitle").textContent = "Tunggu, APK sedang dibuat";
      $("#repoName").textContent = "Menyiapkan repo..."; $("#repoLink").hidden = true; $("#copyRepo").hidden = true;
      $("#downloadBox").hidden = true; renderSteps([]); setStatus("Menyiapkan repo di GitHub...");
      revealResult();

      var job = await api("start", { meta: meta });
      showRepo(job); saveJob(job);

      var blobs = [], groups = batches(files), done = 0;
      for (var i = 0; i < groups.length; i++) {
        setStatus("Mengunggah file " + Math.min(done + groups[i].length, files.length) + " dari " + files.length + "...");
        var up = await api("upload", { repo: job.repo, build: job.build, sig: job.sig, files: groups[i] });
        blobs = blobs.concat(up.blobs); done += groups[i].length;
      }
      setStatus("Menyimpan konfigurasi dan memulai build...");
      await api("finish", { repo: job.repo, build: job.build, sig: job.sig, meta: meta, blobs: blobs });

      setStatus(STAGE.waiting);
      poll(job);
    } catch (e) {
      showError(e.message || "Terjadi kesalahan. Coba lagi.");
      $("#resultTitle").textContent = "Pembuatan terhenti";
      setStatus("Gagal. Perbaiki yang diminta di form lalu tekan tombol buat lagi.");
    } finally {
      btn.disabled = false; btn.textContent = "Buat APK sekarang";
    }
  });

  // ------------------------------------------------------------------ lanjutkan pemantauan setelah halaman dimuat ulang
  try {
    var saved = JSON.parse(localStorage.getItem(KEY) || "null");
    if (saved && saved.repo && saved.build && saved.owner && /^[A-Za-z0-9_-]+$/.test(saved.repo) && /^[a-f0-9]{12}$/.test(saved.build)) {
      $("#result").hidden = false;
      showRepo(saved);
      $("#resultTitle").textContent = "Tunggu, APK sedang dibuat";
      setStatus("Melanjutkan pemantauan build...");
      poll(saved);
    }
  } catch (e) { /* abaikan */ }
})();
