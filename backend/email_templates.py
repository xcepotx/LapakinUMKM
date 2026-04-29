"""HTML email templates — Bahasa Indonesia, Lapakin branded (terracotta + warm sand).
All templates return (subject, html, text). Inline CSS only per Resend best-practice."""
import os

BRAND = "#C04A3B"       # terracotta
INK = "#1A1A1A"
MUTED = "#5C5C5C"
SAND = "#FDFBF7"
LINE = "#E8E2D8"


def _public_app_url() -> str:
    return os.environ.get("PUBLIC_APP_URL", "https://lapakin.my.id").rstrip("/")


def _base_layout(headline: str, body_html: str, cta_label: str = "", cta_url: str = "") -> str:
    cta_block = ""
    if cta_label and cta_url:
        cta_block = f"""
        <tr><td style="padding:8px 0 24px;">
          <a href="{cta_url}"
             style="display:inline-block;background:{BRAND};color:#fff;
                    text-decoration:none;padding:14px 28px;border-radius:10px;
                    font-weight:700;font-size:15px;letter-spacing:.2px;">
            {cta_label}
          </a>
        </td></tr>"""
    year = 2026
    return f"""<!doctype html>
<html lang="id"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>{headline}</title></head>
<body style="margin:0;padding:0;background:{SAND};
             font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
             color:{INK};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
         style="background:{SAND};padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0"
             style="max-width:560px;background:#FFFFFF;border:1px solid {LINE};
                    border-radius:16px;overflow:hidden;">
        <tr><td style="padding:28px 32px 0;">
          <div style="font-size:22px;font-weight:800;color:{BRAND};
                      letter-spacing:-0.3px;">Lapakin</div>
          <div style="font-size:12px;color:{MUTED};margin-top:2px;">
            AI bikin tokomu cling.
          </div>
        </td></tr>
        <tr><td style="padding:24px 32px 8px;">
          <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;
                     color:{INK};font-weight:800;letter-spacing:-0.3px;">
            {headline}
          </h1>
        </td></tr>
        <tr><td style="padding:0 32px 8px;font-size:15px;line-height:1.6;color:{INK};">
          {body_html}
        </td></tr>
        <tr><td style="padding:0 32px;">{cta_block}</td></tr>
        <tr><td style="padding:0 32px 28px;border-top:1px solid {LINE};margin-top:16px;">
          <p style="margin:18px 0 0;font-size:12px;color:{MUTED};line-height:1.6;">
            Email ini dikirim otomatis dari Lapakin. Jangan balas email ini.<br/>
            © {year} Lapakin · Toko online UMKM Indonesia
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>"""


# ---------- Password Reset ----------
def password_reset(name: str, reset_link: str) -> tuple:
    subject = "Reset password Lapakin kamu"
    body = f"""
      <p>Halo {name or 'teman'},</p>
      <p>Kami terima permintaan reset password untuk akun Lapakin kamu.
         Klik tombol di bawah untuk bikin password baru.
         <strong>Link ini berlaku 60 menit</strong>.</p>
      <p style="font-size:13px;color:{MUTED};">
         Kalau kamu gak ngerasa minta reset, abaikan aja email ini — password kamu
         tetap aman.
      </p>"""
    html = _base_layout(
        "Reset password kamu",
        body,
        cta_label="Reset Password",
        cta_url=reset_link,
    )
    text = (
        f"Halo {name or 'teman'},\n\n"
        f"Kami terima permintaan reset password untuk akun Lapakin kamu.\n"
        f"Buka link ini dalam 60 menit untuk bikin password baru:\n\n"
        f"{reset_link}\n\n"
        f"Kalau kamu gak ngerasa minta reset, abaikan email ini.\n\n"
        f"— Tim Lapakin"
    )
    return subject, html, text


# ---------- Welcome ----------
def welcome(name: str) -> tuple:
    subject = "Selamat datang di Lapakin · Trial Pro 14 hari aktif 🎉"
    dashboard_url = f"{_public_app_url()}/dashboard"
    body = f"""
      <p>Halo {name or 'teman'},</p>
      <p>Makasih udah daftar di Lapakin! Akun kamu aktif dan <strong>Trial Pro 14 hari</strong>
         langsung jalan — akses semua fitur premium gratis sampai kamu yakin.</p>
      <p>3 langkah cepat biar toko kamu bisa online hari ini:</p>
      <ol style="margin:12px 0 16px 20px;padding:0;line-height:1.8;">
        <li>Isi profil toko + upload cover (AI bisa bantu bikin)</li>
        <li>Upload 1 foto produk di AI Studio — biar AI bikin deskripsi + caption IG/TikTok</li>
        <li>Share link toko <code>/toko/slug-kamu</code> ke WhatsApp/IG</li>
      </ol>
      <p style="font-size:13px;color:{MUTED};">
         Butuh bantuan? Balas email ini, tim kami bantuin langsung.
      </p>"""
    html = _base_layout(
        f"Tokomu siap cling, {name or 'Sob'} 🚀",
        body,
        cta_label="Mulai Setup Toko",
        cta_url=dashboard_url,
    )
    text = (
        f"Halo {name or 'teman'},\n\n"
        f"Makasih udah daftar di Lapakin! Trial Pro 14 hari aktif.\n\n"
        f"Mulai setup toko: {dashboard_url}\n\n"
        f"— Tim Lapakin"
    )
    return subject, html, text


# ---------- Trial Expiring ----------
def trial_expiring(name: str, days_left: int) -> tuple:
    subject = f"Trial Pro kamu habis dalam {days_left} hari lagi"
    billing_url = f"{_public_app_url()}/dashboard/billing"
    pricing_url = f"{_public_app_url()}/pricing"
    body = f"""
      <p>Halo {name or 'teman'},</p>
      <p>Heads-up singkat: <strong>Trial Pro kamu habis dalam {days_left} hari lagi</strong>.
         Setelah itu akun kamu otomatis turun ke paket Gratis (max 5 produk, AI terbatas).</p>
      <p>Kalau tokomu udah mulai rame, lanjut Pro biar:</p>
      <ul style="margin:8px 0 16px 20px;padding:0;line-height:1.8;">
        <li>Hingga 100 produk</li>
        <li>AI photo &amp; copy generous</li>
        <li>Branding Lapakin hilang dari storefront</li>
        <li>Analytics &amp; Bulk Card Pack</li>
      </ul>
      <p>Pro cuma Rp 49.000/bulan (atau Rp 490.000/tahun — hemat 2 bulan).</p>
      <p style="font-size:13px;color:{MUTED};">
        Mau diskusi dulu? Balas email ini, kami bantu pilih paket yang pas.
      </p>"""
    html = _base_layout(
        f"Trial habis {days_left} hari lagi ⏰",
        body,
        cta_label="Lanjut ke Pro",
        cta_url=pricing_url,
    )
    text = (
        f"Halo {name or 'teman'},\n\n"
        f"Trial Pro kamu habis dalam {days_left} hari lagi. Lanjut Pro biar fitur gak ilang:\n"
        f"{pricing_url}\n\n"
        f"Cek billing: {billing_url}\n\n"
        f"— Tim Lapakin"
    )
    return subject, html, text


# ---------- Product via WA ----------
def product_created_via_wa(name: str, product_name: str, price: int,
                           stock: int, shop_slug: str) -> tuple:
    subject = f"Produk baru tayang via WhatsApp: {product_name}"
    shop_url = f"{_public_app_url()}/toko/{shop_slug}"
    price_str = f"Rp {int(price):,}".replace(",", ".")
    body = f"""
      <p>Halo {name or 'teman'},</p>
      <p>Produk baru dari WhatsApp udah tayang di tokomu:</p>
      <table role="presentation" cellpadding="0" cellspacing="0"
             style="width:100%;border:1px solid {LINE};border-radius:12px;
                    padding:16px;margin:12px 0;">
        <tr><td style="font-size:16px;font-weight:700;color:{INK};">{product_name}</td></tr>
        <tr><td style="font-size:14px;color:{BRAND};font-weight:700;padding-top:4px;">
          {price_str}
        </td></tr>
        <tr><td style="font-size:13px;color:{MUTED};padding-top:2px;">
          Stok: {stock} · Sumber: WhatsApp Bot
        </td></tr>
      </table>
      <p style="font-size:13px;color:{MUTED};">
         Mau edit deskripsi/caption AI? Buka dashboard Lapakin → Produk → Edit.
      </p>"""
    html = _base_layout(
        "Produk baru tayang 🎉",
        body,
        cta_label="Lihat di Toko",
        cta_url=shop_url,
    )
    text = (
        f"Halo {name or 'teman'},\n\n"
        f"Produk baru tayang via WhatsApp:\n"
        f"{product_name} — {price_str} (stok {stock})\n\n"
        f"Lihat: {shop_url}\n\n"
        f"— Tim Lapakin"
    )
    return subject, html, text
