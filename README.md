# MailVault Portal (Tanpa Firebase)

Aplikasi web modern dan ringan untuk **Email Generator, Private Inbox, Manajemen Tanggal Siap Pakai, Marketplace Buy/Sell Email, dan Chat**, terhubung langsung ke **Google Apps Script API** yang sudah kamu miliki tanpa memerlukan Firebase.

## Struktur Folder (1 Folder Utama)

- `index.html` — Struktur halaman lengkap (Login/Register, Home, My Email, Buy/Sell, Chat, Akun).
- `styles.css` — Desain responsif dark-glass modern yang ringan dan optimal di iOS Safari, Android, Windows, dan macOS.
- `app.js` — Logika koneksi langsung ke `GAS_API_URL`, manajemen kepemilikan email, sensor otomatis etalase toko, dan sistem chat.
- `logo.svg` — Logo resmi & ikon aplikasi MailVault.
- `hero-visual.png` — Ilustrasi visual utama pada halaman Home.
- `empty-state.svg` — Ilustrasi tampilan kosong pada Inbox dan Chat.
- `channel-banner.svg` — Banner grafis untuk kartu Saluran WhatsApp Admin.
- `vercel.json` — Konfigurasi header keamanan & routing statis untuk Vercel.

## Cara Deploy ke GitHub & Vercel

1. Upload seluruh isi folder `mailvault-portal` ke repository GitHub baru.
2. Buka **Vercel** -> **Add New Project** -> pilih repository tersebut.
3. Biarkan pengaturan *Framework Preset* di **Other** dan *Build Command* kosong, lalu klik **Deploy**.
4. Kamu juga bisa langsung membuka `index.html` di browser untuk pengujian lokal.
