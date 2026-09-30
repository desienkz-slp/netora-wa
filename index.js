const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
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

const DEFAULT_CONFIG = {
    username: 'superadmin',
    password: 'admin123',
    hermesWebhook: {
        enabled: false,
        url: '',
        authToken: '',
        timeoutMs: 10000,
        retryCount: 2,
        retryDelayMs: 1200,
        sendIncoming: true,
        sendFromMe: false,
        autoReply: true,
        allowCommands: true
    }
};

const WEBHOOK_LOG_LIMIT = 300;
const webhookLogs = [];

function pushWebhookLog(entry) {
    webhookLogs.push({
        id: Date.now() + '-' + Math.random().toString(36).slice(2, 8),
        createdAt: new Date().toISOString(),
        ...entry
    });
    if (webhookLogs.length > WEBHOOK_LOG_LIMIT) {
        webhookLogs.shift();
    }
}

function normalizePhoneToJid(phoneOrJid = '') {
    let val = String(phoneOrJid || '').trim();
    if (!val) return '';
    if (val.endsWith('@g.us') || val.endsWith('@s.whatsapp.net')) return val;
    if (val.startsWith('0')) val = '62' + val.slice(1);
    if (/^\d+$/.test(val)) return `${val}@s.whatsapp.net`;
    return '';
}

function loadConfig() {
    try {
        if (!fs.existsSync(CONFIG_FILE)) return { ...DEFAULT_CONFIG };
        const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        return {
            ...DEFAULT_CONFIG,
            ...raw,
            hermesWebhook: {
                ...DEFAULT_CONFIG.hermesWebhook,
                ...(raw.hermesWebhook || {})
            }
        };
    } catch (e) {
        console.error('Gagal membaca config.json', e);
        return { ...DEFAULT_CONFIG };
    }
}

function saveConfig(nextConfig) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(nextConfig, null, 2));
}

function getWebhookConfig() {
    const cfg = loadConfig();
    return cfg.hermesWebhook || { ...DEFAULT_CONFIG.hermesWebhook };
}

function extractTextFromMessage(message = {}) {
    return (
        message.conversation ||
        message.extendedTextMessage?.text ||
        message.imageMessage?.caption ||
        message.videoMessage?.caption ||
        message.documentMessage?.caption ||
        message.buttonsResponseMessage?.selectedDisplayText ||
        message.listResponseMessage?.title ||
        message.templateButtonReplyMessage?.selectedDisplayText ||
        ''
    ).trim();
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function postToHermesWebhook(payload, webhookConfig) {
    const controller = new AbortController();
    const timeoutMs = Number(webhookConfig.timeoutMs) || 10000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const headers = { 'Content-Type': 'application/json' };
        if (webhookConfig.authToken) {
            headers['Authorization'] = `Bearer ${webhookConfig.authToken}`;
            headers['X-Hermes-Token'] = webhookConfig.authToken;
        }

        const response = await fetch(webhookConfig.url, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
            signal: controller.signal
        });

        const bodyText = await response.text();
        let parsed = null;
        try { parsed = bodyText ? JSON.parse(bodyText) : null; } catch (_) {}

        return {
            ok: response.ok,
            status: response.status,
            data: parsed,
            raw: bodyText,
            error: null
        };
    } catch (err) {
        return {
            ok: false,
            status: 0,
            data: null,
            raw: '',
            error: err?.message || 'Webhook request failed'
        };
    } finally {
        clearTimeout(timeout);
    }
}

async function postToHermesWebhookWithRetry(payload, webhookConfig) {
    const retryCount = Math.max(0, Number(webhookConfig.retryCount) || 0);
    const retryDelayMs = Math.max(200, Number(webhookConfig.retryDelayMs) || 1200);

    let lastResp = null;
    for (let attempt = 0; attempt <= retryCount; attempt++) {
        lastResp = await postToHermesWebhook(payload, webhookConfig);
        if (lastResp.ok) return { ...lastResp, attempts: attempt + 1 };
        if (attempt < retryCount) {
            await sleep(retryDelayMs * (attempt + 1));
        }
    }

    return { ...(lastResp || { ok: false, status: 0, data: null, raw: '', error: 'Unknown error' }), attempts: retryCount + 1 };
}

app.use(['/api', '/send'], (req, res, next) => {
    const config = loadConfig();
    const AUTH_USER = config.username;
    const AUTH_PASS = config.password;

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

    sock.ev.on('messages.upsert', async ({ messages = [] }) => {
        const webhookConfig = getWebhookConfig();
        if (!webhookConfig.enabled || !webhookConfig.url) return;

        for (const msg of messages) {
            try {
                if (!msg || !msg.message || !msg.key) continue;

                const fromMe = !!msg.key.fromMe;
                if (fromMe && !webhookConfig.sendFromMe) continue;
                if (!fromMe && !webhookConfig.sendIncoming) continue;

                const text = extractTextFromMessage(msg.message);
                if (!text) continue;

                const remoteJid = msg.key.remoteJid || '';
                if (!remoteJid || remoteJid === 'status@broadcast') continue;

                const payload = {
                    event: 'incoming_message',
                    source: 'netora-wa',
                    sessionId,
                    fromMe,
                    remoteJid,
                    senderJid: msg.key.participant || remoteJid,
                    pushName: msg.pushName || null,
                    text,
                    messageId: msg.key.id,
                    timestamp: msg.messageTimestamp || Math.floor(Date.now() / 1000)
                };

                const hookResp = await postToHermesWebhookWithRetry(payload, webhookConfig);
                pushWebhookLog({
                    sessionId,
                    remoteJid,
                    fromMe,
                    requestText: text,
                    ok: hookResp.ok,
                    status: hookResp.status,
                    attempts: hookResp.attempts || 1,
                    error: hookResp.error || null,
                    responsePreview: hookResp.data?.reply || hookResp.data?.message || String(hookResp.raw || '').slice(0, 180)
                });

                if (!hookResp.ok) {
                    console.error(`[${sessionId}] Hermes webhook gagal (${hookResp.status}) ${hookResp.error || ''}`);
                    continue;
                }

                const command = hookResp.data?.command;
                if (webhookConfig.allowCommands && command && typeof command === 'object') {
                    const action = String(command.action || '').toLowerCase();

                    if (action === 'send' && command.to && command.message) {
                        const toJid = normalizePhoneToJid(command.to);
                        if (toJid) {
                            await sock.sendMessage(toJid, { text: String(command.message) });
                        }
                    }

                    if (action === 'broadcast' && Array.isArray(command.targets) && command.message) {
                        for (const target of command.targets) {
                            const jid = normalizePhoneToJid(target);
                            if (!jid) continue;
                            await sock.sendMessage(jid, { text: String(command.message) });
                        }
                    }
                }

                if (!webhookConfig.autoReply || fromMe) continue;

                const aiReply = hookResp.data?.reply || hookResp.data?.message || hookResp.data?.data?.reply;
                if (!aiReply || typeof aiReply !== 'string' || !aiReply.trim()) continue;

                await sock.sendMessage(remoteJid, { text: aiReply.trim() });
            } catch (err) {
                pushWebhookLog({
                    sessionId,
                    remoteJid: msg?.key?.remoteJid || null,
                    fromMe: !!msg?.key?.fromMe,
                    requestText: extractTextFromMessage(msg?.message || {}),
                    ok: false,
                    status: 0,
                    attempts: 1,
                    error: err?.message || 'Unknown processing error'
                });
                console.error(`[${sessionId}] Error proses Hermes webhook:`, err.message);
            }
        }
    });
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
        let formattedPhone = normalizePhoneToJid(phone);
        if (!formattedPhone) {
            return res.status(400).json({ status: false, message: 'Format phone/JID tidak valid.' });
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
        const current = loadConfig();
        const configData = {
            ...current,
            username,
            password
        };
        saveConfig(configData);
        res.json({ status: true, message: 'Kredensial berhasil diperbarui. Halaman akan dimuat ulang, silakan login dengan akun baru Anda.' });
    } catch (error) {
        res.status(500).json({ status: false, message: 'Gagal menyimpan konfigurasi.', error: error.message });
    }
});
// 7. Pengaturan Integrasi Hermes Webhook
app.get('/api/settings/hermes-webhook', (req, res) => {
    try {
        const webhook = getWebhookConfig();
        res.json({ status: true, data: webhook });
    } catch (error) {
        res.status(500).json({ status: false, message: 'Gagal membaca pengaturan webhook.', error: error.message });
    }
});

app.post('/api/settings/hermes-webhook', (req, res) => {
    try {
        const {
            enabled,
            url,
            authToken,
            timeoutMs,
            retryCount,
            retryDelayMs,
            sendIncoming,
            sendFromMe,
            autoReply,
            allowCommands
        } = req.body || {};

        const current = loadConfig();
        const nextWebhook = {
            ...current.hermesWebhook,
            enabled: !!enabled,
            url: String(url || '').trim(),
            authToken: String(authToken || '').trim(),
            timeoutMs: Number(timeoutMs) > 0 ? Number(timeoutMs) : current.hermesWebhook.timeoutMs,
            retryCount: Number.isFinite(Number(retryCount)) ? Math.max(0, Math.min(5, Number(retryCount))) : (current.hermesWebhook.retryCount ?? 2),
            retryDelayMs: Number(retryDelayMs) > 0 ? Math.max(200, Number(retryDelayMs)) : (current.hermesWebhook.retryDelayMs ?? 1200),
            sendIncoming: typeof sendIncoming === 'boolean' ? sendIncoming : current.hermesWebhook.sendIncoming,
            sendFromMe: typeof sendFromMe === 'boolean' ? sendFromMe : current.hermesWebhook.sendFromMe,
            autoReply: typeof autoReply === 'boolean' ? autoReply : current.hermesWebhook.autoReply,
            allowCommands: typeof allowCommands === 'boolean' ? allowCommands : (current.hermesWebhook.allowCommands ?? true)
        };

        if (nextWebhook.enabled && !nextWebhook.url) {
            return res.status(400).json({ status: false, message: 'Webhook URL wajib diisi saat mode aktif.' });
        }

        if (nextWebhook.url && !/^https?:\/\//i.test(nextWebhook.url)) {
            return res.status(400).json({ status: false, message: 'Webhook URL harus diawali http:// atau https://' });
        }

        const nextConfig = {
            ...current,
            hermesWebhook: nextWebhook
        };
        saveConfig(nextConfig);

        res.json({ status: true, message: 'Pengaturan Hermes webhook berhasil disimpan.', data: nextWebhook });
    } catch (error) {
        res.status(500).json({ status: false, message: 'Gagal menyimpan pengaturan webhook.', error: error.message });
    }
});

app.post('/api/settings/hermes-webhook/test', async (req, res) => {
    try {
        const webhookConfig = getWebhookConfig();
        if (!webhookConfig.url) {
            return res.status(400).json({ status: false, message: 'Webhook URL belum diisi.' });
        }

        const payload = {
            event: 'test_ping',
            source: 'netora-wa',
            sessionId: req.body?.sessionId || null,
            text: req.body?.text || 'PING TEST dari NETORA WA Gateway',
            timestamp: Math.floor(Date.now() / 1000)
        };

        const hookResp = await postToHermesWebhookWithRetry(payload, webhookConfig);
        pushWebhookLog({
            sessionId: payload.sessionId,
            remoteJid: null,
            fromMe: true,
            requestText: payload.text,
            ok: hookResp.ok,
            status: hookResp.status,
            attempts: hookResp.attempts || 1,
            error: hookResp.error || null,
            responsePreview: hookResp.data?.reply || hookResp.data?.message || String(hookResp.raw || '').slice(0, 180),
            isTest: true
        });

        res.status(hookResp.ok ? 200 : 502).json({
            status: hookResp.ok,
            message: hookResp.ok ? 'Webhook Hermes terhubung.' : 'Webhook Hermes gagal diakses.',
            webhookStatus: hookResp.status,
            attempts: hookResp.attempts || 1,
            error: hookResp.error || null,
            data: hookResp.data,
            raw: hookResp.raw
        });
    } catch (error) {
        res.status(500).json({ status: false, message: 'Gagal test webhook.', error: error.message });
    }
});

app.get('/api/settings/hermes-webhook/logs', (req, res) => {
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
    const data = webhookLogs.slice(-limit).reverse();
    res.json({ status: true, total: webhookLogs.length, data });
});

// 8. Logout Sesi (Cabut Akses)
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
// ==========================================
// --- SYSTEM UPDATE API ---
// ==========================================
app.get('/api/system/check-update', (req, res) => {
    exec('git fetch origin && git rev-list HEAD...origin/main --count', (err, stdout) => {
        if (err) {
            return res.json({ available: false, error: err.message });
        }
        const count = parseInt(stdout.trim(), 10) || 0;
        res.json({ available: count > 0, commits_behind: count });
    });
});

app.post('/api/system/trigger-update', (req, res) => {
    // Respond first to avoid frontend timeout
    res.json({ success: true, message: 'Update triggered, system will restart...' });
    
    setTimeout(() => {
        console.log('[System] Triggering Auto-Update...');
        exec('git pull origin main && pm2 restart netora-wa', (err, stdout, stderr) => {
            if (err) console.error('[System] Auto-Update failed:', err);
            else console.log('[System] Auto-Update success:', stdout);
        });
    }, 2000);
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`🚀 WA Gateway (Multi-Device) berjalan di http://localhost:${PORT}`);
});
