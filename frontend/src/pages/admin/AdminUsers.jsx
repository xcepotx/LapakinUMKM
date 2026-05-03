import { useEffect, useMemo, useState } from "react";
import api, { formatApiError } from "@/lib/api";
import AdminLayout from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Crown, KeyRound, Search, Save, ShieldCheck, Store, UserCog, Users } from "lucide-react";
import { toast } from "sonner";

const TIER_OPTIONS = [
  { value: "free", label: "Free" },
  { value: "starter", label: "Starter" },
  { value: "pro", label: "Pro" },
  { value: "business", label: "Business" },
];

const TIER_CLASS = {
  free: "bg-brand-off text-brand-mute border-brand-line",
  starter: "bg-emerald-50 text-emerald-800 border-emerald-200",
  pro: "bg-yellow-50 text-yellow-900 border-yellow-200",
  business: "bg-purple-50 text-purple-900 border-purple-200",
};

const ACCOUNT_TYPE = {
  admin: {
    label: "Admin",
    cls: "bg-red-50 text-red-800 border-red-200",
    icon: ShieldCheck,
  },
  owner: {
    label: "Owner",
    cls: "bg-brand-off text-brand border-brand-line",
    icon: Store,
  },
  staff: {
    label: "Staff",
    cls: "bg-sky-50 text-sky-800 border-sky-200",
    icon: Users,
  },
  user: {
    label: "User",
    cls: "bg-white text-brand-mute border-brand-line",
    icon: UserCog,
  },
};

function TierBadge({ tier }) {
  const key = tier || "free";
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-extrabold uppercase ${TIER_CLASS[key] || TIER_CLASS.free}`}>
      {key}
    </span>
  );
}

function AccountTypeBadge({ type }) {
  const meta = ACCOUNT_TYPE[type || "user"] || ACCOUNT_TYPE.user;
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-extrabold uppercase ${meta.cls}`}>
      <Icon className="w-3 h-3" />
      {meta.label}
    </span>
  );
}

export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [resetLink, setResetLink] = useState("");
  const [tierDrafts, setTierDrafts] = useState({});
  const [savingTierFor, setSavingTierFor] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async (query = q) => {
    setLoading(true);
    try {
      const { data } = await api.get("/admin/users", { params: { q: query } });
      const rows = Array.isArray(data) ? data : (data.items || []);
      setUsers(rows);
      setTierDrafts((prev) => {
        const next = { ...prev };
        rows.forEach((u) => {
          if (!next[u.user_id]) next[u.user_id] = u.tier || "free";
        });
        return next;
      });
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Gagal memuat user");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setTierDraft = (userId, tier) => {
    setTierDrafts((prev) => ({ ...prev, [userId]: tier }));
  };

  const saveTier = async (u) => {
    const tier = tierDrafts[u.user_id] || u.tier || "free";

    if (!TIER_OPTIONS.some((t) => t.value === tier)) {
      toast.error("Tier tidak valid");
      return;
    }

    setSavingTierFor(u.user_id);
    try {
      await api.put(`/admin/users/${u.user_id}/tier`, { tier });
      setUsers((arr) => arr.map((x) => x.user_id === u.user_id ? { ...x, tier } : x));
      toast.success(`Tier ${u.email} → ${tier}`);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Gagal update tier");
    } finally {
      setSavingTierFor("");
    }
  };

  const resetPw = async (u) => {
    try {
      const { data } = await api.post(`/admin/users/${u.user_id}/reset-password`);
      setResetLink(data.reset_link || data.link || "");
      toast.success("Reset link dibuat");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Gagal membuat reset password");
    }
  };

  const submitSearch = (e) => {
    e.preventDefault();
    setQ(search);
    load(search);
  };

  const stats = useMemo(() => {
    return {
      total: users.length,
      owner: users.filter((u) => u.account_type === "owner").length,
      staff: users.filter((u) => u.account_type === "staff").length,
      admin: users.filter((u) => u.account_type === "admin").length,
    };
  }, [users]);

  return (
    <AdminLayout title="Pengguna" subtitle="Daftar semua user, kelola tier, tipe akun, dan reset password.">
      <div className="grid sm:grid-cols-4 gap-3 mb-5">
        <div className="bg-white border border-brand-line rounded-2xl p-4 shadow-card">
          <div className="text-xs text-brand-mute font-bold uppercase">Total</div>
          <div className="text-2xl font-heading font-extrabold mt-1">{stats.total}</div>
        </div>
        <div className="bg-white border border-brand-line rounded-2xl p-4 shadow-card">
          <div className="text-xs text-brand-mute font-bold uppercase">Owner</div>
          <div className="text-2xl font-heading font-extrabold mt-1">{stats.owner}</div>
        </div>
        <div className="bg-white border border-brand-line rounded-2xl p-4 shadow-card">
          <div className="text-xs text-brand-mute font-bold uppercase">Staff</div>
          <div className="text-2xl font-heading font-extrabold mt-1">{stats.staff}</div>
        </div>
        <div className="bg-white border border-brand-line rounded-2xl p-4 shadow-card">
          <div className="text-xs text-brand-mute font-bold uppercase">Admin</div>
          <div className="text-2xl font-heading font-extrabold mt-1">{stats.admin}</div>
        </div>
      </div>

      <div className="bg-white border border-brand-line rounded-2xl shadow-card overflow-hidden">
        <form onSubmit={submitSearch} className="p-4 border-b border-brand-line flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-brand-mute" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari email atau nama..."
              className="pl-10 rounded-xl border-brand-line h-11"
              data-testid="admin-users-search"
            />
          </div>
          <Button type="submit" variant="outline" className="rounded-xl border-brand-line h-11" data-testid="admin-users-search-btn">
            Cari
          </Button>
        </form>

        {resetLink && (
          <div className="p-4 bg-amber-50 border-b border-amber-200" data-testid="admin-reset-link-card">
            <div className="text-sm font-bold text-amber-900">Reset password link</div>
            <div className="mt-1 text-xs break-all text-amber-900">{resetLink}</div>
          </div>
        )}

        {loading ? (
          <div className="p-10 text-center text-brand-mute">Memuat user…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-brand-off/50 text-xs uppercase text-brand-mute">
                <tr>
                  <th className="text-left px-5 py-3">User</th>
                  <th className="text-left px-5 py-3">Auth</th>
                  <th className="text-left px-5 py-3">Tier</th>
                  <th className="text-left px-5 py-3">Toko</th>
                  <th className="text-left px-5 py-3">Tipe Akun</th>
                  <th className="text-right px-5 py-3">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-line">
                {users.map((u) => {
                  const currentDraft = tierDrafts[u.user_id] || u.tier || "free";
                  const tierChanged = currentDraft !== (u.tier || "free");
                  const canResetPw = (u.auth_provider || "email") === "email" || (u.auth_provider || "") === "both";

                  return (
                    <tr key={u.user_id} className="hover:bg-brand-off/30" data-testid={`admin-user-row-${u.user_id}`}>
                      <td className="px-5 py-4">
                        <div className="font-bold text-brand-ink">{u.name || "-"}</div>
                        <div className="text-xs text-brand-mute">{u.email}</div>
                      </td>
                      <td className="px-5 py-4 text-xs">{u.auth_provider || "email"}</td>
                      <td className="px-5 py-4">
                        <TierBadge tier={u.tier} />
                      </td>
                      <td className="px-5 py-4">
                        {u.shop_linked ? (
                          <div className="min-w-[160px]">
                            <div className="font-semibold text-brand-ink truncate">{u.shop_name || "Toko"}</div>
                            <div className="text-xs text-brand-mute truncate">/{u.shop_slug || "-"}</div>
                          </div>
                        ) : (
                          <span className="text-brand-mute">-</span>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <AccountTypeBadge type={u.account_type} />
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex justify-end items-center gap-2">
                          <select
                            value={currentDraft}
                            onChange={(e) => setTierDraft(u.user_id, e.target.value)}
                            className="h-9 rounded-xl border border-brand-line bg-white px-2 text-xs font-bold"
                            data-testid={`tier-select-${u.user_id}`}
                          >
                            {TIER_OPTIONS.map((t) => (
                              <option key={t.value} value={t.value}>{t.label}</option>
                            ))}
                          </select>

                          <Button
                            variant={tierChanged ? "default" : "outline"}
                            size="sm"
                            onClick={() => saveTier(u)}
                            disabled={savingTierFor === u.user_id || !tierChanged}
                            className={tierChanged ? "bg-brand text-white hover:bg-brand-hover rounded-xl" : "rounded-xl border-brand-line"}
                            data-testid={`tier-save-${u.user_id}`}
                          >
                            {savingTierFor === u.user_id ? (
                              "..."
                            ) : (
                              <>
                                <Save className="w-3.5 h-3.5 mr-1" /> Simpan
                              </>
                            )}
                          </Button>

                          {canResetPw && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => resetPw(u)}
                              className="rounded-xl"
                              data-testid={`reset-pw-${u.user_id}`}
                            >
                              <KeyRound className="w-3.5 h-3.5 mr-1" /> Reset PW
                            </Button>
                          )}

                          {u.tier !== "free" && (
                            <span title="Paid tier">
                              <Crown className="w-4 h-4 text-brand" />
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {users.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-10 text-center text-brand-mute">
                      Tidak ada user ditemukan.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
