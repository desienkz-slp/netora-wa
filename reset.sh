#!/bin/bash
echo "=========================================="
echo " AUTO REINSTALL & RESET (PANIC BUTTON)"
echo " Developer: upluk-upluk_dev"
echo "=========================================="
echo "Peringatan: Aksi ini akan melogout semua WA"
echo "dan mereset password ke bawaan pabrik!"
echo "Tekan ENTER untuk lanjut, atau CTRL+C untuk batal."
read -p ""

# Pindah ke direktori script
cd "$(dirname "$0")" || exit

echo "[1/3] Menghapus semua sesi perangkat..."
rm -rf sessions/*

echo "[2/3] Mereset kredensial login (config.json)..."
cat <<EOF > config.json
{
  "username": "admin",
  "password": "password123"
}
EOF

echo "[3/3] Me-restart layanan Node.js (PM2)..."
pm2 restart netora-wa || echo "INFO: PM2 netora-wa belum jalan, silakan start manual (pm2 start index.js --name netora-wa)."

echo ""
echo "=========================================="
echo " ✅ SISTEM BERHASIL DI-RESET!"
echo " Username default : admin"
echo " Password default : password123"
echo "=========================================="
