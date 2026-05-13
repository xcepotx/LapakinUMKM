/* LAPAKIN_MALL_PHASE1B_ADMIN_MANAGEMENT_V1 */
import { useEffect, useMemo, useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import api, { rupiah } from "@/lib/api";
import { toast } from "sonner";
import {
  CheckCircle2,
  ExternalLink,
  Eye,
  Filter,
  PackagePlus,
  RefreshCw,
  Search,
  ShoppingBag,
  Star,
  Store,
  XCircle,
} from "lucide-react";

function formatPrice(value) {
  try {
    return rupiah(Number(value || 0));
  } catch {
    return `Rp ${Number(value || 0).toLocaleString("id-ID")}`;
  }
}

function statusClass(status) {
  if (status === "approved") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "pending") return "bg-amber-50 text-amber-700 border-amber-200";
  if (status === "rejected") return "bg-red-50 text-red-700 border-red-200";
  return "bg-slate-50 text-slate-600 border-slate-200";
}

function ProductThumb({ src, name }) {
  if (src) {
    return <img src={src} alt={name || "Produk"} className="h-full w-full object-cover" loading="lazy" />;
  }

  return (
    <div className="grid h-full w-full place-items-center bg-brand-off text-brand">
      <ShoppingBag className="h-5 w-5" />
    </div>
  );
}

function SummaryCard({ label, value, tone = "default" }) {
  const toneClass = {
    good: "border-emerald-200 bg-emerald-50 text-emerald-700",
    warn: "border-amber-200 bg-amber-50 text-amber-700",
    danger: "border-red-200 bg-red-50 text-red-700",
    default: "border-brand-line bg-white text-brand-ink",
  }[tone];

  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${toneClass}`}>
      <div className="text-xs font-black uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-1 text-2xl font-black">{Number(value || 0).toLocaleString("id-ID")}</div>
    </div>
  );
}

export default function AdminMall() {
  const [listings, setListings] = useState([]);
  const [summary, setSummary] = useState({});
  const [candidates, setCandidates] = useState([]);
  const [candidateSummary, setCandidateSummary] = useState({});
  const [status, setStatus] = useState("all");
  const [q, setQ] = useState("");
  const [candidateQ, setCandidateQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [savingId, setSavingId] = useState("");

  const approvedCount = summary.approved || 0;

  const params = useMemo(() => ({ status, q, limit: 120 }), [status, q]);

  const loadListings = async () => {
    setLoading(true);
    try {
      const response = await api.get("/admin/mall/listings", { params });
      setListings(response.data?.items || []);
      setSummary(response.data?.summary || {});
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Gagal memuat Mall listings");
    } finally {
      setLoading(false);
    }
  };

  const loadCandidates = async (search = candidateQ) => {
    setCandidateLoading(true);
    try {
      const response = await api.get("/admin/mall/candidate-products", {
        params: { q: search, limit: 80 },
      });
      setCandidates(response.data?.items || []);
      setCandidateSummary(response.data?.summary || {});
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Gagal memuat kandidat produk");
    } finally {
      setCandidateLoading(false);
    }
  };

  useEffect(() => {
    loadListings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.status]);

  useEffect(() => {
    loadCandidates("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitListingsSearch = (event) => {
    event.preventDefault();
    loadListings();
  };

  const submitCandidateSearch = (event) => {
    event.preventDefault();
    loadCandidates(candidateQ);
  };

  const updateListing = async (listingId, patch) => {
    setSavingId(listingId);
    try {
      const response = await api.patch(`/admin/mall/listings/${listingId}`, patch);
      const item = response.data?.item;

      if (item) {
        setListings((current) => current.map((row) => (row.listing_id === listingId ? item : row)));
      }

      toast.success("Listing Mall diupdate");
      loadListings();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Gagal update listing");
    } finally {
      setSavingId("");
    }
  };

  const createListing = async (candidate) => {
    if (!candidate?.product_id) return;

    setSavingId(candidate.product_id);
    try {
      const response = await api.post("/admin/mall/listings", {
        product_id: candidate.product_id,
        status: "approved",
        mall_category: candidate.category || "Pilihan UMKM",
        mall_badge: "",
        mall_rank: 100,
        featured: false,
        highlight: candidate.description || "",
      });

      const item = response.data?.item;
      if (item) {
        setListings((current) => [item, ...current]);
      }

      toast.success("Produk ditambahkan ke Lapakin Mall");
      loadListings();
      loadCandidates(candidateQ);
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Gagal tambah produk ke Mall");
    } finally {
      setSavingId("");
    }
  };

  return (
    <AdminLayout
      title="Lapakin Mall"
      subtitle="Kelola produk unggulan yang tampil di public Mall."
      actions={
        <div className="flex flex-wrap gap-2">
          <a
            href="/mall"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center rounded-xl border border-brand-line bg-white px-4 py-2 text-sm font-black text-brand-ink hover:bg-brand-off"
          >
            <ExternalLink className="mr-2 h-4 w-4" />
            Preview Mall
          </a>

          <button
            type="button"
            onClick={() => {
              loadListings();
              loadCandidates(candidateQ);
            }}
            disabled={loading || candidateLoading}
            className="inline-flex items-center rounded-xl bg-brand px-4 py-2 text-sm font-black text-white hover:bg-brand-dark disabled:opacity-60"
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${loading || candidateLoading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      }
    >
      <div className="space-y-6" data-testid="admin-mall-page">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <SummaryCard label="All" value={summary.all} />
          <SummaryCard label="Approved" value={summary.approved} tone="good" />
          <SummaryCard label="Featured" value={summary.featured} tone="good" />
          <SummaryCard label="Pending" value={summary.pending} tone="warn" />
          <SummaryCard label="Rejected" value={summary.rejected} tone="danger" />
          <SummaryCard label="Hidden" value={summary.hidden} />
        </div>

        <section className="rounded-2xl border border-brand-line bg-white shadow-card" data-testid="admin-mall-listings">
          <div className="border-b border-brand-line p-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <ShoppingBag className="h-5 w-5 text-brand" />
                  <h2 className="font-heading text-xl font-black text-brand-ink">Mall Listings</h2>
                </div>
                <p className="mt-1 text-sm text-brand-mute">
                  {approvedCount} produk approved tampil di public `/mall`.
                </p>
              </div>

              <form onSubmit={submitListingsSearch} className="grid gap-2 md:grid-cols-[180px_1fr_auto] xl:w-[720px]">
                <select
                  value={status}
                  onChange={(event) => setStatus(event.target.value)}
                  className="h-11 rounded-xl border border-brand-line bg-white px-3 text-sm font-bold text-brand-ink outline-none focus:border-brand"
                  data-testid="admin-mall-status-filter"
                >
                  <option value="all">All status</option>
                  <option value="approved">Approved</option>
                  <option value="pending">Pending</option>
                  <option value="rejected">Rejected</option>
                  <option value="hidden">Hidden</option>
                </select>

                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-mute" />
                  <input
                    value={q}
                    onChange={(event) => setQ(event.target.value)}
                    placeholder="Cari listing, kategori, badge..."
                    className="h-11 w-full rounded-xl border border-brand-line bg-white pl-9 pr-3 text-sm font-bold text-brand-ink outline-none focus:border-brand"
                    data-testid="admin-mall-search"
                  />
                </div>

                <button
                  type="submit"
                  className="inline-flex h-11 items-center justify-center rounded-xl bg-brand px-4 text-sm font-black text-white hover:bg-brand-dark"
                >
                  <Filter className="mr-2 h-4 w-4" />
                  Filter
                </button>
              </form>
            </div>
          </div>

          {loading ? (
            <div className="p-12 text-center font-semibold text-brand-mute">Memuat listing...</div>
          ) : listings.length === 0 ? (
            <div className="p-12 text-center">
              <div className="font-heading text-xl font-black text-brand-ink">Belum ada listing</div>
              <p className="mt-2 text-sm text-brand-mute">Tambahkan dari kandidat produk di bawah.</p>
            </div>
          ) : (
            <div className="divide-y divide-brand-line">
              {listings.map((item) => {
                const product = item.product || {};
                const shop = item.shop || {};
                const disabled = savingId === item.listing_id;

                return (
                  <div key={item.listing_id} className="p-5" data-testid={`mall-listing-${item.listing_id}`}>
                    <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
                      <div className="flex min-w-0 gap-4">
                        <div className="h-24 w-24 shrink-0 overflow-hidden rounded-2xl border border-brand-line bg-brand-off">
                          <ProductThumb src={product.image} name={product.name} />
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-black uppercase ${statusClass(item.status)}`}>
                              {item.status || "approved"}
                            </span>
                            {item.featured ? (
                              <span className="inline-flex items-center rounded-full border border-brand bg-brand px-2.5 py-1 text-[11px] font-black uppercase text-white">
                                <Star className="mr-1 h-3 w-3" />
                                Featured
                              </span>
                            ) : null}
                            {!product.active_for_mall || !shop.active_for_mall ? (
                              <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-black uppercase text-red-700">
                                Not eligible
                              </span>
                            ) : null}
                          </div>

                          <div className="mt-2 font-heading text-lg font-black text-brand-ink">{product.name}</div>
                          <div className="mt-1 text-sm font-black text-brand">{formatPrice(product.price)}</div>
                          <div className="mt-1 text-xs font-semibold text-brand-mute">
                            {item.listing_id} · {product.product_id}
                          </div>

                          <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold text-brand-mute">
                            <span className="rounded-full bg-brand-off px-3 py-1">
                              <Store className="mr-1 inline h-3 w-3" />
                              {shop.name} / {shop.slug || "-"}
                            </span>
                            <span className="rounded-full bg-brand-off px-3 py-1">
                              Produk: {product.category || "-"}
                            </span>
                          </div>

                          {item.highlight ? (
                            <p className="mt-3 line-clamp-2 text-sm font-medium leading-relaxed text-brand-mute">
                              {item.highlight}
                            </p>
                          ) : null}
                        </div>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2">
                        <label className="block">
                          <span className="text-xs font-black uppercase text-brand-mute">Status</span>
                          <select
                            value={item.status || "approved"}
                            disabled={disabled}
                            onChange={(event) => updateListing(item.listing_id, { status: event.target.value })}
                            className="mt-1 h-10 w-full rounded-xl border border-brand-line bg-white px-3 text-sm font-bold text-brand-ink"
                          >
                            <option value="approved">Approved</option>
                            <option value="pending">Pending</option>
                            <option value="rejected">Rejected</option>
                            <option value="hidden">Hidden</option>
                          </select>
                        </label>

                        <label className="block">
                          <span className="text-xs font-black uppercase text-brand-mute">Rank</span>
                          <input
                            type="number"
                            defaultValue={item.mall_rank ?? 100}
                            disabled={disabled}
                            onBlur={(event) => updateListing(item.listing_id, { mall_rank: Number(event.target.value || 100) })}
                            className="mt-1 h-10 w-full rounded-xl border border-brand-line bg-white px-3 text-sm font-bold text-brand-ink"
                          />
                        </label>

                        <label className="block">
                          <span className="text-xs font-black uppercase text-brand-mute">Kategori Mall</span>
                          <input
                            defaultValue={item.mall_category || product.category || ""}
                            disabled={disabled}
                            onBlur={(event) => updateListing(item.listing_id, { mall_category: event.target.value })}
                            className="mt-1 h-10 w-full rounded-xl border border-brand-line bg-white px-3 text-sm font-bold text-brand-ink"
                          />
                        </label>

                        <label className="block">
                          <span className="text-xs font-black uppercase text-brand-mute">Badge</span>
                          <input
                            defaultValue={item.mall_badge || ""}
                            disabled={disabled}
                            onBlur={(event) => updateListing(item.listing_id, { mall_badge: event.target.value })}
                            placeholder="Best Seller / Promo"
                            className="mt-1 h-10 w-full rounded-xl border border-brand-line bg-white px-3 text-sm font-bold text-brand-ink"
                          />
                        </label>

                        <label className="md:col-span-2 block">
                          <span className="text-xs font-black uppercase text-brand-mute">Highlight</span>
                          <textarea
                            defaultValue={item.highlight || ""}
                            disabled={disabled}
                            rows={2}
                            onBlur={(event) => updateListing(item.listing_id, { highlight: event.target.value })}
                            className="mt-1 min-h-[72px] w-full rounded-xl border border-brand-line bg-white px-3 py-2 text-sm font-semibold text-brand-ink"
                          />
                        </label>

                        <div className="md:col-span-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => updateListing(item.listing_id, { featured: !item.featured })}
                            disabled={disabled}
                            className={`inline-flex h-10 items-center rounded-xl px-4 text-sm font-black ${
                              item.featured
                                ? "bg-brand text-white hover:bg-brand-dark"
                                : "border border-brand-line bg-white text-brand-ink hover:bg-brand-off"
                            } disabled:opacity-60`}
                          >
                            <Star className="mr-2 h-4 w-4" />
                            {item.featured ? "Unfeatured" : "Set Featured"}
                          </button>

                          <a
                            href="/mall"
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex h-10 items-center rounded-xl border border-brand-line bg-white px-4 text-sm font-black text-brand-ink hover:bg-brand-off"
                          >
                            <Eye className="mr-2 h-4 w-4" />
                            Preview
                          </a>

                          {shop.slug ? (
                            <a
                              href={`/toko/${shop.slug}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex h-10 items-center rounded-xl border border-brand-line bg-white px-4 text-sm font-black text-brand-ink hover:bg-brand-off"
                            >
                              <ExternalLink className="mr-2 h-4 w-4" />
                              Toko
                            </a>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-brand-line bg-white shadow-card" data-testid="admin-mall-candidates">
          <div className="border-b border-brand-line p-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <PackagePlus className="h-5 w-5 text-brand" />
                  <h2 className="font-heading text-xl font-black text-brand-ink">Tambah Produk ke Mall</h2>
                </div>
                <p className="mt-1 text-sm text-brand-mute">
                  {candidateSummary.active_candidates || 0} produk aktif bisa ditambahkan.
                </p>
              </div>

              <form onSubmit={submitCandidateSearch} className="grid gap-2 md:grid-cols-[1fr_auto] xl:w-[520px]">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-mute" />
                  <input
                    value={candidateQ}
                    onChange={(event) => setCandidateQ(event.target.value)}
                    placeholder="Cari produk/toko..."
                    className="h-11 w-full rounded-xl border border-brand-line bg-white pl-9 pr-3 text-sm font-bold text-brand-ink outline-none focus:border-brand"
                    data-testid="admin-mall-candidate-search"
                  />
                </div>

                <button
                  type="submit"
                  className="inline-flex h-11 items-center justify-center rounded-xl bg-brand px-4 text-sm font-black text-white hover:bg-brand-dark"
                >
                  Cari
                </button>
              </form>
            </div>
          </div>

          {candidateLoading ? (
            <div className="p-10 text-center font-semibold text-brand-mute">Memuat kandidat produk...</div>
          ) : candidates.length === 0 ? (
            <div className="p-10 text-center text-brand-mute">Tidak ada kandidat produk.</div>
          ) : (
            <div className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-3">
              {candidates.map((item) => {
                const canAdd = item.active_for_mall && !item.already_listed;
                const disabled = savingId === item.product_id || !canAdd;

                return (
                  <div key={item.product_id} className="rounded-2xl border border-brand-line bg-brand-off/40 p-4" data-testid={`mall-candidate-${item.product_id}`}>
                    <div className="flex gap-3">
                      <div className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl border border-brand-line bg-white">
                        <ProductThumb src={item.image} name={item.name} />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="line-clamp-2 font-heading text-base font-black text-brand-ink">{item.name}</div>
                        <div className="mt-1 text-sm font-black text-brand">{formatPrice(item.price)}</div>
                        <div className="mt-1 truncate text-xs font-semibold text-brand-mute">{item.shop?.name || "-"} · {item.category || "-"}</div>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2 text-xs font-black">
                      {item.already_listed ? (
                        <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-emerald-700">
                          <CheckCircle2 className="mr-1 h-3 w-3" />
                          Sudah listing
                        </span>
                      ) : item.active_for_mall ? (
                        <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-emerald-700">
                          <CheckCircle2 className="mr-1 h-3 w-3" />
                          Eligible
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-red-700">
                          <XCircle className="mr-1 h-3 w-3" />
                          Tidak eligible
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => createListing(item)}
                      disabled={disabled}
                      className="mt-4 inline-flex h-10 w-full items-center justify-center rounded-xl bg-brand px-4 text-sm font-black text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
                      data-testid={`add-mall-candidate-${item.product_id}`}
                    >
                      <PackagePlus className="mr-2 h-4 w-4" />
                      Tambah ke Mall
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </AdminLayout>
  );
}
