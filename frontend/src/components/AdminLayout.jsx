import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import {
  Sparkles, ShieldCheck, Store, Users, Trash2, Megaphone, ScrollText,
  Activity, LogOut, ExternalLink, BookOpen, HeartPulse,
} from "lucide-react";

export default function AdminLayout({ children, title, subtitle, actions }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const items = [
    { to: "/admin", icon: ShieldCheck, label: "Overview", tid: "admin-nav-overview" },
    { to: "/admin/shops", icon: Store, label: "Toko UMKM", tid: "admin-nav-shops" },
    { to: "/admin/users", icon: Users, label: "Pengguna", tid: "admin-nav-users" },
    { to: "/admin/products", icon: Trash2, label: "Moderasi Produk", tid: "admin-nav-products" },
    { to: "/admin/broadcasts", icon: Megaphone, label: "Broadcast", tid: "admin-nav-broadcasts" },
    { to: "/admin/ai-usage", icon: Activity, label: "AI Usage", tid: "admin-nav-ai" },
    { to: "/admin/stories", icon: BookOpen, label: "Cerita UMKM", tid: "admin-nav-stories" },
    { to: "/admin/audit", icon: ScrollText, label: "Audit Log", tid: "admin-nav-audit" },
    { to: "/admin/health", icon: HeartPulse, label: "Health Check", tid: "admin-nav-health" },
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
        <nav className="flex lg:flex-col gap-0.5 lg:gap-1 px-3 py-3 overflow-x-auto lg:overflow-visible">
          {items.map((it) => {
            const active = location.pathname === it.to;
            return (
              <Link key={it.to} to={it.to} data-testid={it.tid}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-colors ${
                  active ? "bg-white text-brand-ink" : "text-white/70 hover:text-white hover:bg-white/10"
                }`}>
                <it.icon className="w-4 h-4" />
                <span>{it.label}</span>
              </Link>
            );
          })}
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
