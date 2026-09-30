#!/bin/bash
set -e

echo "============================================"
echo "   Auto-Install NETORA WA Gateway"
echo "   Developer: upluk-upluk_dev"
echo "============================================"

if [ "$EUID" -ne 0 ]; then 
  echo "Tolong jalankan script ini menggunakan sudo atau sebagai root."
  echo "Contoh: sudo bash install.sh"
  exit 1
fi

# Variabel global
APP_NAME="netora-wa"
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_URL="https://github.com/desienkz-slp/netora-wa.git"
BRANCH="main"
AUTO_UPDATE_SCRIPT="/usr/local/bin/netora-wa-autoupdate.sh"
SYSTEMD_SERVICE="/etc/systemd/system/netora-wa-autoupdate.service"
SYSTEMD_TIMER="/etc/systemd/system/netora-wa-autoupdate.timer"

cd "$APP_DIR" || exit 1

echo "[1/8] Memperbarui repository OS & paket dasar..."
apt-get update -y
apt-get install -y curl git ca-certificates

echo "[2/8] Instalasi Node.js (versi 20 LTS)..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

echo "[3/8] Instalasi PM2 (Process Manager)..."
npm install -g pm2

echo "[4/8] Inisialisasi Git (GitHub sebagai source of truth)..."
git config --global credential.helper store
if [ ! -d ".git" ]; then
  git init
  git remote add origin "$REPO_URL"
fi

# Pastikan origin sesuai repo utama
if git remote get-url origin >/dev/null 2>&1; then
  CURRENT_REMOTE="$(git remote get-url origin)"
  if [ "$CURRENT_REMOTE" != "$REPO_URL" ]; then
    git remote set-url origin "$REPO_URL"
  fi
fi

git fetch origin

git checkout -B "$BRANCH" "origin/$BRANCH"
git reset --hard "origin/$BRANCH"

echo "[5/8] Instalasi dependencies aplikasi..."
npm install

echo "[6/8] Menulis konfigurasi default autoUpdate jika belum ada..."
if [ -f "config.json" ]; then
  if ! grep -q '"autoUpdate"' config.json; then
    cp config.json "config.json.bak.$(date +%Y%m%d-%H%M%S)"
    node - <<'NODE'
const fs = require('fs');
const p = 'config.json';
const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
if (!cfg.autoUpdate) cfg.autoUpdate = { enabled: true, branch: 'main' };
if (!cfg.hermesWebhook) cfg.hermesWebhook = {};
if (cfg.hermesWebhook.commandAllowBroadcast === undefined) cfg.hermesWebhook.commandAllowBroadcast = false;
if (cfg.hermesWebhook.rateLimitPerMinute === undefined) cfg.hermesWebhook.rateLimitPerMinute = 20;
if (cfg.hermesWebhook.signatureSecret === undefined) cfg.hermesWebhook.signatureSecret = '';
if (cfg.hermesWebhook.allowedIps === undefined) cfg.hermesWebhook.allowedIps = [];
fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
NODE
  fi
fi

echo "[7/8] Menjalankan aplikasi dengan PM2..."
pm2 describe "$APP_NAME" >/dev/null 2>&1 && pm2 delete "$APP_NAME" || true
pm2 start index.js --name "$APP_NAME"
pm2 startup systemd -u root --hp /root || true
pm2 save

echo "[8/8] Mengaktifkan auto-update system (Git pull + npm install + PM2 restart)..."
cat > "$AUTO_UPDATE_SCRIPT" <<EOF
#!/bin/bash
set -e
APP_DIR="$APP_DIR"
APP_NAME="$APP_NAME"
BRANCH="$BRANCH"

if [ ! -d "$APP_DIR" ]; then
  echo "[$(date)] APP_DIR tidak ditemukan: $APP_DIR"
  exit 1
fi

cd "$APP_DIR"

# Cek update dari GitHub
if ! git fetch origin "$BRANCH" >/dev/null 2>&1; then
  echo "[$(date)] Gagal fetch origin/$BRANCH"
  exit 1
fi

LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse "origin/$BRANCH")"

if [ "$LOCAL" != "$REMOTE" ]; then
  echo "[$(date)] Update ditemukan. Pulling..."
  git reset --hard "origin/$BRANCH"
  npm install --omit=dev
  pm2 restart "$APP_NAME"
  pm2 save
  echo "[$(date)] Update selesai."
else
  echo "[$(date)] Tidak ada update."
fi
EOF
chmod +x "$AUTO_UPDATE_SCRIPT"

cat > "$SYSTEMD_SERVICE" <<EOF
[Unit]
Description=NETORA WA Auto Update Service
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=$AUTO_UPDATE_SCRIPT
WorkingDirectory=$APP_DIR
EOF

cat > "$SYSTEMD_TIMER" <<'EOF'
[Unit]
Description=Run NETORA WA Auto Update every 5 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
Unit=netora-wa-autoupdate.service
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now netora-wa-autoupdate.timer

echo ""
echo "============================================"
echo " Instalasi Selesai & Berjalan! 🎉"
echo "============================================"
echo "Dashboard: http://[IP-Server]:3000"
echo "PM2 Process: $APP_NAME"
echo "AutoUpdate Timer: netora-wa-autoupdate.timer (setiap 5 menit)"
echo "GitHub branch source: $BRANCH"
echo "============================================"
