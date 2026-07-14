
# Rule: Deployment Workflow (NETORA WA Gateway)

**Context**: Setiap kali agen melakukan modifikasi atau pengeditan fitur pada kode sumber WA Gateway di lingkungan lokal (c:\xampp\htdocs\netora-wa).

**Instructions**:
1. **Lokal Edit First**: Semua pengeditan dan penambahan kode WAJIB dilakukan di folder lokal (c:\xampp\htdocs\netora-wa) terlebih dahulu.
2. **Git Push**: Setelah pengeditan selesai atau saat Anda diminta melakukan *deploy*, jalankan perintah Git (git add ., git commit -m "...", dan git push origin main) untuk mengunggah perubahan secara aman ke repositori GitHub.
3. **Server Pull (172.18.20.141)**: Setelah proses *push* selesai di lokal, agen WAJIB segera menghubungkan diri ke server dev WA Gateway via SSH (ssh wa-gateway atau ke 172.18.20.141). Di dalam server, masuk ke direktori aplikasi (contoh: cd ~/netora-wa atau cd /var/www/netora-wa) dan lakukan git pull.
4. **Restart Layanan**: Jika terdapat perubahan logika pada *backend* (misalnya di index.js), pastikan agen menjalankan perintah pm2 restart netora-wa di server 141 tersebut agar pembaruan bisa langsung aktif.

# Rule: Adhere to DESIGN.md for Frontend UI

**Context**: Whenever you are asked to create, edit, or modify any frontend pages, views, or UI components (like HTML, Vue, CSS).

**Instructions**:
1. You MUST always consult and read the `C:\xampp\htdocs\netora-wa\.agents\DESIGN.md` file before generating or modifying any user interface elements.
2. Strictly use the colors (e.g., Primary `#2563EB`, Surface `#FFFFFF`, Success `#16A34A`), typography (Plus Jakarta Sans, Inter, Fira Code), spacing, border-radii, and elevation rules defined in the design system.
3. Do not invent new styling rules or colors that conflict with the `DESIGN.md`. Ensure that buttons, cards, inputs, and notifications follow the exact design tokens specified.
