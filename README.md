# Web2APK (Vercel + GitHub Actions)

Website gratis untuk mengubah link / HTML / ZIP menjadi APK. Setiap pesanan membuat
satu repo baru bernama acak dari template, lalu GitHub Actions membangun APK-nya.

## Struktur

```
web2apk-vercel/
├─ index.html          gerbang anti-clone (hanya teks di tengah)
├─ anti-clone.js       verifikasi untuk index.html
├─ web2apk-site/       website utama (index.html, style.css, app.js)
├─ api/                backend serverless Vercel (wajib di root, aturan Vercel)
├─ vercel.json
└─ package.json
```

## Deploy

1. Upload folder ini ke repo GitHub (boleh private), lalu **Import** di Vercel.
   Framework preset: **Other**. Build command dan output directory dibiarkan kosong.
2. Di Vercel: **Settings > Environment Variables**, isi:

   | Nama | Isi |
   |---|---|
   | `GITHUB_USERNAME` | `nugroho20122012yr-art` |
   | `GITHUB_TOKEN` | Personal Access Token (classic) dengan scope `repo` |
   | `APP_SECRET` | (opsional) teks acak panjang untuk menandatangani sesi |

   Buat token di https://github.com/settings/tokens (classic). Pakai akun GitHub khusus
   untuk layanan ini, karena scope `repo` memberi akses ke semua repo akun tersebut.
   Variabel hanya dibaca di folder `api/` dan tidak pernah dikirim ke browser.
3. Buka `anti-clone.js`, isi `ALLOWED_HOSTS` dengan domain Vercel kamu
   (contoh `"web2apk-kamu.vercel.app"`), commit, lalu deploy ulang.
   Kalau belum diisi, halaman akan menampilkan domain yang perlu ditambahkan.
4. Pastikan repo template tetap berstatus **Template repository** dan workflow-nya
   bernama `build-apk.yml`.

## Alur

`start` buat repo acak dari template -> `upload` kirim ikon dan file www -> `finish`
commit config lalu jalankan workflow -> `status` dipantau browser sampai ada tautan APK.

## Batas

- Nama repo acak memakai `A-Z a-z 0-9 _ -`, panjang 10 sampai 80 (GitHub tidak mengizinkan `@` dan `#`).
- Per file maksimal 3 MB, total ZIP 25 MB, maksimal 300 file.
- Pembatas laju: 4 pesanan per IP per 15 menit (best-effort, per instance serverless).
- Repo hasil build tidak dihapus otomatis. Bersihkan berkala dari akun GitHub.
