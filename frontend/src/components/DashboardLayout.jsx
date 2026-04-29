import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Sparkles, LayoutDashboard, Wand2, Package, Settings, LogOut, ExternalLink, MessageSquare } from "lucide-react";

export default function DashboardLayout({ children, shop, title, subtitle, actions }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const items = [
    { to: "/dashboard", icon: LayoutDashboard, label: "Beranda", tid: "nav-home" },
    { to: "/dashboard/ai-studio", icon: Wand2, label: "AI Studio", tid: "nav-ai-studio" },
    { to: "/dashboard/products", icon: Package, label: "Produk", tid: "nav-products" },
    { to: "/dashboard/whatsapp", icon: MessageSquare, label: "WhatsApp", tid: "nav-whatsapp" },
    { to: "/dashboard/settings", icon: Settings, label: "Pengaturan", tid: "nav-settings" },
  ];

  const handleLogout = async () => {
    await logout();
    navigate("/");
  };

  return (
    <div className="min-h-screen bg-brand-sand">
      {/* Top bar */}
      <header className="sticky top-0 z-40 bg-white/85 backdrop-blur-xl border-b border-brand-line">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          <Link to="/dashboard" className="flex items-center gap-2 shrink-0">
            <span className="w-8 h-8 rounded-xl bg-brand grid place-items-center text-white"><Sparkles className="w-4 h-4" /></span>
            <span className="font-heading font-extrabold text-lg">Lapakin</span>
          </Link>
          <div className="hidden md:flex items-center gap-1">
            {items.map((it) => {
              const active = location.pathname === it.to;
              return (
                <Link
                  key={it.to} to={it.to} data-testid={it.tid}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
                    active ? "bg-brand-off text-brand" : "text-brand-mute hover:text-brand-ink hover:bg-brand-off"
                  }`}
                >
                  <it.icon className="w-4 h-4" />
                  {it.label}
                </Link>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            {shop?.slug && (
              <Button
                variant="outline" size="sm"
                className="rounded-xl border-brand-line hidden sm:inline-flex"
                onClick={() => window.open(`/toko/${shop.slug}`, "_blank")}
                data-testid="view-storefront-btn"
              >
                <ExternalLink className="w-4 h-4 mr-1" /> Lihat Toko
              </Button>
            )}
            <div className="hidden sm:flex items-center gap-2 text-sm">
              <div className="w-8 h-8 rounded-full bg-brand-off grid place-items-center text-xs font-bold text-brand">
                {(user?.name || "U")[0].toUpperCase()}
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={handleLogout} className="rounded-xl" data-testid="dashboard-logout-btn">
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
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
                    active ? "bg-brand-off text-brand" : "text-brand-mute"
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
