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
app.use(express.urlencoded({ extended: true }));

// Serve static files untuk UI Dashboard
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// --- BASIC AUTHENTICATION MIDDLEWARE ---
// ==========================================
const CONFIG_FILE = path.join(__dirname, 'config.json');

app.use(['/api', '/send'], (req, res, next) => {
    // Baca kredensial langsung dari file config
    let AUTH_USER = 'superadmin';
    let AUTH_PASS = 'admin123';
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

    // Jika gagal, kembalikan 401 tanpa WWW-Authenticate untuk mencegah popup browser bawaan
    res.status(401).json({ error: 'Akses Ditolak. Authentication required.' });
});

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
    sessions.set(sessionId, { sock: sock, qr: null, qrUpdatedAt: null, connected: false });

    // Event Listener
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        const currentSession = sessions.get(sessionId);

        if (qr) {
            currentSession.qr = qr;
            currentSession.qrUpdatedAt = Date.now();
            console.log(`[${sessionId}] Menunggu Scan QR Code... (QR updated)`);
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

    const regex = /^[a-z0-9\-]+$/;
    if (!regex.test(sessionId)) {
        return res.status(400).json({ status: false, message: 'Sesi ID hanya boleh berisi huruf kecil, angka, dan tanda strip (-).' });
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
        res.json({ status: 'Scan', qr_string: session.qr, qrUpdatedAt: session.qrUpdatedAt });
    } else {
        res.json({ status: 'Waiting', message: 'Sedang men-generate QR Code...' });
    }
});

// 4. Kirim Pesan Multi-Device (Mendukung JSON dan URL-Encoded)
app.post(['/api/send', '/send/message'], async (req, res) => {
    // Dukung parameter dari body maupun query string (kompatibilitas MikroTik lama)
    const sessionId = req.body.sessionId || req.query.sessionId || req.query.device_id;
    const phone = req.body.phone || req.query.phone;
    const message = req.body.message || req.query.message;

    if (!sessionId || !phone || !message) {
        return res.status(400).json({ status: false, message: 'Parameter sessionId/device_id, phone, dan message wajib diisi!' });
    }

    const session = sessions.get(sessionId);
    if (!session || !session.connected) {
        return res.status(503).json({ status: false, message: `Device [${sessionId}] belum terkoneksi / terputus.` });
    }

    try {
        let formattedPhone = phone;
        if (!formattedPhone.endsWith('@g.us')) {
            if (formattedPhone.startsWith('0')) formattedPhone = '62' + formattedPhone.slice(1);
            if (!formattedPhone.endsWith('@s.whatsapp.net')) formattedPhone = formattedPhone + '@s.whatsapp.net';
        }

        // Kirim lewat socket spesifik
        await session.sock.sendMessage(formattedPhone, { text: message });
        
        res.json({ status: true, message: `Pesan berhasil dikirim via [${sessionId}]!` });
    } catch (error) {
        console.error(`Error send via [${sessionId}]:`, error);
        res.status(500).json({ status: false, message: 'Gagal mengirim pesan.', error: error.message });
    }
});

// 4.5 Ambil Data Grup dari Device
app.get('/api/groups', async (req, res) => {
    const { sessionId } = req.query;
    if (!sessionId) return res.status(400).json({ status: false, message: 'Parameter ?sessionId= wajib disematkan' });

    const session = sessions.get(sessionId);
    if (!session || !session.connected) return res.status(503).json({ status: false, message: 'Device belum terkoneksi.' });

    try {
        const groups = await session.sock.groupFetchAllParticipating();
        const groupList = Object.values(groups).map(g => ({ id: g.id, name: g.subject }));
        res.json({ status: true, data: groupList });
    } catch (error) {
        console.error('Error fetching groups:', error);
        res.status(500).json({ status: false, message: 'Gagal mengambil data grup.', error: error.message });
    }
});

// 5. Get All Sessions (Untuk UI Dashboard)
app.get('/api/sessions', (req, res) => {
    const allSessions = [];
    sessions.forEach((session, sessionId) => {
        let phone = null;
        let name = null;
        if (session.sock && session.sock.user) {
            // sock.user.id format: "62812345678:12@s.whatsapp.net"
            phone = session.sock.user.id.split(':')[0].split('@')[0];
            name = session.sock.user.name || null;
        }
        allSessions.push({
            sessionId: sessionId,
            status: session.connected ? 'Connected' : 'Disconnected',
            hasQr: !!session.qr,
            phone: phone,
            name: name
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
// 7. Logout Sesi (Cabut Akses)
app.post('/api/session/logout', async (req, res) => {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ status: false, message: 'Parameter sessionId wajib diisi' });

    const session = sessions.get(sessionId);
    if (!session) {
        const sessionDir = path.join(SESSIONS_DIR, sessionId);
        if (fs.existsSync(sessionDir)) fs.rmSync(sessionDir, { recursive: true, force: true });
        return res.status(404).json({ status: false, message: 'Sesi tidak ditemukan' });
    }

    try {
        if (session.sock) await session.sock.logout();
        res.json({ status: true, message: `Berhasil logout sesi [${sessionId}].` });
    } catch (e) {
        sessions.delete(sessionId);
        const sessionDir = path.join(SESSIONS_DIR, sessionId);
        if (fs.existsSync(sessionDir)) fs.rmSync(sessionDir, { recursive: true, force: true });
        res.json({ status: true, message: `Sesi [${sessionId}] dipaksa berhenti dan dihapus.` });
    }
});

// 8. Reconnect Sesi (Mulai Ulang WS)
app.post('/api/session/reconnect', (req, res) => {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ status: false, message: 'Parameter sessionId wajib diisi' });

    const session = sessions.get(sessionId);
    if (!session) return res.status(404).json({ status: false, message: 'Sesi tidak ditemukan' });

    try {
        if (session.sock && session.sock.ws) session.sock.ws.close();
        res.json({ status: true, message: `Mencoba menghubungkan ulang sesi [${sessionId}]...` });
    } catch (e) {
        res.status(500).json({ status: false, message: 'Gagal menghubungkan ulang.', error: e.message });
    }
});

// 9. Delete Sesi (Hapus Paksa)
app.post('/api/session/delete', (req, res) => {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ status: false, message: 'Parameter sessionId wajib diisi' });

    try {
        const session = sessions.get(sessionId);
        if (session && session.sock) {
            session.sock.ev.removeAllListeners('connection.update');
            if(session.sock.ws) session.sock.ws.close();
        }
        
        sessions.delete(sessionId);
        const sessionDir = path.join(SESSIONS_DIR, sessionId);
        if (fs.existsSync(sessionDir)) fs.rmSync(sessionDir, { recursive: true, force: true });

        res.json({ status: true, message: `Sesi [${sessionId}] berhasil dihapus permanen.` });
    } catch (e) {
        res.status(500).json({ status: false, message: 'Gagal menghapus sesi.', error: e.message });
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`🚀 WA Gateway (Multi-Device) berjalan di http://localhost:${PORT}`);
});
