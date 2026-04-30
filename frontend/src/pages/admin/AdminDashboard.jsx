import { useEffect, useState } from "react";
import api from "@/lib/api";
import AdminLayout from "@/components/AdminLayout";
import AdminLLMStatusCard from "@/components/AdminLLMStatusCard";
import { Users, Store, Package, Sparkles } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    (async () => {
      const { data } = await api.get("/admin/stats");
      setStats(data);
    })();
  }, []);

  if (!stats) {
    return <AdminLayout title="Overview"><div className="text-brand-mute" data-testid="admin-stats-loading">Memuat statistik…</div></AdminLayout>;
  }

  return (
    <AdminLayout title="Overview" subtitle="Ringkasan kesehatan platform Lapakin.">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Stat label="Total Pengguna" value={stats.users.total} delta={`+${stats.users.last_7d} minggu ini`} icon={<Users className="w-5 h-5" />} tid="stat-users" />
        <Stat label="Toko Aktif" value={stats.shops.active} delta={`${stats.shops.suspended} suspended`} icon={<Store className="w-5 h-5" />} tid="stat-shops" />
        <Stat label="Total Produk" value={stats.products.total} delta={`+${stats.products.last_7d} minggu ini`} icon={<Package className="w-5 h-5" />} tid="stat-products" />
        <Stat label="AI Calls" value={stats.ai_usage.total} delta={`+${stats.ai_usage.last_7d} minggu ini`} icon={<Sparkles className="w-5 h-5" />} tid="stat-ai" />
      </div>

      <div className="bg-white border border-brand-line rounded-2xl p-6 shadow-card mb-6">
        <h3 className="font-heading font-bold text-lg">Pertumbuhan 14 Hari Terakhir</h3>
        <p className="text-sm text-brand-mute mt-1">User baru, toko baru, produk baru, dan AI calls per hari.</p>
        <div className="mt-5 h-72" data-testid="admin-growth-chart">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={stats.daily}>
              <CartesianGrid strokeDasharray="3 3" stroke="#EBE7E0" />
              <XAxis dataKey="date" stroke="#7A736E" fontSize={12} />
              <YAxis stroke="#7A736E" fontSize={12} />
              <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #EBE7E0" }} />
              <Legend />
              <Line type="monotone" dataKey="users" stroke="#C04A3B" strokeWidth={2} dot={false} name="Pengguna" />
              <Line type="monotone" dataKey="shops" stroke="#2D5A27" strokeWidth={2} dot={false} name="Toko" />
              <Line type="monotone" dataKey="products" stroke="#F2A65A" strokeWidth={2} dot={false} name="Produk" />
              <Line type="monotone" dataKey="ai_calls" stroke="#7A736E" strokeWidth={2} dot={false} name="AI" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* AI provider health */}
      <AdminLLMStatusCard />
    </AdminLayout>
  );
}

function Stat({ label, value, delta, icon, tid }) {
  return (
    <div className="bg-white border border-brand-line rounded-2xl p-5 shadow-card flex items-center gap-4 card-hover" data-testid={tid}>
      <div className="w-12 h-12 rounded-xl bg-brand-off grid place-items-center text-brand">{icon}</div>
      <div>
        <div className="text-xs uppercase tracking-[0.15em] text-brand-mute font-bold">{label}</div>
        <div className="font-heading font-extrabold text-2xl mt-0.5">{value}</div>
        <div className="text-xs text-brand-mute mt-0.5">{delta}</div>
      </div>
    </div>
  );
}
