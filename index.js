const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');

const app = express();
app.use(cors());
app.use(express.json());

// ==========================================
// --- BASIC AUTHENTICATION MIDDLEWARE ---
// ==========================================
const CONFIG_FILE = path.join(__dirname, 'config.json');

app.use((req, res, next) => {
    // Baca kredensial langsung dari file config
    let AUTH_USER = 'admin';
    let AUTH_PASS = 'password123';
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
            AUTH_USER = config.username;
            AUTH_PASS = config.password;
        }
    } catch (e) {
        console.error("Gagal membaca config.json", e);
    }

    const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
    const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');

    if (login === AUTH_USER && password === AUTH_PASS) {
        return next();
    }

    // Jika gagal, tampilkan Pop-Up Login bawaan browser
    res.set('WWW-Authenticate', 'Basic realm="NETORA WA Gateway Secure Area"');
    res.status(401).send('Akses Ditolak. Authentication required.');
});

// Serve static files untuk UI Dashboard
app.use(express.static(path.join(__dirname, 'public')));

// Tempat menyimpan data semua sesi aktif di memori
const sessions = new Map();

// Direktori root untuk menyimpan autentikasi masing-masing device
const SESSIONS_DIR = path.join(__dirname, 'sessions');
if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR);
}

// Fungsi utama untuk menginisialisasi sesi WA baru / me-resume yang sudah ada
async function initSession(sessionId) {
    const sessionDir = path.join(SESSIONS_DIR, sessionId);
    
    // Inisialisasi state dari file auth spesifik folder sessionId
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    // Bikin socket
    const sock = makeWASocket({
        version,
        auth: state,
        browser: Browsers.macOS('Desktop'),
        logger: pino({ level: 'error' })
    });

    // Simpan ke memory map
    sessions.set(sessionId, { sock: sock, qr: null, connected: false });

    // Event Listener
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        const currentSession = sessions.get(sessionId);

        if (qr) {
            currentSession.qr = qr;
            console.log(`[${sessionId}] Menunggu Scan QR Code...`);
        }

        if (connection === 'close') {
            currentSession.connected = false;
            currentSession.qr = null;
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log(`[${sessionId}] Koneksi terputus, reconnecting:`, shouldReconnect);
            
            if (shouldReconnect) {
                // Beri jeda 3 detik sebelum reconnect untuk menghindari infinite loop
                setTimeout(() => initSession(sessionId), 3000);
            } else {
                console.log(`[${sessionId}] Anda telah logout / Sesi Dicabut.`);
                // Hapus dari memori
                sessions.delete(sessionId);
                // Opsional: hapus folder session
                fs.rmSync(sessionDir, { recursive: true, force: true });
            }
        } else if (connection === 'open') {
            currentSession.connected = true;
            currentSession.qr = null;
            console.log(`[${sessionId}] ✅ WA Berhasil Terhubung!`);
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

// Fungsi untuk me-resume semua sesi yang tersimpan di disk saat server Node di-restart
function resumeAllSessions() {
    console.log('Membaca sesi tersimpan...');
    const dirs = fs.readdirSync(SESSIONS_DIR);
    dirs.forEach(dir => {
        const stat = fs.statSync(path.join(SESSIONS_DIR, dir));
        if (stat.isDirectory()) {
            console.log(`Menghidupkan ulang sesi: ${dir}`);
            initSession(dir);
        }
    });
}
resumeAllSessions();


// ==========================================
// --- ENDPOINTS REST API (MULTI-DEVICE) ---
// ==========================================

// 1. Memulai Sesi Baru (Men-generate QR)
app.post('/api/session/start', (req, res) => {
    const { sessionId } = req.body;
    
    if (!sessionId) {
        return res.status(400).json({ status: false, message: 'Parameter sessionId wajib diisi' });
    }

    if (sessions.has(sessionId)) {
        return res.status(400).json({ status: false, message: `Sesi ${sessionId} sudah aktif atau dalam proses.` });
    }

    // Panggil fungsi inisialisasi
    initSession(sessionId);
    res.json({ status: true, message: `Proses inisialisasi sesi [${sessionId}] dimulai. Silakan hit endpoint /api/qr untuk melihat QR Code.` });
});

// 2. Cek Status Sesi
app.get('/api/status', (req, res) => {
    const { sessionId } = req.query;
    
    if (!sessionId) return res.status(400).json({ status: false, message: 'Parameter ?sessionId= wajib disematkan' });

    const session = sessions.get(sessionId);
    if (!session) {
        return res.status(404).json({ status: false, message: 'Sesi tidak ditemukan atau belum dimulai.' });
    }

    res.json({
        sessionId: sessionId,
        status: session.connected ? 'Connected' : 'Disconnected',
    });
});

// 3. Tampilkan QR (Ambil string base64 qr)
app.get('/api/qr', (req, res) => {
    const { sessionId } = req.query;

    if (!sessionId) return res.status(400).json({ status: false, message: 'Parameter ?sessionId= wajib disematkan' });

    const session = sessions.get(sessionId);
    if (!session) return res.status(404).json({ status: false, message: 'Sesi tidak ditemukan.' });

    if (session.connected) {
        return res.json({ status: 'Connected', message: 'Sesi sudah terhubung, tidak butuh scan.' });
    }

    if (session.qr) {
        res.json({ status: 'Scan', qr_string: session.qr });
    } else {
        res.json({ status: 'Waiting', message: 'Sedang men-generate QR Code...' });
    }
});

// 4. Kirim Pesan Multi-Device
app.post('/api/send', async (req, res) => {
    const { sessionId, phone, message } = req.body;

    if (!sessionId || !phone || !message) {
        return res.status(400).json({ status: false, message: 'Parameter sessionId, phone, dan message wajib diisi!' });
    }

    const session = sessions.get(sessionId);
    if (!session || !session.connected) {
        return res.status(503).json({ status: false, message: `Device [${sessionId}] belum terkoneksi / terputus.` });
    }

    try {
        let formattedPhone = phone;
        if (formattedPhone.startsWith('0')) formattedPhone = '62' + formattedPhone.slice(1);
        formattedPhone = formattedPhone + '@s.whatsapp.net';

        // Kirim lewat socket spesifik
        await session.sock.sendMessage(formattedPhone, { text: message });
        
        res.json({ status: true, message: `Pesan berhasil dikirim via [${sessionId}]!` });
    } catch (error) {
        console.error(`Error send via [${sessionId}]:`, error);
        res.status(500).json({ status: false, message: 'Gagal mengirim pesan.', error: error.message });
    }
});

// 5. Get All Sessions (Untuk UI Dashboard)
app.get('/api/sessions', (req, res) => {
    const allSessions = [];
    sessions.forEach((session, sessionId) => {
        allSessions.push({
            sessionId: sessionId,
            status: session.connected ? 'Connected' : 'Disconnected',
            hasQr: !!session.qr
        });
    });
    res.json({ status: true, data: allSessions });
});

// 6. Pengaturan Ganti Akun Login (Dinamic Auth)
app.post('/api/settings/auth', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ status: false, message: 'Username dan Password tidak boleh kosong!' });
    }

    try {
        const configData = { username, password };
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(configData, null, 2));
        res.json({ status: true, message: 'Kredensial berhasil diperbarui. Halaman akan dimuat ulang, silakan login dengan akun baru Anda.' });
    } catch (error) {
        res.status(500).json({ status: false, message: 'Gagal menyimpan konfigurasi.', error: error.message });
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`🚀 WA Gateway (Multi-Device) berjalan di http://localhost:${PORT}`);
});
