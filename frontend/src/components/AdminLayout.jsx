import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Sparkles, ShieldCheck, Store, Users, Tags, Trash2, Megaphone, ScrollText, Activity, LogOut, ExternalLink, BookOpen, HeartPulse, Server, CreditCard, ClipboardList, Bell, Bug} from "lucide-react";

import api from "@/lib/api";

function AdminNavBadge({ count }) {
  const value = Number(count || 0);
  if (!Number.isFinite(value) || value <= 0) return null;
  return (
    <span className="ml-auto inline-flex min-w-[1.35rem] items-center justify-center rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-extrabold leading-none text-white">
      {value > 99 ? "99+" : value}
    </span>
  );
}

export default function AdminLayout({ children, title, subtitle, actions }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  
  const [adminNavBadges, setAdminNavBadges] = useState({});

  useEffect(() => {
    let alive = true;

    async function loadAdminNavBadges() {
        try {
          // LAPAKIN_ERROR_CENTER_PHASE4B_BADGE_CLEANUP_UI_V4
          const [badgesResponse, errorLogsResponse] = await Promise.allSettled([
            api.get("/admin/nav-badges"),
            api.get("/admin/error-logs", { params: { status: "open", limit: 1 } }),
          ]);

          const baseBadges = badgesResponse.status === "fulfilled"
            ? badgesResponse.value?.data?.badges || {}
            : {};

          const errorLogsOpen = errorLogsResponse.status === "fulfilled"
            ? Number(errorLogsResponse.value?.data?.summary?.open || 0)
            : 0;

          if (alive) {
            setAdminNavBadges({
              ...baseBadges,
              error_logs_open: errorLogsOpen,
            });
          }
        } catch (_err) {
          if (alive) setAdminNavBadges({});
        }
      }

    loadAdminNavBadges();
    const timer = window.setInterval(loadAdminNavBadges, 60000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);
  // LAPAKIN_ADMIN_SIDEBAR_GROUPS_V2
  const navGroups = [
    {
      title: "Utama",
      items: [
        { to: "/admin", icon: ShieldCheck, label: "Overview", tid: "admin-nav-overview" },
        { to: "/admin/shops", icon: Store, label: "Toko UMKM", tid: "admin-nav-shops" },
        { to: "/admin/users", icon: Users, label: "Pengguna", tid: "admin-nav-users" },
      ],
    },
    {
      title: "Operasional",
      items: [
        { label: (<><span>Daily Ops</span><AdminNavBadge count={adminNavBadges.ops} /></>), to: "/admin/ops", icon: Activity, tid: "admin-nav-ops" },
        { label: (<><span>Notifications</span><AdminNavBadge count={adminNavBadges.notifications} /></>), to: "/admin/notifications", icon: Bell, tid: "admin-nav-notifications" },
        { label: (<><span>Onboarding</span><AdminNavBadge count={adminNavBadges.onboarding} /></>), to: "/admin/onboarding", icon: ClipboardList, tid: "admin-nav-onboarding" },
        { label: (<><span>Store Health</span><AdminNavBadge count={adminNavBadges.store_health} /></>), to: "/admin/store-health", icon: Activity, tid: "admin-nav-store-health" },
      ],
    },
    {
      title: "Billing & Monetisasi",
      items: [
        { label: (<><span>Billing</span><AdminNavBadge count={adminNavBadges.billing} /></>), to: "/admin/billing", icon: CreditCard, tid: "admin-nav-billing" },
        { label: (<><span>Payments</span><AdminNavBadge count={adminNavBadges.payments} /></>), to: "/admin/payments", icon: CreditCard, tid: "admin-nav-payments" },
        { to: "/admin/pricing", icon: Tags, label: "Pricing", tid: "admin-nav-pricing" },
      ],
    },
    {
      title: "Konten & AI",
      items: [
        { to: "/admin/products", icon: Trash2, label: "Moderasi Produk", tid: "admin-nav-products" },
        { to: "/admin/broadcasts", icon: Megaphone, label: "Broadcast", tid: "admin-nav-broadcasts" },
        { to: "/admin/ai-usage", icon: Activity, label: "AI Usage", tid: "admin-nav-ai" },
        { to: "/admin/stories", icon: BookOpen, label: "Cerita UMKM", tid: "admin-nav-stories" },
      ],
    },
    {
      title: "Monitoring & Audit",
      items: [
        { to: "/admin/audit", icon: ScrollText, label: "Audit Log", tid: "admin-nav-audit" },
        { to: "/admin/health", icon: HeartPulse, label: "Health Check", tid: "admin-nav-health" },
        { to: "/admin/server", icon: Server, label: "Server Monitor", tid: "admin-nav-server" },
        { label: (<><span>Error Logs</span><AdminNavBadge count={adminNavBadges.error_logs_open} /></>), to: "/admin/error-logs", icon: Bug, tid: "admin-nav-error-logs" },
      ],
    },
  ];

  const handleLogout = async () => { await logout(); navigate("/"); };

  return (
    <div className="min-h-screen bg-brand-sand flex flex-col lg:flex-row">
      {/* Sidebar */}
      <aside className="lg:w-64 bg-brand-ink text-white lg:min-h-screen flex lg:flex-col">
        <div className="px-5 py-5 flex items-center gap-2 lg:border-b border-white/10">
          <span className="w-8 h-8 rounded-xl bg-brand grid place-items-center"><Sparkles className="w-4 h-4" /></span>
          <div>
            <div className="font-heading font-extrabold leading-none">Lapakin</div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-white/60 mt-0.5">Admin</div>
          </div>
        </div>
        <nav className="flex flex-col gap-3 px-3 py-3 overflow-y-auto lg:overflow-visible">

          {/* LAPAKIN_ADMIN_SIDEBAR_GROUPS_V2 */}
          {navGroups.map((group) => (
            <div key={group.title} className="min-w-0">
              <div className="px-3 pb-1 pt-2 text-[10px] font-black uppercase tracking-[0.16em] text-white/35">
                {group.title}
              </div>

              <div className="flex flex-col gap-1">
                {group.items.map((it) => {
                  const active = location.pathname === it.to || (it.to !== "/admin" && location.pathname.startsWith(`${it.to}/`));

                  return (
                    <Link
                      key={it.to}
                      to={it.to}
                      data-testid={it.tid}
                      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold whitespace-nowrap transition-colors ${
                        active ? "bg-white text-brand-ink" : "text-white/70 hover:bg-white/10 hover:text-white"
                      }`}
                    >
                      <it.icon className="h-4 w-4 shrink-0" />
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        {it.label}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
          {/* Mobile-only logout button (sidebar bottom block hidden on mobile) */}
          <button
            onClick={handleLogout}
            className="lg:hidden flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold whitespace-nowrap text-red-300 hover:text-white hover:bg-red-500/30 ml-auto"
            data-testid="admin-logout-btn-mobile">
            <LogOut className="w-4 h-4" />
            <span>Keluar</span>
          </button>
        </nav>
        <div className="lg:mt-auto px-3 pb-4 hidden lg:block">
          <Link to="/" className="flex items-center gap-2 text-xs text-white/60 hover:text-white px-3 py-2">
            <ExternalLink className="w-3.5 h-3.5" /> Lihat Lapakin
          </Link>
          <div className="mt-3 px-3 py-2 rounded-lg bg-white/5">
            <div className="text-xs text-white/60 truncate">{user?.email}</div>
            <button onClick={handleLogout} className="mt-2 flex items-center gap-2 text-xs text-white/80 hover:text-white"
              data-testid="admin-logout-btn">
              <LogOut className="w-3.5 h-3.5" /> Keluar
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 px-5 sm:px-8 py-6 sm:py-10 max-w-7xl">
        {(title || actions) && (
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-7">
            <div>
              {title && <h1 className="font-heading font-extrabold text-2xl sm:text-3xl tracking-tight">{title}</h1>}
              {subtitle && <p className="text-brand-mute mt-1 text-sm">{subtitle}</p>}
            </div>
            {actions}
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
