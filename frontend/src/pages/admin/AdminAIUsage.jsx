import { useEffect, useState } from "react";
import api from "@/lib/api";
import AdminLayout from "@/components/AdminLayout";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";

export default function AdminAIUsage() {
  const [data, setData] = useState(null);

  useEffect(() => {
    (async () => {
      const r = await api.get("/admin/ai-usage", { params: { days: 30 } });
      setData(r.data);
    })();
  }, []);

  if (!data) return <AdminLayout title="AI Usage"><div className="text-brand-mute">Memuat…</div></AdminLayout>;

  return (
    <AdminLayout title="AI Usage" subtitle="Pemakaian Gemini Nano Banana & GPT untuk hitung biaya LLM.">
      <div className="grid sm:grid-cols-3 gap-4 mb-6">
        <Card label="Image Enhance" value={data.totals.enhance} hint="(Nano Banana)" tid="usage-enhance" />
        <Card label="Content Gen" value={data.totals.content} hint="(Gemini Flash)" tid="usage-content" />
        <Card label="Theme Suggest" value={data.totals.theme} hint="(Gemini Flash)" tid="usage-theme" />
      </div>

      <div className="bg-white border border-brand-line rounded-2xl p-6 shadow-card">
        <h3 className="font-heading font-bold text-lg">Pemakaian {data.days} Hari Terakhir</h3>
        <div className="mt-4 h-72" data-testid="usage-chart">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data.series}>
              <CartesianGrid strokeDasharray="3 3" stroke="#EBE7E0" />
              <XAxis dataKey="date" stroke="#7A736E" fontSize={12} />
              <YAxis stroke="#7A736E" fontSize={12} />
              <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #EBE7E0" }} />
              <Legend />
              <Line type="monotone" dataKey="enhance" stroke="#C04A3B" strokeWidth={2} dot={false} name="Image" />
              <Line type="monotone" dataKey="content" stroke="#2D5A27" strokeWidth={2} dot={false} name="Content" />
              <Line type="monotone" dataKey="theme" stroke="#F2A65A" strokeWidth={2} dot={false} name="Theme" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="mt-6 bg-white border border-brand-line rounded-2xl p-6 shadow-card">
        <h3 className="font-heading font-bold text-lg">Top 10 Pengguna</h3>
        {data.top_users.length === 0 ? (
          <div className="text-sm text-brand-mute py-4">Belum ada pemakaian.</div>
        ) : (
          <table className="w-full text-sm mt-3">
            <thead className="text-left text-brand-mute uppercase text-xs tracking-wider border-b border-brand-line">
              <tr><th className="py-2 pr-3">User</th><th className="py-2">Email</th><th className="py-2 text-right">Calls</th></tr>
            </thead>
            <tbody className="divide-y divide-brand-line">
              {data.top_users.map((u) => (
                <tr key={u.user_id}>
                  <td className="py-2 pr-3 font-semibold">{u.name || "-"}</td>
                  <td className="py-2 text-brand-mute">{u.email}</td>
                  <td className="py-2 text-right font-bold">{u.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </AdminLayout>
  );
}

function Card({ label, value, hint, tid }) {
  return (
    <div className="bg-white border border-brand-line rounded-2xl p-5 shadow-card" data-testid={tid}>
      <div className="text-xs uppercase tracking-[0.15em] text-brand-mute font-bold">{label}</div>
      <div className="font-heading font-extrabold text-3xl mt-1">{value}</div>
      <div className="text-xs text-brand-mute mt-1">{hint}</div>
    </div>
  );
}
