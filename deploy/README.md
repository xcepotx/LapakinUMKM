# Lapakin Deploy Scripts

Skrip-skrip untuk maintenance & deployment di VPS.

## `update-lapakin.sh`

Smart deployment: pull dari git, rebuild yang berubah saja, restart, health-check.

### Pasang Sekali di VPS

```bash
cd ~/LapakinUMKM
git pull
bash deploy/install-update-script.sh
```

Setelah itu kamu bisa pakai command **`update-lapakin`** dari mana saja.

### Cara Pakai

```bash
# Update normal (paling sering dipakai)
update-lapakin

# Force rebuild frontend walau gak ada perubahan
update-lapakin --force-frontend

# Force reinstall backend deps
update-lapakin --force-backend

# Skip git pull (deploy local changes saja)
update-lapakin --no-pull

# Sekalian seed demo shops
update-lapakin --seed

# Skip health check (untuk cron)
update-lapakin --skip-health
```

### Apa yang Dilakukan

1. **Git pull** dari remote (kecuali `--no-pull`)
2. **Cek diff** antara commit lama vs baru → tentukan apa yang perlu di-rebuild
3. **Backend**:
   - Kalau `backend/*` berubah → restart pm2
   - Kalau `requirements.txt` berubah → reinstall pip deps
4. **Frontend**:
   - Kalau `frontend/*` berubah → `yarn build`
   - Kalau `package.json`/`yarn.lock` berubah → `yarn install` dulu
   - Auto-fix permission untuk nginx (chmod o+rX)
5. **Restart** pm2 backend (kalau perlu) + reload nginx (kalau perlu)
6. **Health check** ke `https://lapakin.my.id/api/`
7. **Print changelog** commit-commit yang baru di-pull

### Idempotent + Aman

- Kalau gak ada perubahan dari git, script langsung skip semua step (cuma 5 detik)
- Kalau `yarn build` gagal, exit dengan error log, **nggak rusak production**
- Kalau nginx config invalid, exit sebelum reload
- Health check end-to-end, kasih hint cek log kalau gagal

### Auto-Update via Cron (Opsional)

Mau git pull + rebuild otomatis tiap 5 menit?

```bash
crontab -e
```

Tambah:
```
*/5 * * * * /usr/local/bin/update-lapakin --skip-health >> /home/lapakin/update.log 2>&1
```

Atau lebih konservatif, sekali sehari jam 3 pagi:
```
0 3 * * * /usr/local/bin/update-lapakin --skip-health >> /home/lapakin/update.log 2>&1
```

> ⚠️ Auto-update pakai cron berarti tiap push ke main branch langsung deploy ke production. Aman kalau kamu solo dev + selalu test di local dulu. Kalau team-based, mending manual `update-lapakin` setelah review.

## Workflow Update Recommended

### Dari Emergent (untuk Backend/Frontend changes)
1. Edit code di Emergent → test
2. Klik **"Save to GitHub"** di chat Emergent → push ke `main`
3. SSH VPS → `update-lapakin`
4. Done dalam 1-3 menit (tergantung yang berubah)

### Dari Laptop Lokal (untuk hotfix)
```bash
cd ~/LapakinUMKM
git pull
# edit file
git add . && git commit -m "fix: typo"
git push
ssh lapakin@vps "update-lapakin"
```

### Manual Deploy Tanpa Git
```bash
# Rsync file langsung (skip git)
rsync -av --exclude=node_modules --exclude=.venv \
  ./frontend/src/ lapakin@vps:/home/lapakin/LapakinUMKM/frontend/src/

ssh lapakin@vps "update-lapakin --no-pull --force-frontend"
```
