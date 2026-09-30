# NETORA WA Gateway (Self-Hosted)

Aplikasi Multi-Device WhatsApp Gateway berbasis [Baileys](https://github.com/WhiskeySockets/Baileys) dan Node.js Express. Aplikasi ini dirancang secara spesifik untuk integrasi dengan NETORA Billing, dilengkapi dengan Dashboard Control UI, sistem Auto Reinstall, dan fitur keamanan Basic Auth.

## 🚀 Fitur Utama
- **Multi-Device / Multi-Tenant**: Menjalankan puluhan nomor WA secara bersamaan dalam satu server.
- **Dashboard UI Premium**: Memonitor sesi secara real-time lewat browser.
- **Keamanan Ganda**: Dilindungi oleh HTTP Basic Auth yang kredensialnya tersimpan secara dinamis di `config.json`.
- **Auto-Resume**: Koneksi WhatsApp akan otomatis menyala kembali jika VPS / Server mengalami *restart*.
- **Panic Button**: Script `reset.sh` siap sedia (via SSH) jika Anda lupa password.
- **Hermes Webhook (AI CS Digital)**: Pesan masuk WA bisa diteruskan ke endpoint Hermes untuk diproses AI, lalu dibalas otomatis ke user.

## 🔧 Panduan Instalasi di Fresh Server (VPS)
Ikuti langkah-langkah di bawah ini untuk menginstal aplikasi di server VPS baru Anda (Direkomendasikan Ubuntu 22.04 / 24.04):

1. **Unduh (Clone) Repositori:**
   Buka terminal VPS Anda lalu ketik:
   ```bash
   git clone https://github.com/desienkz-slp/netora-wa.git
   cd netora-wa
   ```

2. **Jalankan Instalasi Otomatis:**
   Script ini akan menginstal Node.js, PM2, library aplikasi, sekaligus mendaftarkannya sebagai layanan *background* otomatis (*auto-start on reboot*):
   ```bash
   sudo bash install.sh
   ```

3. **Buka Dashboard UI:**
   Akses aplikasi lewat browser menggunakan IP Server Anda di Port 3000:
   👉 **`http://IP_VPS_ANDA:3000`**
   - **Username Default:** `superadmin`
   - **Password Default:** `admin123`
   *(Ubah segera di halaman Dashboard).*

## 📡 API Endpoint (Untuk Integrasi ke Laravel)
*(Seluruh API diproteksi menggunakan Basic Auth. Tambahkan Header `Authorization: Basic <base64(user:pass)>` saat memanggil dari Laravel).*

| Method | Endpoint | Parameter / Keterangan |
| :--- | :--- | :--- |
| `POST` | `/api/session/start` | Body: `{ "sessionId": "cabang_a" }` |
| `GET` | `/api/qr?sessionId=...` | Menampilkan QR Code (Base64) |
| `GET` | `/api/status?sessionId=...` | Mengecek status koneksi (Connected/Disconnected) |
| `POST` | `/api/send` | Body: `{ "sessionId": "cabang_a", "phone": "08xxx", "message": "Isi pesan" }` |
| `GET` | `/api/sessions` | Menampilkan semua device aktif |
| `POST` | `/api/settings/hermes-webhook` | Simpan pengaturan webhook Hermes (AI CS) |
| `GET` | `/api/settings/hermes-webhook` | Ambil pengaturan webhook Hermes |
| `POST` | `/api/settings/hermes-webhook/test` | Test koneksi ke endpoint Hermes |
| `GET` | `/api/settings/hermes-webhook/logs?limit=25` | Ambil log webhook terbaru |

### Contoh Payload Webhook Hermes
Saat ada pesan masuk, server akan kirim `POST` JSON ke URL webhook Hermes:

```json
{
  "event": "incoming_message",
  "source": "netora-wa",
  "sessionId": "cabang_a",
  "fromMe": false,
  "remoteJid": "62812xxxx@s.whatsapp.net",
  "senderJid": "62812xxxx@s.whatsapp.net",
  "pushName": "Budi",
  "text": "Halo, saya mau tanya paket internet",
  "messageId": "BAE5...",
  "timestamp": 1727671001
}
```

Jika endpoint Hermes mengembalikan JSON berikut, gateway akan auto-reply ke user (jika `autoReply=true`):

```json
{ "reply": "Halo Kak, siap dibantu. Mau paket area mana?" }
```

---
**Developer:** upluk-upluk_dev
