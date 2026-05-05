import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Sparkles,
  LayoutDashboard,
  Package,
  BookOpen,
  Settings,
  LogOut,
  ChevronDown,
  ExternalLink,
  MessageSquare,
  CreditCard,
  BarChart3,
} from "lucide-react";

const TIER_BADGE = {
  free: {
    label: "Gratis",
    cls: "bg-brand-off text-brand-mute border-brand-line",
  },
  starter: {
    label: "Starter",
    cls: "bg-emerald-100 text-emerald-900 border-emerald-300",
  },
  pro: {
    label: "Pro",
    cls: "bg-yellow-100 text-yellow-900 border-yellow-300",
  },
  business: {
    label: "Bisnis",
    cls: "bg-purple-100 text-purple-900 border-purple-300",
  },
};

export default function DashboardLayout({ children, shop, title, subtitle, actions }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const isStaff = user?.shop_role === "staff";
  const [shopSwitcher, setShopSwitcher] = useState(null);
  const [switchingShop, setSwitchingShop] = useState(false);

  const mainItems = [
    { to: "/dashboard", icon: LayoutDashboard, label: "Beranda", tid: "nav-home" },
    { to: "/dashboard/products", icon: Package, label: "Produk", tid: "nav-products" },
    { to: "/dashboard/content-studio", icon: Sparkles, label: "Konten", tid: "nav-content-studio" },
    { to: "/dashboard/sales", icon: BookOpen, label: "Buku Jualan", tid: "nav-sales" },
    { to: "/dashboard/whatsapp", icon: MessageSquare, label: "WhatsApp", tid: "nav-whatsapp" },
    { to: "/dashboard/analytics", icon: BarChart3, label: "Analitik", tid: "nav-analytics" },
    { to: "/dashboard/leads", icon: MessageSquare, label: "Leads", tid: "nav-leads" },
  ];

  const secondaryItems = [];

  const items = [...mainItems, ...secondaryItems];

  const tier = user?.tier || "free";
  const badge = TIER_BADGE[tier] || TIER_BADGE.free;

  const badgeLabel = user?.trial && tier === "pro" ? "Trial Pro" : badge.label;
  const badgeClass =
    user?.trial && tier === "pro"
      ? "bg-yellow-50 text-yellow-900 border-yellow-300"
      : badge.cls;

  useEffect(() => {
    if (!user?.shop_id) return;
    api.get("/shops/mine")
      .then((r) => setShopSwitcher(r.data))
      .catch(() => {});
  }, [user?.shop_id]);

  const handleSwitchShop = async (shopId) => {
    if (!shopId || shopId === (shopSwitcher?.active_shop_id || user?.shop_id)) return;

    setSwitchingShop(true);
    try {
      await api.post(`/shops/switch/${shopId}`);
      toast.success("Cabang aktif diganti");
      window.location.href = "/dashboard";
    } catch (e) {
      toast.error(e.response?.data?.detail || "Gagal ganti cabang");
      setSwitchingShop(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate("/");
  };

  const renderNavItem = (it) => {
    const active = location.pathname === it.to;
    const Icon = it.icon;

    return (
      <Link
        key={it.to}
        to={it.to}
        data-testid={it.tid}
        className={`group inline-flex items-center gap-2 rounded-2xl px-3.5 py-2 text-sm font-semibold transition-all ${
          active
            ? "bg-brand-off text-brand shadow-sm ring-1 ring-brand-line"
            : "text-brand-mute hover:bg-brand-off/70 hover:text-brand-ink"
        }`}
      >
        <Icon
          className={`h-4 w-4 transition-colors ${
            active ? "text-brand" : "text-brand-mute group-hover:text-brand"
          }`}
        />
        <span className="whitespace-nowrap">{it.label}</span>
      </Link>
    );
  };

  return (
    <div className="min-h-screen bg-brand-sand">
      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b border-brand-line bg-white/90 shadow-[0_1px_10px_rgba(0,0,0,0.03)] backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-[68px] flex items-center justify-between gap-4">
          <Link to="/dashboard" className="flex items-center gap-2.5 shrink-0">
            <span className="w-9 h-9 rounded-2xl bg-brand grid place-items-center text-white shadow-sm">
              <Sparkles className="w-4 h-4" />
            </span>
            <span className="font-heading font-extrabold text-xl tracking-tight text-brand-ink">
              Lapakin
            </span>
          </Link>
          <div className="hidden lg:flex items-center gap-2">
            <nav className="flex items-center gap-1 rounded-2xl bg-brand-sand/70 p-1">
              {mainItems.map(renderNavItem)}
            </nav>

            <div className="h-8 w-px bg-brand-line mx-1" />

            <nav className="flex items-center gap-1">
              {secondaryItems.map(renderNavItem)}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            {!isStaff && (shopSwitcher?.shops || []).length > 1 && (
              <select
                value={shopSwitcher?.active_shop_id || shop?.shop_id || ""}
                disabled={switchingShop}
                onChange={(e) => handleSwitchShop(e.target.value)}
                className="hidden sm:block h-9 max-w-[180px] rounded-2xl border border-brand-line bg-white px-3 text-xs font-bold text-brand-ink shadow-sm"
                data-testid="shop-switcher"
                title="Pilih cabang aktif"
              >
                {(shopSwitcher?.shops || []).map((s) => (
                  <option key={s.shop_id} value={s.shop_id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}

            {shop?.slug && (
              <Button
                variant="outline"
                size="sm"
                className="hidden rounded-2xl border-brand-line bg-white px-4 font-semibold shadow-sm hover:bg-brand-off sm:inline-flex"
                onClick={() => window.open(`/toko/${shop.slug}`, "_blank")}
                data-testid="view-storefront-btn"
              >
                <ExternalLink className="w-4 h-4 mr-1.5" />
                Lihat Toko
              </Button>
            )}

            <Link
              to="/dashboard/billing"
              className={`hidden rounded-full border px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-wider transition hover:opacity-80 sm:inline-flex ${badgeClass}`}
              data-testid="tier-badge"
            >
              {badgeLabel}
            </Link>

            <div className="relative hidden sm:block">
              <details className="group">
                <summary
                  className="h-10 rounded-2xl bg-brand-off text-brand flex items-center gap-2 px-3 text-xs font-extrabold ring-1 ring-brand-line hover:bg-brand-sand cursor-pointer select-none list-none"
                  title={user?.name || "Akun"}
                  data-testid="account-menu-trigger"
                  style={{ listStyle: "none" }}
                >
                  <span className="w-7 h-7 rounded-full bg-white grid place-items-center ring-1 ring-brand-line">
                    {(user?.name || "U")[0].toUpperCase()}
                  </span>
                  <span className="hidden xl:inline">Akun</span>
                  <ChevronDown className="w-3.5 h-3.5 transition group-open:rotate-180" />
                </summary>

                <div className="absolute right-0 mt-2 w-60 rounded-2xl border border-brand-line bg-white shadow-card overflow-hidden z-50 py-2">
                  <div className="px-4 py-3 border-b border-brand-line">
                    <div className="font-bold text-sm truncate">{user?.name || "Akun"}</div>
                    <div className="text-xs text-brand-mute truncate">{user?.email}</div>
                  </div>

                  <Link
                    to="/dashboard/manual"
                    className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-brand-off"
                    data-testid="account-menu-manual"
                  >
                    <BookOpen className="w-4 h-4 text-brand-mute" />
                    Manual Penggunaan
                  </Link>

                                                      {!isStaff && (
                    <>
                      <Link
                        to="/dashboard/website"
                        className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-brand-off"
                        data-testid="account-menu-website"
                      >
                        <span className="w-4 h-4 text-brand-mute">🌐</span>
                        Tampilan Website
                      </Link>

                      <Link
                        to="/dashboard/settings"
                        className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-brand-off"
                        data-testid="account-menu-settings"
                      >
                        <Settings className="w-4 h-4 text-brand-mute" />
                        Pengaturan Toko
                      </Link>

                      <Link
                        to="/dashboard/billing"
                        className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-brand-off"
                        data-testid="account-menu-billing"
                      >
                        <CreditCard className="w-4 h-4 text-brand-mute" />
                        Akun & Billing
                      </Link>
                    </>
                  )}

<button
                    type="button"
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-left hover:bg-red-50 text-red-700"
                    data-testid="account-menu-logout"
                  >
                    <LogOut className="w-4 h-4" />
                    Keluar
                  </button>
                </div>
              </details>
            </div>
          </div>
        </div>
        {user?.subscription_status === "suspended" && (
          <div className="bg-red-700 text-white text-sm" data-testid="subscription-suspended-banner">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <b>Akun toko sementara ditangguhkan.</b>{" "}
                Paket kamu sudah berakhir. Data toko tetap aman, hubungi admin Lapakin untuk aktivasi ulang.
              </div>
              <a href="/dashboard/billing" className="font-extrabold underline">
                Lihat status paket
              </a>
            </div>
          </div>
        )}

        {user?.role === "admin" && (
          <div className="bg-brand-ink text-white text-xs">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-1.5 flex items-center justify-between">
              <span>👋 Mode Admin aktif</span>
              <Link to="/admin" className="font-bold hover:underline" data-testid="goto-admin-link">Buka Admin Panel →</Link>
            </div>
          </div>
        )}
        {/* Mobile nav */}
        <div className="md:hidden border-t border-brand-line overflow-x-auto">
          <div className="flex gap-1 px-4 py-2">
            {items.map((it) => {
              const active = location.pathname === it.to;
              return (
                <Link
                  key={it.to} to={it.to}
                   className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap ${
                     active ? "bg-brand-off text-brand ring-1 ring-brand-line" : "text-brand-mute"
                   }`}
                >
                  <it.icon className="w-4 h-4" />
                  {it.label}
                </Link>
              );
            })}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {(title || actions) && (
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8">
            <div>
              {title && <h1 className="font-heading font-extrabold text-3xl tracking-tight">{title}</h1>}
              {subtitle && <p className="text-brand-mute mt-1">{subtitle}</p>}
            </div>
            {actions}
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
