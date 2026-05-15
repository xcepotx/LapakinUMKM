import { toast as downgradeToast } from "sonner";
import apiDowngradeResolution from "@/lib/api";
import {useEffect, useState} from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Calendar,
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
  BarChart3, ShoppingBag} from "lucide-react";
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


/* LAPAKIN_DOWNGRADE_SHOP_RESOLUTION_PHASE_B_OVERLAY_V3 */
function DowngradeShopResolutionPanel({ resolution, onSelect, selectingShopId }) {
  const shops = resolution?.shops || [];
  const tier = resolution?.tier || {};
  const summary = resolution?.summary || {};

  return (
    <div className="min-h-[70vh] bg-[#FBF7F1] px-4 py-8 text-brand-ink sm:px-6">
      <div className="mx-auto max-w-5xl">
        <div className="rounded-[2rem] border border-brand-line bg-white p-6 shadow-card sm:p-8">
          <div className="inline-flex rounded-full bg-amber-50 px-4 py-2 text-xs font-black uppercase tracking-wide text-amber-700">
            Paket berubah
          </div>

          <h1 className="mt-4 font-heading text-3xl font-black leading-tight text-brand-ink sm:text-4xl">
            Pilih 1 toko yang ingin kamu kelola
          </h1>

          <p className="mt-3 max-w-3xl text-sm font-semibold leading-relaxed text-brand-mute sm:text-base">
            Paket kamu saat ini hanya mendukung {summary.shop_limit || 1} toko aktif.
            Pilih satu toko utama untuk tetap dikelola. Toko lain tidak dihapus,
            hanya ditangguhkan karena batas paket dan bisa diaktifkan kembali saat upgrade.
          </p>

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-brand-line bg-brand-off/60 p-4">
              <div className="text-xs font-black uppercase text-brand-mute">Plan</div>
              <div className="mt-1 text-xl font-black text-brand-ink">{tier.plan || "free"}</div>
            </div>
            <div className="rounded-2xl border border-brand-line bg-brand-off/60 p-4">
              <div className="text-xs font-black uppercase text-brand-mute">Status</div>
              <div className="mt-1 text-xl font-black text-brand-ink">{tier.status || "unknown"}</div>
            </div>
            <div className="rounded-2xl border border-brand-line bg-brand-off/60 p-4">
              <div className="text-xs font-black uppercase text-brand-mute">Total toko</div>
              <div className="mt-1 text-xl font-black text-brand-ink">{summary.total || shops.length}</div>
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {shops.map((shop) => {
            const busy = selectingShopId === shop.shop_id;
            const disabled = busy || shop.status === "deleted";

            return (
              <article
                key={shop.shop_id}
                className="rounded-[1.5rem] border border-brand-line bg-white p-5 shadow-card"
                data-testid={`downgrade-shop-option-${shop.shop_id}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="font-heading text-xl font-black text-brand-ink">
                      {shop.name || "Toko"}
                    </h2>
                    <p className="mt-1 text-sm font-semibold text-brand-mute">
                      /toko/{shop.slug || "-"}
                    </p>
                  </div>

                  <span
                    className={`shrink-0 rounded-full px-3 py-1 text-xs font-black uppercase ${
                      shop.tier_suspended
                        ? "bg-slate-100 text-slate-600"
                        : shop.manageable
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-amber-50 text-amber-700"
                    }`}
                  >
                    {shop.tier_suspended ? "tertangguhkan" : shop.manageable ? "aktif" : shop.status || "status"}
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-2xl bg-brand-off p-3">
                    <div className="text-xs font-black uppercase text-brand-mute">Produk</div>
                    <div className="mt-1 text-lg font-black text-brand-ink">{shop.product_count || 0}</div>
                  </div>
                  <div className="rounded-2xl bg-brand-off p-3">
                    <div className="text-xs font-black uppercase text-brand-mute">Kategori</div>
                    <div className="mt-1 truncate text-sm font-black text-brand-ink">
                      {shop.business_type || "-"}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onSelect(shop.shop_id)}
                  className="mt-5 inline-flex h-12 w-full items-center justify-center rounded-2xl bg-brand px-4 text-sm font-black text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
                  data-testid={`select-downgrade-shop-${shop.shop_id}`}
                >
                  {busy ? "Memproses..." : "Pilih toko ini"}
                </button>
              </article>
            );
          })}
        </div>

        <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold leading-relaxed text-amber-900">
          Catatan: toko yang tidak dipilih tetap tersimpan. Statusnya menjadi <b>tier_suspended</b>,
          bukan dihapus. Saat paket di-upgrade lagi, toko tersebut bisa diaktifkan kembali.
        </div>
      </div>
    </div>
  );
}



// LAPAKIN_SHOP_SWITCHER_DATA_FILTER_V1
function filterManageableSwitcherShops(payload) {
  const rows = Array.isArray(payload?.shops) ? payload.shops : [];

  return {
    ...payload,
    shops: rows.filter((shop) => {
      const status = String(shop?.status || "active").toLowerCase();

      if (!shop?.shop_id) return false;
      if (shop?.tier_suspended === true) return false;

      return ![
        "deleted",
        "removed",
        "inactive",
        "suspended",
        "tier_suspended",
        "admin_suspended",
        "banned",
        "disabled",
      ].includes(status);
    }),
  };
}

export default function DashboardLayout({ children, shop, title, subtitle, actions }) {

  // LAPAKIN_DOWNGRADE_SHOP_RESOLUTION_PHASE_B_OVERLAY_V3
  const [downgradeResolution, setDowngradeResolution] = useState(null);
  const [downgradeResolutionLoading, setDowngradeResolutionLoading] = useState(true);
  const [downgradeSelectingShopId, setDowngradeSelectingShopId] = useState("");

  useEffect(() => {
    let alive = true;

    apiDowngradeResolution.get("/shops/downgrade-resolution")
      .then((response) => {
        if (!alive) 
return;
        setDowngradeResolution(response.data || null);
      })
      .catch(() => {
        if (!alive) return;
        setDowngradeResolution(null);
      })
      .finally(() => {
        if (!alive) return;
        setDowngradeResolutionLoading(false);
      });

    return () => {
      alive = false;
    };
  }, []);

  const handleDowngradeShopSelect = async (shopId) => {
    if (!shopId) return;

    setDowngradeSelectingShopId(shopId);

    try {
      await apiDowngradeResolution.post("/shops/downgrade-resolution/select", { shop_id: shopId });
      downgradeToast.success("Toko utama berhasil dipilih");
      window.location.reload();
    } catch (error) {
      downgradeToast.error(error?.response?.data?.detail || "Gagal memilih toko");
    } finally {
      setDowngradeSelectingShopId("");
    }
  };


  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const isBillingPage = location.pathname === "/dashboard/billing";

  // LAPAKIN_ENFORCE_BILLING_NOTIFICATION_UX_V1
  useEffect(() => {
    if (!isBillingPage) return undefined;

    const applyBillingNotificationUx = () => {
      // Hide duplicate expired-package card inside Billing content.
      // Global red banner already explains the suspended package state.
      const main = document.querySelector("main");

      if (main) {
        const expiredCards = Array.from(
          main.querySelectorAll('[class*="border-red"], [class*="bg-red"], [class*="red-"]')
        );

        expiredCards.forEach((node) => {
          const text = node.textContent || "";
          const isGlobalBanner = Boolean(node.closest('[data-testid="subscription-suspended-banner"]'));

          if (!isGlobalBanner && text.includes("Paket kamu sudah berakhir")) {
            node.style.display = "none";
            node.setAttribute("data-auto-hidden", "duplicate-expired-billing-card");
          }
        });
      }

      // Make manual upgrade notice close button actually work.
      const manualNotice = document.querySelector('[data-testid="manual-tier-payment-card"]');

      if (manualNotice) {
        const dismissed = localStorage.getItem("lapakin.manualUpgradeNoticeDismissed") === "1";

        if (dismissed) {
          manualNotice.style.display = "none";
          return;
        }

        manualNotice.classList.add("relative");

        let closeButton = Array.from(manualNotice.querySelectorAll("button")).find(
          (button) => (button.textContent || "").trim() === "×"
        );

        if (!closeButton) {
          closeButton = document.createElement("button");
          closeButton.type = "button";
          closeButton.textContent = "×";
          closeButton.setAttribute("aria-label", "Tutup notifikasi pembayaran");
          closeButton.className =
            "absolute right-4 top-4 text-sm font-black text-amber-900 hover:opacity-70";
          manualNotice.appendChild(closeButton);
        }

        closeButton.onclick = () => {
          localStorage.setItem("lapakin.manualUpgradeNoticeDismissed", "1");
          manualNotice.style.display = "none";
        };
      }
    };

    applyBillingNotificationUx();
    const t1 = window.setTimeout(applyBillingNotificationUx, 250);
    const t2 = window.setTimeout(applyBillingNotificationUx, 1000);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [isBillingPage]);

  const isStaff = user?.shop_role === "staff";
  const [shopSwitcher, setShopSwitcher] = useState(null);
  const [switchingShop, setSwitchingShop] = useState(false);
  // LAPAKIN_ORDER_INBOX_NAV_BADGE_V1
  const [orderInboxNewCount, setOrderInboxNewCount] = useState(0);

  const mainItems = [
    { to: "/dashboard", icon: LayoutDashboard, label: "Beranda", tid: "nav-home" },
    { to: "/dashboard/products", icon: Package, label: "Produk", tid: "nav-products" },
    { to: "/dashboard/mall", icon: ShoppingBag, label: "Mall", tid: "nav-mall" }, // LAPAKIN_MALL_PHASE1C_TENANT_SUBMIT_V1
    { to: "/dashboard/settings", icon: Settings, label: "Pengaturan Toko", tid: "nav-shop-settings" },
  ];

  const navGroups = [
    {
      label: "Jualan",
      tid: "nav-group-sales",
      children: [
        { to: "/dashboard/sales", icon: BookOpen, label: "Buku Jualan", tid: "nav-sales" },
        // LAPAKIN_DAILY_MENU_IN_SALES_NAV_V1
        { to: "/dashboard/daily-menu", icon: Calendar, label: "Menu Harian", tid: "nav-daily-menu" },
        { to: "/dashboard/leads", icon: MessageSquare, label: "Order Inbox", tid: "nav-leads", badge: orderInboxNewCount },
      ],
    },
    {
      label: "Marketing",
      tid: "nav-group-marketing",
      children: [
        { to: "/dashboard/content-studio", icon: Sparkles, label: "Konten", tid: "nav-content-studio" },
        { to: "/dashboard/analytics", icon: BarChart3, label: "Analitik", tid: "nav-analytics" },
      ],
    },
  ];

  const secondaryItems = [];

  const items = [...mainItems, ...navGroups.flatMap((group) => group.children), ...secondaryItems];

  const tier = user?.tier || "free";
  const badge = TIER_BADGE[tier] || TIER_BADGE.free;

  const badgeLabel = user?.trial && tier === "pro" ? "Trial Pro" : badge.label;
  const badgeClass =
    user?.trial && tier === "pro"
      ? "bg-yellow-50 text-yellow-900 border-yellow-300"
      : badge.cls;

  // LAPAKIN_HIDE_SHOP_SWITCHER_SINGLE_MANAGEABLE_V5
  const shopSwitcherShops = Array.isArray(shopSwitcher?.shops) ? shopSwitcher.shops : [];

  const manageableShopSwitcherShops = shopSwitcherShops.filter((candidateShop) => {
    const status = String(candidateShop?.status || "active").toLowerCase();

    if (!candidateShop?.shop_id) return false;
    if (candidateShop?.tier_suspended === true) return false;

    return ![
      "deleted",
      "removed",
      "inactive",
      "suspended",
      "tier_suspended",
      "admin_suspended",
      "banned",
      "disabled",
    ].includes(status);
  });

  const shouldShowShopSwitcher = manageableShopSwitcherShops.length > 1;


  useEffect(() => {
    if (!user?.shop_id) return;
    api.get("/shops/mine")
      .then((r) => setShopSwitcher(filterManageableSwitcherShops(r.data))) // LAPAKIN_SHOP_SWITCHER_DATA_FILTER_V1
      .catch(() => {});
  }, [user?.shop_id]);

  useEffect(() => {
    if (!user?.shop_id) {
      setOrderInboxNewCount(0);
      return undefined;
    }

    let cancelled = false;

    const loadOrderInboxBadge = async () => {
      try {
        const response = await api.get("/shops/storefront-leads?limit=100");
        if (cancelled) return;

        const leads = response?.data?.leads || [];
        const nextCount = leads.filter((lead) => (lead.status || "new") === "new").length;

        setOrderInboxNewCount(nextCount);
      } catch {
        if (!cancelled) setOrderInboxNewCount(0);
      }
    };

    loadOrderInboxBadge();

    const handleFocus = () => loadOrderInboxBadge();
    window.addEventListener("focus", handleFocus);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", handleFocus);
    };
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
        {Number(it.badge || 0) > 0 ? (
          <span className="ml-1 inline-flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-black leading-none text-white">
            {it.badge > 99 ? "99+" : it.badge}
          </span>
        ) : null}
      </Link>
    );
  };

  const renderNavGroup = (group) => {
    const active = group.children.some((child) => location.pathname === child.to || location.pathname.startsWith(`${child.to}/`));

    return (
      <div key={group.label} className="group relative">
        <button
          type="button"
          data-testid={group.tid}
          className={`group inline-flex items-center gap-2 rounded-2xl px-3.5 py-2 text-sm font-semibold transition-all ${
            active
              ? "bg-brand-off text-brand shadow-sm ring-1 ring-brand-line"
              : "text-brand-mute hover:bg-brand-off/70 hover:text-brand-ink"
          }`}
        >
          <span className="whitespace-nowrap">{group.label}</span>
          <ChevronDown className={`h-4 w-4 transition-colors ${active ? "text-brand" : "text-brand-mute group-hover:text-brand"}`} />
        </button>
        <div className="invisible absolute left-0 top-full z-50 mt-2 min-w-52 translate-y-1 rounded-2xl border border-brand-line bg-white p-2 opacity-0 shadow-xl transition group-hover:visible group-hover:translate-y-0 group-hover:opacity-100">
          {group.children.map((child) => {
            const childActive = location.pathname === child.to || location.pathname.startsWith(`${child.to}/`);
            const ChildIcon = child.icon;
            return (
              <Link
                key={child.to}
                to={child.to}
                data-testid={child.tid}
                className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition ${
                  childActive
                    ? "bg-brand-off text-brand"
                    : "text-brand-ink hover:bg-brand-off/70"
                }`}
              >
                <ChildIcon className={`h-4 w-4 ${childActive ? "text-brand" : "text-brand-mute"}`} />
                <span className="whitespace-nowrap">{child.label}</span>
                {Number(child.badge || 0) > 0 ? (
                  <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-black leading-none text-white">
                    {child.badge > 99 ? "99+" : child.badge}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      </div>
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
              {navGroups.map(renderNavGroup)}
            </nav>

            <div className="h-8 w-px bg-brand-line mx-1" />

            <nav className="flex items-center gap-1">
              {secondaryItems.map(renderNavItem)}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            {!isStaff && manageableShopSwitcherShops.length > 1 && (
<select
                value={shopSwitcher?.active_shop_id || shop?.shop_id || ""}
                disabled={switchingShop}
                onChange={(e) => handleSwitchShop(e.target.value)}
                className="hidden sm:block h-9 max-w-[180px] rounded-2xl border border-brand-line bg-white px-3 text-xs font-bold text-brand-ink shadow-sm"
                data-testid="shop-switcher"
                title="Pilih cabang aktif"
              >
                {manageableShopSwitcherShops.map((s) => (
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
                <b>Paket kamu sudah berakhir. Kamu tetap bisa mengelola 1 toko aktif sesuai batas paket saat ini. Toko lain tetap aman dan ditangguhkan sementara sampai kamu upgrade.</b>
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
        {!downgradeResolutionLoading && downgradeResolution?.needs_resolution ? (
            <DowngradeShopResolutionPanel
              resolution={downgradeResolution}
              onSelect={handleDowngradeShopSelect}
              selectingShopId={downgradeSelectingShopId}
            />
          ) : (
            children
          )}
      </main>
    </div>
  );
}

/* LAPAKIN_EXPIRED_BANNER_COPY_DEV_V1 */

/* LAPAKIN_EXPIRED_BANNER_COPY_DEDUP_DEV_V1 */

/* LAPAKIN_DASHBOARD_EXPIRED_BANNER_ONE_LINE_V1 */

/* LAPAKIN_REPAIR_BROKEN_SELECTOR_PATCH_V1 */

/* LAPAKIN_FIX_ORPHAN_SHOP_SWITCHER_JSX_V1 */

/* LAPAKIN_TIER_SUSPENDED_RESTORE_PHASE_D2_LAYOUT_SAFE_V1 */

/* LAPAKIN_REPAIR_TIER_RESTORE_IMPORT_V1 */

/* LAPAKIN_MOVE_RESTORE_CARD_TO_BILLING_V1 */

/* LAPAKIN_RESTORE_CARD_LAYOUT_ONLY_V1 */

/* LAPAKIN_CENTER_RESTORE_CARD_BILLING_V1 */

/* LAPAKIN_FIX_BILLING_RESTORE_CARD_PLACEMENT_UI_V1 layout cleaned */

/* LAPAKIN_FIX_BILLING_PAGE_CONTAINER_UX_V1 */

/* LAPAKIN_WIDEN_BILLING_PAGE_CONTAINER_V1 */

/* LAPAKIN_FORCE_BILLING_WIDE_CONTAINER_V1 */
