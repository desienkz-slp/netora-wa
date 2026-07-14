#!/bin/bash
echo "============================================"
echo "   Auto-Install NETORA WA Gateway"
echo "   Developer: upluk-upluk_dev"
echo "============================================"

# Cek apakah dijalankan sebagai root (disarankan)
if [ "$EUID" -ne 0 ]; then 
  echo "Tolong jalankan script ini menggunakan sudo atau sebagai root."
  echo "Contoh: sudo bash install.sh"
  exit
fi

# Pindah ke direktori tempat script ini berada agar support dieksekusi dari mana saja
cd "$(dirname "$0")" || exit

echo "[1/5] Memperbarui Repository OS..."
apt-get update -y
apt-get install -y curl

echo "[2/5] Instalasi Node.js (versi 20 LTS)..."
# Setup repo nodejs
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

echo "[3/5] Instalasi PM2 (Process Manager)..."
npm install -g pm2

echo "[4/5] Instalasi Dependencies Aplikasi..."
npm install

echo "[5/5] Mengatur Auto-Start (PM2)..."
pm2 start index.js --name "netora-wa"
env PATH=$PATH:/usr/bin pm2 startup systemd -u root --hp /root
pm2 save

echo ""
echo "============================================"
echo " Instalasi Selesai & Berjalan! 🎉"
echo "============================================"
echo "NETORA WA Gateway sudah aktif di background."
echo "Aplikasi akan otomatis berjalan jika server restart."
echo ""
echo "Akses Dashboard melalui browser Anda di:"
echo "http://[IP-Server]:3000"
echo "============================================"
