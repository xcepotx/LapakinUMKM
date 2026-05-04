import { Link } from "react-router-dom";
import { Download, Printer, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import DashboardLayout from "@/components/DashboardLayout";

const sections = [
  {
    title: "1. Login dan Register",
    items: [
      "User bisa login/register dengan email dan Google.",
      "User yang sudah punya toko akan masuk ke dashboard.",
      "User yang belum punya toko akan diarahkan ke onboarding.",
      "Anggota tim yang diundang owner bisa register dengan email undangan dan otomatis masuk ke toko sebagai staff.",
    ],
  },
  {
    title: "2. Dashboard",
    items: [
      "Dashboard menampilkan ringkasan toko, shortcut fitur, status paket, dan ringkasan jualan.",
      "Jika subscription expired, user tetap bisa login tetapi dashboard normal dikunci dan diarahkan ke Billing.",
      "Banner suspended muncul jika paket sudah berakhir.",
    ],
  },
  {
    title: "3. Navbar Dashboard",
    items: [
      "Menu utama: Beranda, Produk, Buku Jualan, WhatsApp, Analitik.",
      "Owner melihat menu Pengaturan dan Akun/Billing.",
      "Staff tidak melihat Pengaturan dan Billing.",
      "Jika owner punya lebih dari satu toko/cabang, dropdown switch toko muncul di bagian atas dashboard.",
    ],
  },
  {
    title: "4. Produk",
    items: [
      "Owner/staff bisa menambah, mengedit, dan menghapus produk sesuai permission.",
      "Produk mendukung foto, nama, mode produk, harga, stok, deskripsi, caption Instagram, dan caption TikTok.",
      "Edit produk sudah memiliki AI generate untuk deskripsi, caption IG, caption TikTok, serta opsi enhancement gambar.",
    ],
  },
  {
    title: "5. Buku Jualan",
    items: [
      "Buku Jualan digunakan untuk mencatat transaksi harian.",
      "Status pembayaran: Lunas, DP/Sebagian, dan Belum Bayar.",
      "Transaksi bisa ditambah, diedit, dihapus, difilter, dan diexport ke CSV.",
      "Dashboard menampilkan ringkasan omzet, transaksi hari ini, belum dibayar, dan produk terlaris.",
    ],
  },
  {
    title: "6. WhatsApp",
    items: [
      "Owner bisa menghubungkan nomor WhatsApp ke akun Lapakin.",
      "Webhook Twilio menerima pesan dan media dari WhatsApp.",
      "Upload produk via WhatsApp mendukung gambar JPG, PNG, WEBP dengan validasi ukuran dan content type.",
    ],
  },
  {
    title: "7. Content Studio dan AI",
    items: [
      "Content Studio membantu membuat konten promosi produk.",
      "AI dapat membantu membuat deskripsi produk, caption Instagram, caption TikTok, dan enhancement gambar.",
      "Kuota mengikuti paket aktif user.",
    ],
  },
  {
    title: "8. Instagram Auto-post",
    items: [
      "Fitur Instagram publish tersedia untuk paket yang mendukung.",
      "Produk bisa diposting ke Instagram jika akun sudah terhubung dan image URL valid.",
    ],
  },
  {
    title: "9. Multi-toko / Cabang",
    items: [
      "Owner bisa membuat beberapa toko/cabang sesuai limit paket.",
      "Toko aktif disimpan di user.shop_id.",
      "Semua halaman dashboard mengikuti toko aktif.",
      "Staff tidak bisa membuat atau mengganti cabang.",
    ],
  },
  {
    title: "10. Anggota Tim",
    items: [
      "Owner bisa mengundang anggota tim berdasarkan email.",
      "Jika email belum terdaftar, undangan masuk sebagai Pending.",
      "Saat user register/login dengan email undangan, user otomatis masuk sebagai staff toko.",
      "Owner bisa menghapus staff atau membatalkan undangan pending.",
    ],
  },
  {
    title: "11. Owner dan Staff Permission",
    items: [
      "Owner memiliki akses penuh ke toko.",
      "Staff bisa mengakses operasional toko sesuai menu yang diizinkan.",
      "Staff tidak bisa mengelola Billing, Pengaturan toko, Team Members, custom domain, atau multi-cabang.",
    ],
  },
  {
    title: "12. Pricing 4 Tier",
    items: [
      "Tier 1: Gratis, harga Rp0.",
      "Tier 2: Starter.",
      "Tier 3: Pro.",
      "Tier 4: Bisnis.",
      "Harga paket bisa diatur admin dari menu Admin Pricing.",
      "Halaman Pricing, Billing, dan payment plan membaca harga dinamis dari setting admin.",
    ],
  },
  {
    title: "13. Billing dan Subscription",
    items: [
      "Billing menampilkan tier saat ini, status trial, status subscription, penggunaan kuota, dan fitur aktif.",
      "Jika paket berbayar expired, tier tidak otomatis turun ke Free.",
      "Akun/toko menjadi suspended agar data produk, cabang, staff, dan sales tetap aman.",
      "User diarahkan ke Billing dan diminta menghubungi admin untuk aktivasi ulang.",
    ],
  },
  {
    title: "14. Admin Panel",
    items: [
      "Admin bisa melihat overview, toko UMKM, pengguna, moderasi produk, broadcast, AI usage, cerita UMKM, audit log, health check, server monitor, dan pricing.",
      "Admin Users menampilkan tier, toko, tipe akun, serta bisa update tier user.",
      "Admin Pricing digunakan untuk mengatur harga tier 1 sampai tier 4.",
      "Tier 1 selalu Rp0 dan dikunci.",
    ],
  },
  {
    title: "15. Storefront / Lihat Toko",
    items: [
      "Tombol Lihat Toko membuka storefront dari sisi pembeli.",
      "Pembeli bisa melihat profil toko, daftar produk, foto, harga, dan tombol order via WhatsApp.",
      "Tenant storefront mendukung subdomain toko.",
    ],
  },
  {
    title: "16. Checklist Testing Manual",
    items: [
      "Login email dan Google berhasil.",
      "Register user baru berhasil.",
      "Invite staff berhasil dan staff tidak perlu membuat toko.",
      "Produk bisa dibuat/edit/hapus.",
      "Buku Jualan bisa tambah/edit/hapus/export transaksi.",
      "Multi-cabang bisa dibuat dan toko aktif bisa diganti.",
      "Billing tidak menampilkan karakter JSX aneh.",
      "Harga Pricing/Billing mengikuti Admin Pricing.",
      "Subscription expired berubah ke suspended, bukan downgrade Free.",
    ],
  },
];

export default function Manual() {
  const pdfUrl = "/manual/lapakin-manual.pdf";

  return (
    <DashboardLayout
      title="Manual Penggunaan"
      subtitle="Panduan fitur Lapakin untuk owner, staff, dan admin."
      actions={(
        <div className="flex items-center gap-2">
          <Button
            asChild
            variant="outline"
            className="rounded-xl border-brand-line"
          >
            <a href="/manual/lapakin-manual.pdf" download>
              <Download className="w-4 h-4 mr-2" />
              Download PDF
            </a>
          </Button>

          <Button
            onClick={() => window.print()}
            className="rounded-xl bg-brand hover:bg-brand-hover text-white"
          >
            <Printer className="w-4 h-4 mr-2" />
            Cetak
          </Button>
        </div>
      )}
    >
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
          .manual-card { box-shadow: none !important; border-color: #ddd !important; break-inside: avoid; }
        }
      `}</style>

      <div className="max-w-5xl">

<section className="bg-white border border-brand-line rounded-3xl shadow-card p-8 sm:p-10 mb-6">
          <div className="text-xs font-extrabold uppercase tracking-[0.2em] text-brand">
            Panduan Penggunaan
          </div>
          <h1 className="font-heading font-extrabold text-4xl sm:text-5xl mt-3">
            Manual Penggunaan Lapakin
          </h1>
          <p className="text-brand-mute mt-4 max-w-3xl leading-relaxed">
            Manual ini menjelaskan cara menggunakan fitur utama Lapakin, mulai dari login,
            toko online, produk, Buku Jualan, AI, WhatsApp, anggota tim, multi-cabang,
            billing, subscription, sampai admin panel.
          </p>

          <div className="mt-6 grid sm:grid-cols-3 gap-3 text-sm">
            <div className="rounded-2xl bg-brand-off border border-brand-line p-4">
              <div className="font-bold">Untuk User</div>
              <div className="text-brand-mute mt-1">Panduan operasional toko harian.</div>
            </div>
            <div className="rounded-2xl bg-brand-off border border-brand-line p-4">
              <div className="font-bold">Untuk Owner</div>
              <div className="text-brand-mute mt-1">Kelola cabang, staff, paket, dan billing.</div>
            </div>
            <div className="rounded-2xl bg-brand-off border border-brand-line p-4">
              <div className="font-bold">Untuk Admin</div>
              <div className="text-brand-mute mt-1">Kelola user, tier, pricing, dan monitor server.</div>
            </div>
          </div>
        </section>

        <div className="grid gap-4">
          {sections.map((section) => (
            <section key={section.title} className="manual-card bg-white border border-brand-line rounded-2xl shadow-card p-6">
              <h2 className="font-heading font-extrabold text-xl">{section.title}</h2>
              <ul className="mt-4 space-y-2">
                {section.items.map((item) => (
                  <li key={item} className="flex gap-2 text-sm leading-relaxed text-brand-mute">
                    <CheckCircle2 className="w-4 h-4 text-brand shrink-0 mt-0.5" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

      </div>
    </DashboardLayout>
  );
}
