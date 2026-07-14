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

echo "[1/4] Memperbarui Repository OS..."
apt-get update -y

echo "[2/4] Instalasi Node.js (versi 20 LTS)..."
# Setup repo nodejs
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

echo "[3/4] Instalasi PM2 (Process Manager)..."
npm install -g pm2

echo "[4/4] Instalasi Dependencies Aplikasi..."
npm install

echo ""
echo "============================================"
echo " Instalasi Selesai! 🎉"
echo "============================================"
echo "Cara menjalankan aplikasi:"
echo "1. Ketik: node index.js (Untuk scan QR code pertama kali)"
echo "2. Jika sudah sukses terhubung, stop dengan CTRL+C"
echo "3. Ketik: pm2 start index.js --name netora-wa"
echo "4. Ketik: pm2 save (agar auto-start saat VPS restart)"
echo "============================================"
