# Lapakin VPS Reinstall & Hardening Guide

Panduan install ulang VPS Lapakin setelah kena attack + hardening security supaya tidak terulang.

---

## 🔒 Prinsip Security Dasar (WAJIB setelah reinstall)

1. **Ganti SEMUA password + API key** — attacker bisa jadi sudah punya dump MongoDB/env
2. **SSH pakai key-only** — non-aktifkan password login
3. **Firewall + fail2ban** dari menit pertama
4. **MongoDB NGGAK BOLEH expose ke internet** — bind ke `127.0.0.1` saja
5. **Automatic security updates** aktif
6. **Deploy pakai user non-root** (`lapakin`, bukan `root`)

---

## Langkah 0 — Backup (Kalau Masih Bisa Akses)

Sebelum reinstall OS, rescue data kalau bisa. Dari rescue mode / console provider:

```bash
# MongoDB data
mongodump --uri="mongodb://localhost:27017" --db=lapakin_db --out=/tmp/mongo-backup
tar -czf /tmp/mongo-backup.tar.gz /tmp/mongo-backup
# Nginx config (kalau ada custom)
tar -czf /tmp/nginx-backup.tar.gz /etc/nginx/

# scp keluar dari VPS
# Dari laptop:  scp user@vps:/tmp/mongo-backup.tar.gz ~/
```

**Kalau kernel sudah rusak parah**, skip backup — mending fresh start. Data produk bisa di-rebuild.

---

## Langkah 1 — Reinstall OS

Di provider VPS kamu (Niagahoster / Biznet / DigitalOcean / Vultr / etc):

- **OS**: Ubuntu 22.04 LTS (long-term support, stable)
- **Location**: Jakarta/Singapore (latency dekat ke user UMKM)
- **RAM minimal**: 2 GB (4 GB recommended buat Pillow image gen)
- **Disk**: 40 GB SSD
- **IPv4**: Wajib (IPv6 opsional)

Tunggu OS terpasang → SSH masuk sebagai root pakai password sementara dari provider.

---

## Langkah 2 — Initial Hardening (JALANKAN SEBELUM PASANG APAPUN)

SSH ke VPS sebagai root:

```bash
ssh root@IP_VPS_BARU
```

### 2.1 Update OS + Pasang Essentials
```bash
apt-get update && apt-get upgrade -y
apt-get install -y curl wget git ufw fail2ban unattended-upgrades \
  software-properties-common build-essential
```

### 2.2 Buat User Non-Root `lapakin`
```bash
adduser lapakin
usermod -aG sudo lapakin

# Copy SSH key kamu dari root ke lapakin (kalau SSH sebagai root pakai key)
mkdir -p /home/lapakin/.ssh
cp /root/.ssh/authorized_keys /home/lapakin/.ssh/
chown -R lapakin:lapakin /home/lapakin/.ssh
chmod 700 /home/lapakin/.ssh
chmod 600 /home/lapakin/.ssh/authorized_keys
```

### 2.3 SSH Key Login Only (CRITICAL)
Generate key di laptop kalau belum punya (dari laptop, BUKAN server):
```bash
# Di laptop kamu
ssh-keygen -t ed25519 -C "lapakin-vps"
# Tekan enter 3x untuk default, atau kasih passphrase biar lebih aman
cat ~/.ssh/id_ed25519.pub
# Copy output-nya
```

Di server, sebagai root:
```bash
echo "PASTE_PUBLIC_KEY_DARI_LAPTOP_DISINI" >> /home/lapakin/.ssh/authorized_keys

# Test dulu login sebagai lapakin dari terminal BARU (jangan close yg sekarang!)
# Dari laptop:  ssh lapakin@IP_VPS_BARU
# Kalau sudah bisa masuk tanpa password, lanjut disable password login:

nano /etc/ssh/sshd_config
# Ubah:
#   PasswordAuthentication yes → no
#   PermitRootLogin yes → no
#   PubkeyAuthentication yes (uncomment kalau perlu)
systemctl restart sshd
```

> ⚠️ **JANGAN DISCONNECT session root yang aktif** sampai kamu konfirmasi `ssh lapakin@IP` bisa masuk. Kalau sshd config salah, root login ke-lock, harus lewat console provider.

### 2.4 UFW Firewall
```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
ufw --force enable
ufw status
```

### 2.5 Fail2ban (Auto-ban IP brute-force SSH)
```bash
cat > /etc/fail2ban/jail.local << 'EOF'
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 5

[sshd]
enabled = true
port = 22
logpath = /var/log/auth.log
EOF
systemctl restart fail2ban
systemctl enable fail2ban
```

### 2.6 Automatic Security Updates
```bash
dpkg-reconfigure --priority=low unattended-upgrades
# Pilih "Yes" di dialog
```

### 2.7 Disable Root Password Login (double check)
```bash
passwd -l root
```

**Pindah ke user lapakin untuk langkah selanjutnya:**
```bash
su - lapakin
```

---

## Langkah 3 — Install Stack (Node.js + Python + MongoDB + Nginx)

### 3.1 Node.js 20 LTS
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g yarn pm2
```

### 3.2 Python 3.11 + pip
Ubuntu 22.04 default sudah Python 3.10, tapi kita butuh 3.11:
```bash
sudo add-apt-repository ppa:deadsnakes/ppa -y
sudo apt-get update
sudo apt-get install -y python3.11 python3.11-venv python3.11-dev python3-pip
```

### 3.3 MongoDB 7.0 (Bind ke localhost saja!)
```bash
# Import MongoDB GPG key
curl -fsSL https://pgp.mongodb.com/server-7.0.asc | \
  sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor

echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] \
  https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | \
  sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list

sudo apt-get update
sudo apt-get install -y mongodb-org

# CRITICAL: Bind MongoDB to localhost only
sudo sed -i 's/bindIp: 127.0.0.1/bindIp: 127.0.0.1/g' /etc/mongod.conf
# Pastikan nggak ada "bindIp: 0.0.0.0" — kalau ada, ini yang jadi vektor attack!

# Enable auth (optional tapi recommended)
# Edit /etc/mongod.conf → uncomment:
#   security:
#     authorization: enabled

sudo systemctl enable mongod
sudo systemctl start mongod
sudo systemctl status mongod
```

### 3.4 Nginx
```bash
sudo apt-get install -y nginx
sudo systemctl enable nginx
```

### 3.5 Certbot (SSL Gratis dari Let's Encrypt)
```bash
sudo apt-get install -y certbot python3-certbot-nginx
```

---

## Langkah 4 — Deploy Lapakin

### 4.1 Clone Repo
```bash
cd /home/lapakin
git clone https://github.com/USERNAME/LapakinUMKM.git
cd LapakinUMKM
```

### 4.2 Backend Setup
```bash
cd backend
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pip install "emergentintegrations" --extra-index-url https://d33sy5i8bnduwe.cloudfront.net/simple/

# Create .env (ganti SEMUA secret — attacker mungkin sudah punya yang lama!)
cat > .env << 'EOF'
MONGO_URL=mongodb://localhost:27017
DB_NAME=lapakin_db
CORS_ORIGINS=https://lapakin.my.id
JWT_SECRET=GENERATE_NEW_RANDOM_64_CHARS_DI_BAWAH
ADMIN_EMAIL=admin@lapakin.id
ADMIN_PASSWORD=PASSWORD_BARU_YANG_KUAT_MINIMAL_16_CHARS
EMERGENT_LLM_KEY=sk-emergent-xxx
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_FROM=
RESEND_API_KEY=re_XXX_GENERATE_BARU_DI_RESEND_DASHBOARD
SENDER_EMAIL=noreply@lapakin.my.id
SENDER_NAME=Lapakin
PUBLIC_APP_URL=https://lapakin.my.id
MIDTRANS_SERVER_KEY=Mid-server-XXX_REGENERATE_DI_MIDTRANS
MIDTRANS_CLIENT_KEY=Mid-client-XXX_REGENERATE_DI_MIDTRANS
MIDTRANS_IS_PRODUCTION=true
CUSTOM_DOMAIN_TARGET=lapakin.my.id
EOF

chmod 600 .env   # penting: user lain gak bisa baca
```

**Generate JWT_SECRET baru**:
```bash
python3 -c "import secrets; print(secrets.token_urlsafe(64))"
```

**⚠️ REGENERATE SEMUA KEY:**
- `EMERGENT_LLM_KEY`: di Emergent Profile → Universal Key → regenerate
- `RESEND_API_KEY`: di resend.com/api-keys → delete yang lama, buat baru
- `MIDTRANS_*`: di dashboard.midtrans.com → Settings → Access Keys → regenerate
- `ADMIN_PASSWORD`: password baru min 16 char, acak
- `JWT_SECRET`: hasil command di atas

### 4.3 Frontend Build
```bash
cd ../frontend
# Create .env
cat > .env << 'EOF'
REACT_APP_BACKEND_URL=https://lapakin.my.id
EOF

yarn install
yarn build
# Output di ./build/
```

### 4.4 PM2 untuk Backend
```bash
cd /home/lapakin/LapakinUMKM/backend

pm2 start "/home/lapakin/LapakinUMKM/backend/.venv/bin/uvicorn server:app --host 127.0.0.1 --port 8001" \
  --name lapakin-backend \
  --cwd /home/lapakin/LapakinUMKM/backend \
  --max-memory-restart 800M

pm2 save
pm2 startup   # Ikuti instruksi yg muncul (jalankan command sudo yang dikasih)
```

### 4.5 Nginx Config

```bash
sudo tee /etc/nginx/sites-available/lapakin << 'EOF'
# Redirect HTTP → HTTPS
server {
    listen 80;
    server_name lapakin.my.id www.lapakin.my.id;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name lapakin.my.id www.lapakin.my.id;

    # SSL certs (Certbot akan isi otomatis)
    ssl_certificate /etc/letsencrypt/live/lapakin.my.id/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/lapakin.my.id/privkey.pem;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Content-Type-Options nosniff;
    add_header X-Frame-Options SAMEORIGIN;
    add_header Referrer-Policy strict-origin-when-cross-origin;

    # Large uploads (image AI enhance base64 bisa 5 MB+)
    client_max_body_size 20M;

    # API → backend
    location /api/ {
        proxy_pass http://127.0.0.1:8001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }

    # OG bot detection — serve HTML dari backend untuk FB/Twitter crawler
    location ~* ^/toko/([^/]+)$ {
        set $is_bot 0;
        if ($http_user_agent ~* "facebookexternalhit|Twitterbot|LinkedInBot|WhatsApp|TelegramBot|Slackbot|Discordbot") {
            set $is_bot 1;
        }
        if ($is_bot = 1) {
            proxy_pass http://127.0.0.1:8001/api/og/shop/$1;
            proxy_set_header Host $host;
            proxy_set_header X-Forwarded-Host $host;
            proxy_set_header X-Forwarded-Proto https;
            break;
        }
        # Human → React app
        try_files $uri /index.html;
    }

    # Static frontend
    root /home/lapakin/LapakinUMKM/frontend/build;
    index index.html;

    location / {
        try_files $uri /index.html;
    }

    # Cache static assets agressive
    location ~* \.(js|css|png|jpg|jpeg|svg|woff2?)$ {
        expires 7d;
        add_header Cache-Control "public, max-age=604800";
        try_files $uri /index.html;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/lapakin /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

### 4.6 SSL dengan Certbot
```bash
sudo certbot --nginx -d lapakin.my.id -d www.lapakin.my.id \
  --email kamu@email.com --agree-tos --no-eff-email --redirect
```

Certbot otomatis renew setiap 60 hari via systemd timer.

---

## Langkah 5 — Re-konfigurasi Integrasi Eksternal

### 5.1 Resend
- Login → **Domains** → Remove domain lama kalau ada, Add ulang `lapakin.my.id`
- Update DNS (SPF + DKIM + DMARC) — lihat `/app/docs/RESEND_EMAIL_SETUP.md`

### 5.2 Midtrans
- Dashboard → Settings → Configuration
- **Payment Notification URL** = `https://lapakin.my.id/api/payment/webhook`
- **Finish/Unfinish/Error URL** = `https://lapakin.my.id/dashboard/billing`

### 5.3 DNS Domain
Di registrar `lapakin.my.id`:
```
A    @      IP_VPS_BARU
A    www    IP_VPS_BARU
CNAME og    lapakin.my.id        (optional, untuk OG crawler)
```

---

## Langkah 6 — Verifikasi Deploy

```bash
# Backend health
curl https://lapakin.my.id/api/

# Login admin
curl -X POST https://lapakin.my.id/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@lapakin.id","password":"PASSWORD_BARU_KAMU"}'

# Cek pm2
pm2 status
pm2 logs lapakin-backend --lines 20
```

Buka `https://lapakin.my.id` di browser, pastikan landing page tampil lengkap dengan SSL (gembok hijau).

---

## 🔍 Post-Incident Investigation

Sebelum lupa, cari tau **vektor attack** supaya tidak berulang:

### Check di VPS lama (kalau masih bisa akses / rescue mode):
```bash
# Last successful logins
lastlog | tail -20
last | head -20

# Failed SSH attempts
grep "Failed password" /var/log/auth.log | tail -50

# Check cron untuk malware
crontab -l
ls -la /etc/cron.*
cat /etc/cron.d/*

# Running processes aneh
ps auxf
systemctl list-units --type=service | grep running

# Listening ports (MongoDB 27017 harusnya TIDAK public)
ss -tlnp
netstat -tlnp

# File yang baru dimodifikasi 7 hari terakhir di /etc
find /etc -type f -mtime -7 -ls
```

### Kemungkinan vektor attack umum:
1. **MongoDB bind ke 0.0.0.0 tanpa auth** → ransomware crypto gang scan port 27017
2. **SSH password weak** → brute force (cek `grep "Accepted password" /var/log/auth.log`)
3. **API key bocor** di git public repo
4. **Outdated WordPress/PHP** kalau ada di VPS
5. **Docker daemon expose ke internet** (port 2375)
6. **Redis tanpa password**
7. **Kubernetes dashboard public**

Kirim log keluar dari VPS buat investigasi offline, jangan rely pada VPS yg kena compromise.

---

## 🛡️ Security Checklist Post-Install

Setelah VPS baru live, verify satu per satu:

- [ ] `ufw status` → hanya 22, 80, 443 allow
- [ ] `ss -tlnp` → MongoDB listen di `127.0.0.1:27017`, BUKAN `0.0.0.0`
- [ ] `ssh root@IP` → **Permission denied**
- [ ] `ssh lapakin@IP` (password only, tanpa key) → **Permission denied**
- [ ] `curl https://lapakin.my.id` → SSL valid
- [ ] `cat /home/lapakin/LapakinUMKM/backend/.env` permission = `600`
- [ ] `pm2 status` → backend online, memory < 500 MB
- [ ] Admin login bisa dengan password BARU (bukan `lapakin123`)
- [ ] Test upgrade tier via Midtrans → webhook masuk, tier aktif
- [ ] Test forgot password → email masuk inbox

---

## 💾 Backup Strategy (Supaya Kejadian Ini Tidak Berulang)

### Daily MongoDB Backup ke Lokasi Luar
```bash
# Edit cron
crontab -e

# Tambah baris ini (backup jam 2 pagi tiap hari, kirim ke rclone/S3/GDrive)
0 2 * * * /home/lapakin/scripts/backup.sh
```

`/home/lapakin/scripts/backup.sh`:
```bash
#!/bin/bash
DATE=$(date +%Y%m%d)
mongodump --uri="mongodb://localhost:27017" --db=lapakin_db \
  --out=/tmp/mongo-$DATE --quiet
tar -czf /tmp/lapakin-$DATE.tar.gz /tmp/mongo-$DATE
# Upload ke GDrive/S3 pakai rclone
rclone copy /tmp/lapakin-$DATE.tar.gz gdrive:Backups/Lapakin/
# Cleanup local >7 hari
rm /tmp/mongo-$DATE -rf
find /tmp/lapakin-*.tar.gz -mtime +7 -delete
```

Install rclone: `curl https://rclone.org/install.sh | sudo bash`

---

## 📞 Kontak Cepat

- Emergent support: lewat dashboard (buat issue)
- Midtrans support: `support@midtrans.com`
- Resend support: `support@resend.com`
- Let's Encrypt issue: `https://community.letsencrypt.org/`
