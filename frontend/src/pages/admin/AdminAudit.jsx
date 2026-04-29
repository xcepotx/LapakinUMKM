import { useEffect, useState } from "react";
import api from "@/lib/api";
import AdminLayout from "@/components/AdminLayout";

const ACTION_LABELS = {
  shop_active: "Aktifkan Toko",
  shop_suspended: "Suspend Toko",
  shop_featured_toggle: "Toggle Featured",
  product_delete: "Hapus Produk",
  user_reset_password: "Reset Password",
  user_tier_change: "Ubah Tier",
  broadcast_create: "Buat Broadcast",
  broadcast_toggle: "Toggle Broadcast",
  broadcast_delete: "Hapus Broadcast",
};

export default function AdminAudit() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await api.get("/admin/audit");
      setLogs(data || []);
      setLoading(false);
    })();
  }, []);

  return (
    <AdminLayout title="Audit Log" subtitle="Riwayat semua aksi admin di platform.">
      <div className="bg-white border border-brand-line rounded-2xl shadow-card overflow-hidden">
        {loading ? <div className="p-8 text-brand-mute">Memuat…</div> : logs.length === 0 ? (
          <div className="p-12 text-center text-brand-mute">Belum ada aksi admin yang ter-log.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-brand-off/60 text-left text-brand-mute uppercase text-xs tracking-wider">
                <tr>
                  <th className="px-5 py-3 font-bold">Waktu</th>
                  <th className="px-5 py-3 font-bold">Admin</th>
                  <th className="px-5 py-3 font-bold">Aksi</th>
                  <th className="px-5 py-3 font-bold">Target</th>
                  <th className="px-5 py-3 font-bold">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-line">
                {logs.map((l) => (
                  <tr key={l.log_id} className="hover:bg-brand-off/30" data-testid={`audit-row-${l.log_id}`}>
                    <td className="px-5 py-3 text-xs text-brand-mute whitespace-nowrap">{new Date(l.timestamp).toLocaleString("id-ID")}</td>
                    <td className="px-5 py-3 text-xs">{l.admin_email}</td>
                    <td className="px-5 py-3">
                      <span className="text-xs font-bold bg-brand-off rounded px-2 py-1">{ACTION_LABELS[l.action] || l.action}</span>
                    </td>
                    <td className="px-5 py-3 text-xs">
                      <span className="text-brand-mute">{l.target_type}/</span>
                      <span className="font-mono">{l.target_id?.slice(0, 16)}…</span>
                    </td>
                    <td className="px-5 py-3 text-xs text-brand-mute">
                      {l.meta && Object.keys(l.meta).length > 0 ? <code>{JSON.stringify(l.meta)}</code> : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
