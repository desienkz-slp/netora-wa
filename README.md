# NETORA WA Gateway (Self-Hosted)

Aplikasi **Multi-Device WhatsApp Gateway** berbasis [Baileys](https://github.com/WhiskeySockets/Baileys) + Node.js Express, dirancang untuk integrasi billing/CRM/automation, termasuk dukungan **Hermes Webhook** untuk CS Digital berbasis AI.

---

## 🚀 Fitur Lengkap

### Core Gateway
- **Multi-Device / Multi-Tenant**: Banyak nomor WA aktif dalam 1 server.
- **Auto Resume Session**: Sesi tetap dipulihkan saat server restart.
- **Send Personal & Group**: Kirim pesan ke nomor personal atau group `@g.us`.
- **Session Control**: Start, QR scan, reconnect, logout, delete session.

### Dashboard
- **Dashboard UI**: Monitoring status semua device real-time.
- **Create Device + QR Modal**: Provisioning nomor baru cepat.
- **Tester kirim pesan**: Uji kirim dari UI (nomor / group).
- **Search + Pagination**: Manajemen device skala besar lebih mudah.
- **Footer Versioning**: Menampilkan **versi aplikasi + commit git + branch**.

### Hermes AI CS
- **Incoming Message Forwarding** ke endpoint Hermes.
- **Auto Reply** dari response webhook (`reply`/`message`).
- **Retry + Timeout** untuk ketahanan jaringan.
- **Webhook Logs** untuk audit/troubleshooting.
- **Command Mode** (opsional): Hermes bisa kirim command `send` / `broadcast`.
- **Hardening Command**:
  - rate-limit command per menit,
  - opsi disable broadcast command.

### Security & Hardening
- **Basic Auth** untuk semua endpoint API sensitif.
- **Webhook Signature (HMAC SHA256)** opsional.
- **Allowlist IP** untuk endpoint test webhook.
- **Config Driven** (`config.json`) agar semua setting tersentral.

### Update System (GitHub as Source of Truth)
- **GitHub sebagai control version tunggal**.
- **In-App Update**: cek update & trigger update dari dashboard.
- **Server Auto Update Service** (systemd timer) untuk sync berkala dari GitHub.

---

## 🧱 Arsitektur Version Control

- Repository utama: `https://github.com/desienkz-slp/netora-wa.git`
- Branch produksi default: `main`
- Server **wajib pull dari GitHub** (tidak direct edit di server produksi).
- Update app:
  1. perubahan di lokal,
  2. commit + push ke GitHub,
  3. server tarik update via pull (manual/in-app/auto-update service).

---

## 🔧 Fresh Install (Production Ready)

> Rekomendasi OS: Ubuntu 22.04 / 24.04

### 1) Clone repo
```bash
git clone https://github.com/desienkz-slp/netora-wa.git
cd netora-wa
```

### 2) Jalankan installer
```bash
sudo bash install.sh
```

Script install akan otomatis:
1. install dependency sistem (curl/git/ca-certificates),
2. install Node.js 20 LTS,
3. install PM2,
4. set Git remote + checkout branch `main` dari GitHub,
5. install npm dependencies,
6. normalisasi `config.json` agar support fitur baru,
7. start PM2 (`netora-wa`) + save startup,
8. pasang **auto-update system service**:
   - `/usr/local/bin/netora-wa-autoupdate.sh`
   - `netora-wa-autoupdate.service`
   - `netora-wa-autoupdate.timer` (tiap 5 menit)

### 3) Buka dashboard
```text
http://IP_SERVER:3000
```
Default login:
- Username: `superadmin`
- Password: `admin123`

> **Wajib ganti login default setelah pertama kali install.**

---

## ⚙️ Konfigurasi Penting (`config.json`)

Contoh struktur terbaru:

```json
{
  "username": "superadmin",
  "password": "admin123",
  "hermesWebhook": {
    "enabled": false,
    "url": "",
    "authToken": "",
    "signatureSecret": "",
    "allowedIps": [],
    "timeoutMs": 10000,
    "retryCount": 2,
    "retryDelayMs": 1200,
    "rateLimitPerMinute": 20,
    "sendIncoming": true,
    "sendFromMe": false,
    "autoReply": true,
    "allowCommands": true,
    "commandAllowBroadcast": false
  },
  "autoUpdate": {
    "enabled": true,
    "branch": "main"
  }
}
```

---

## 📡 API Endpoint Ringkas

| Method | Endpoint | Keterangan |
|---|---|---|
| POST | `/api/session/start` | Start session baru |
| GET | `/api/qr?sessionId=...` | Ambil QR string |
| GET | `/api/status?sessionId=...` | Cek status session |
| POST | `/api/send` | Kirim pesan |
| GET | `/api/groups?sessionId=...` | Ambil daftar group |
| GET | `/api/sessions` | List semua session |
| POST | `/api/session/reconnect` | Reconnect session |
| POST | `/api/session/logout` | Logout WA session |
| POST | `/api/session/delete` | Hapus session |
| POST | `/api/settings/auth` | Ganti login dashboard |
| GET | `/api/settings/hermes-webhook` | Get konfigurasi webhook |
| POST | `/api/settings/hermes-webhook` | Save konfigurasi webhook |
| POST | `/api/settings/hermes-webhook/test` | Uji koneksi webhook |
| GET | `/api/settings/hermes-webhook/logs?limit=25` | Ambil log webhook |
| GET | `/api/system/check-update` | Cek update dari GitHub |
| POST | `/api/system/trigger-update` | Trigger update + restart |
| GET | `/api/system/version` | Ambil versi + commit + branch |

---

## 🤖 Format Payload Hermes Webhook

### Payload dari NETORA ke Hermes
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

### Balasan auto-reply dari Hermes
```json
{ "reply": "Halo Kak, siap dibantu. Mau paket area mana?" }
```

### Command mode (opsional)
```json
{
  "reply": "Baik kak, kami proses",
  "command": {
    "action": "send",
    "to": "08123456789",
    "message": "Halo, ini follow up dari CS"
  }
}
```

---

## 🔁 Auto Update System (Server)

Cek timer:
```bash
systemctl status netora-wa-autoupdate.timer
systemctl list-timers | grep netora-wa
```

Jalankan manual auto-updater:
```bash
sudo /usr/local/bin/netora-wa-autoupdate.sh
```

Lihat log:
```bash
journalctl -u netora-wa-autoupdate.service -n 100 --no-pager
```

---

## 🛡️ Hardening Checklist Production

- [ ] Ganti username/password default dashboard.
- [ ] Isi `hermesWebhook.authToken`.
- [ ] Aktifkan `signatureSecret` (HMAC) jika Hermes support.
- [ ] Isi `allowedIps` jika endpoint test dibatasi IP tertentu.
- [ ] Set `commandAllowBroadcast=false` jika tidak dibutuhkan.
- [ ] Aktifkan HTTPS + reverse proxy (Nginx/Traefik).
- [ ] Backup rutin file `config.json` + folder `sessions/`.

---

**Developer:** upluk-upluk_dev
