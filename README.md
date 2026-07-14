# NETORA WA Gateway (Self-Hosted)

Aplikasi Multi-Device WhatsApp Gateway berbasis [Baileys](https://github.com/WhiskeySockets/Baileys) dan Node.js Express. Aplikasi ini dirancang secara spesifik untuk integrasi dengan NETORA Billing, dilengkapi dengan Dashboard Control UI, sistem Auto Reinstall, dan fitur keamanan Basic Auth.

## 🚀 Fitur Utama
- **Multi-Device / Multi-Tenant**: Menjalankan puluhan nomor WA secara bersamaan dalam satu server.
- **Dashboard UI Premium**: Memonitor sesi secara real-time lewat browser.
- **Keamanan Ganda**: Dilindungi oleh HTTP Basic Auth yang kredensialnya tersimpan secara dinamis di `config.json`.
- **Auto-Resume**: Koneksi WhatsApp akan otomatis menyala kembali jika VPS / Server mengalami *restart*.
- **Panic Button**: Script `reset.sh` siap sedia (via SSH) jika Anda lupa password.

## 🔧 Panduan Instalasi di Fresh Server (VPS)
1. Clone repositori ini di dalam VPS Anda:
   ```bash
   git clone <URL_REPO_GITHUB_ANDA>
   ```
2. Masuk ke direktori aplikasi:
   ```bash
   cd netora-wa
   ```
3. Jalankan script instalasi otomatis (membutuhkan akses root/sudo):
   ```bash
   sudo bash install.sh
   ```

## 💻 Penggunaan (Lokal/Manual)
1. Instal dependensi: `npm install`
2. Jalankan aplikasi: `node index.js` atau `npm start`
3. Buka browser: `http://localhost:3000` 
   *(Secara default, kredensial login adalah `admin` / `password123`. Harap ubah melalui Dashboard UI).*

## 📡 API Endpoint (Untuk Integrasi ke Laravel)

Seluruh API diproteksi menggunakan **Basic Auth**. Anda wajib menambahkan Header `Authorization: Basic <base64(user:pass)>` di Guzzle/cURL setiap kali memanggil API ini dari aplikasi Laravel NETORA Billing.

| Method | Endpoint | Keterangan |
| :--- | :--- | :--- |
| `POST` | `/api/session/start` | Menginisialisasi koneksi Device baru. Parameter Body: `{ "sessionId": "cabang_a" }` |
| `GET` | `/api/qr?sessionId=...` | Mengambil QR Code mentah/base64 dari device tertentu. |
| `GET` | `/api/status?sessionId=...` | Mengecek status koneksi (`Connected` / `Disconnected`). |
| `POST` | `/api/send` | Mengirim pesan. Body: `{ "sessionId": "cabang_a", "phone": "08...", "message": "Isi pesan" }` |
| `GET` | `/api/sessions` | Menampilkan seluruh sesi aktif. |

---
**Developer:** upluk-upluk_dev
