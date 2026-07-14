const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const configFile = path.join(__dirname, 'config.json');
const sessionsDir = path.join(__dirname, 'sessions');

console.log("Memulai proses Factory Reset NETORA WA Gateway...");

try {
    // 1. Reset config.json
    const defaultData = {
        username: "superadmin",
        password: "admin123"
    };
    fs.writeFileSync(configFile, JSON.stringify(defaultData, null, 4));
    console.log("✔️ Kredensial login dikembalikan ke default.");

    // 2. Hapus semua data sesi WhatsApp
    if (fs.existsSync(sessionsDir)) {
        fs.rmSync(sessionsDir, { recursive: true, force: true });
        fs.mkdirSync(sessionsDir);
        console.log("✔️ Semua data sesi WhatsApp berhasil dihapus.");
    }

    // 3. Restart PM2 jika ada
    try {
        console.log("Mencoba me-restart service PM2...");
        execSync('pm2 restart netora-wa', { stdio: 'ignore' });
        console.log("✔️ Service PM2 berhasil direstart.");
    } catch (e) {
        console.log("⚠️ PM2 tidak berjalan atau tidak ditemukan (Abaikan jika Anda tidak menggunakan PM2).");
    }

    console.log("\n=========================================");
    console.log("✅ FACTORY RESET BERHASIL!");
    console.log("=========================================");
    console.log("Semua data telah kembali seperti semula.");
    console.log("Username Login : superadmin");
    console.log("Password Login : admin123");
    console.log("=========================================\n");
} catch (error) {
    console.error("❌ Gagal melakukan Factory Reset:", error.message);
}
