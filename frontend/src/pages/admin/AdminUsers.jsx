import { useEffect, useState } from "react";
import api, { formatApiError } from "@/lib/api";
import AdminLayout from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, KeyRound, Crown, Copy } from "lucide-react";
import { toast } from "sonner";

export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [resetLink, setResetLink] = useState(null);

  const load = async (search = "") => {
    setLoading(true);
    try {
      const { data } = await api.get(`/admin/users`, { params: { q: search } });
      setUsers(data || []);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const setTier = async (u, tier) => {
    try {
      await api.put(`/admin/users/${u.user_id}/tier`, { tier });
      setUsers((arr) => arr.map((x) => x.user_id === u.user_id ? { ...x, tier } : x));
      toast.success(`Tier ${u.email} → ${tier}`);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Gagal"); }
  };

  const generateReset = async (u) => {
    try {
      const { data } = await api.post(`/admin/users/${u.user_id}/reset-password`);
      setResetLink({ email: u.email, url: `${window.location.origin}/reset-password?token=${data.reset_token}` });
    } catch (e) { toast.error("Gagal generate reset link"); }
  };
  const copyReset = () => { navigator.clipboard.writeText(resetLink.url); toast.success("Tersalin"); };

  return (
    <AdminLayout title="Pengguna" subtitle="Daftar semua user, kelola tier dan reset password.">
      <div className="bg-white border border-brand-line rounded-2xl shadow-card overflow-hidden">
        <div className="p-4 border-b border-brand-line flex gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-brand-mute" />
            <Input
              value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && load(q)}
              placeholder="Cari email atau nama…"
              className="pl-10 rounded-xl border-brand-line h-10"
              data-testid="admin-users-search"
            />
          </div>
          <Button onClick={() => load(q)} variant="outline" className="rounded-xl border-brand-line">Cari</Button>
        </div>

        {resetLink && (
          <div className="p-4 bg-amber-50 border-b border-amber-200" data-testid="admin-reset-link-card">
            <div className="text-xs uppercase tracking-wider font-bold text-amber-800">Reset Link untuk {resetLink.email}</div>
            <div className="mt-2 flex gap-2">
              <code className="flex-1 bg-white rounded-lg p-2 text-xs break-all border border-amber-200">{resetLink.url}</code>
              <Button onClick={copyReset} size="sm" variant="outline" className="rounded-xl"><Copy className="w-3.5 h-3.5 mr-1" /> Salin</Button>
              <Button onClick={() => setResetLink(null)} size="sm" variant="ghost">Tutup</Button>
            </div>
            <p className="text-xs text-amber-700 mt-2">Bagikan link ini ke user. Berlaku 1 jam.</p>
          </div>
        )}

        {loading ? <div className="p-8 text-brand-mute">Memuat…</div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-brand-off/60 text-left text-brand-mute uppercase text-xs tracking-wider">
                <tr>
                  <th className="px-5 py-3 font-bold">User</th>
                  <th className="px-5 py-3 font-bold">Auth</th>
                  <th className="px-5 py-3 font-bold">Tier</th>
                  <th className="px-5 py-3 font-bold">Toko</th>
                  <th className="px-5 py-3 font-bold">Role</th>
                  <th className="px-5 py-3 font-bold text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-line">
                {users.map((u) => (
                  <tr key={u.user_id} className="hover:bg-brand-off/30" data-testid={`admin-user-row-${u.user_id}`}>
                    <td className="px-5 py-3">
                      <div className="font-semibold">{u.name || "-"}</div>
                      <div className="text-xs text-brand-mute">{u.email}</div>
                    </td>
                    <td className="px-5 py-3 text-xs">{u.auth_provider}</td>
                    <td className="px-5 py-3">
                      <span className={`text-[10px] font-bold rounded px-2 py-1 ${
                        u.tier === "premium" ? "bg-brand-accent/20 text-brand" : "bg-brand-off text-brand-mute"
                      }`}>{(u.tier || "free").toUpperCase()}</span>
                    </td>
                    <td className="px-5 py-3 text-xs text-brand-mute">{u.shop_id ? "✅" : "-"}</td>
                    <td className="px-5 py-3 text-xs">{u.role || "user"}</td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setTier(u, u.tier === "premium" ? "free" : "premium")}
                          data-testid={`tier-${u.user_id}`}
                          className="text-brand">
                          <Crown className="w-3.5 h-3.5 mr-1" /> {u.tier === "premium" ? "→ Free" : "→ Premium"}
                        </Button>
                        {u.auth_provider !== "google" && (
                          <Button variant="ghost" size="sm" onClick={() => generateReset(u)}
                            data-testid={`reset-${u.user_id}`}>
                            <KeyRound className="w-3.5 h-3.5 mr-1" /> Reset PW
                          </Button>
                        )}
                      </div>
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
