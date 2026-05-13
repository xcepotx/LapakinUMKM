/* LAPAKIN_MALL_PHASE1C_TENANT_SUBMIT_V1 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import DashboardLayout from "@/components/DashboardLayout";
import api, { rupiah } from "@/lib/api";
import { toast } from "sonner";
import {
  TrendingUp,
  MousePointerClick,
  MessageCircle,
  BarChart3,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  RefreshCw,
  Search,
  Send,
  ShoppingBag,
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

function statusMeta(status) {
  const value = status || "not_submitted";

  if (value === "approved") {
    return {
      label: "Approved",
      icon: CheckCircle2,
      cls: "border-emerald-200 bg-emerald-50 text-emerald-700",
      desc: "Produk sudah tampil di Lapakin Mall.",
    };
  }

  if (value === "pending") {
    return {
      label: "Pending Review",
      icon: Clock,
      cls: "border-amber-200 bg-amber-50 text-amber-700",
      desc: "Menunggu admin approve.",
    };
  }

  if (value === "rejected") {
    return {
      label: "Rejected",
      icon: XCircle,
      cls: "border-red-200 bg-red-50 text-red-700",
      desc: "Ditolak admin, bisa diperbaiki lalu submit ulang.",
    };
  }

  if (value === "hidden") {
    return {
      label: "Hidden / Withdrawn",
      icon: XCircle,
      cls: "border-slate-200 bg-slate-50 text-slate-600",
      desc: "Listing sedang tidak tampil di Mall.",
    };
  }

  return {
    label: "Belum Submit",
    icon: ShoppingBag,
    cls: "border-brand-line bg-brand-off text-brand-mute",
    desc: "Produk belum diajukan ke Lapakin Mall.",
  };
}

function ProductThumb({ item }) {
  if (item?.image) {
    return <img src={item.image} alt={item.name || "Produk"} className="h-full w-full object-cover" loading="lazy" />;
  }

  return (
    <div className="grid h-full w-full place-items-center bg-brand-off text-brand">
      <ShoppingBag className="h-8 w-8" />
    </div>
  );
}

export default function TenantMall() {
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState({});
  const [shop, setShop] = useState({});
  const [drafts, setDrafts] = useState({});
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");

  // LAPAKIN_MALL_PHASE1F_ANALYTICS_V1
  const [mallAnalytics, setMallAnalytics] = useState({
    totals: {},
    daily: [],
    top_products: [],
    listing_summary: {},
    conversion_rate: 0,
  });
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  // LAPAKIN_MALL_PHASE1F_ANALYTICS_V1
  const loadMallAnalytics = async () => {
    setAnalyticsLoading(true);

    try {
      const response = await api.get("/mall/my-analytics", { params: { days: 30, limit: 10 } });
      setMallAnalytics(response.data || {
        totals: {},
        daily: [],
        top_products: [],
        listing_summary: {},
        conversion_rate: 0,
      });
    } catch {
      setMallAnalytics({
        totals: {},
        daily: [],
        top_products: [],
        listing_summary: {},
        conversion_rate: 0,
      });
    } finally {
      setAnalyticsLoading(false);
    }
  };

  const load = async () => {
    setLoading(true);

    try {
      const response = await api.get("/mall/my-listings", { params: { limit: 800 } });
      const nextItems = response.data?.items || [];
      setItems(nextItems);
      setSummary(response.data?.summary || {});
      setShop(response.data?.shop || {});

      setDrafts((current) => {
        const next = { ...current };

        nextItems.forEach((item) => {
          if (!next[item.product_id]) {
            next[item.product_id] = {
              mall_category: item?.listing?.mall_category || item.category || "Pilihan UMKM",
              mall_badge: item?.listing?.mall_badge || "",
              highlight: item?.listing?.highlight || item.description || "",
            };
          }
        });

        return next;
      });
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Gagal memuat data Lapakin Mall");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    loadMallAnalytics();
  }, []);

  const filteredItems = useMemo(() => {
    const needle = q.trim().toLowerCase();

    return items.filter((item) => {
      const status = item?.listing?.status || "not_submitted";
      const statusOk = statusFilter === "all" || status === statusFilter;

      const searchOk =
        !needle ||
        [
          item.name,
          item.description,
          item.category,
          item?.listing?.mall_category,
          item?.listing?.mall_badge,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle));

      return statusOk && searchOk;
    });
  }, [items, q, statusFilter]);

  const setDraft = (productId, key, value) => {
    setDrafts((current) => ({
      ...current,
      [productId]: {
        ...(current[productId] || {}),
        [key]: value,
      },
    }));
  };

  const submitProduct = async (item) => {
    const productId = item?.product_id;
    if (!productId) return;

    setBusyId(productId);

    try {
      const payload = {
        product_id: productId,
        ...(drafts[productId] || {}),
      };

      const response = await api.post("/mall/submit", payload);
      toast.success(response.data?.message || "Produk diajukan ke Mall");
      await load();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Gagal submit produk ke Mall");
    } finally {
      setBusyId("");
    }
  };

  const resubmitListing = async (item) => {
    const listingId = item?.listing?.listing_id;
    const productId = item?.product_id;
    if (!listingId || !productId) return;

    setBusyId(productId);

    try {
      const response = await api.patch(`/mall/my-listings/${listingId}`, {
        action: "resubmit",
        ...(drafts[productId] || {}),
      });

      toast.success(response.data?.message || "Produk diajukan ulang ke Mall");
      await load();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Gagal submit ulang");
    } finally {
      setBusyId("");
    }
  };

  const withdrawListing = async (item) => {
    const listingId = item?.listing?.listing_id;
    const productId = item?.product_id;
    if (!listingId || !productId) return;

    setBusyId(productId);

    try {
      const response = await api.patch(`/mall/my-listings/${listingId}`, {
        action: "withdraw",
      });

      toast.success(response.data?.message || "Listing Mall disembunyikan");
      await load();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Gagal withdraw listing");
    } finally {
      setBusyId("");
    }
  };

  return (
    <DashboardLayout
      title="Lapakin Mall"
      subtitle="Ajukan produk unggulan tokomu agar bisa tampil di etalase Mall."
      actions={
        <div className="flex flex-wrap gap-2">
          <a
            href="/mall"
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-11 items-center rounded-xl border border-brand-line bg-white px-4 text-sm font-black text-brand-ink hover:bg-brand-off"
          >
            <ExternalLink className="mr-2 h-4 w-4" />
            Preview Mall
          </a>

          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex h-11 items-center rounded-xl bg-brand px-4 text-sm font-black text-white hover:bg-brand-dark disabled:opacity-60"
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      }
    >
      <div className="space-y-6" data-testid="tenant-mall-page">
        <section className="rounded-3xl border border-brand-line bg-gradient-to-br from-brand-off via-white to-[#F3D7C7] p-5 shadow-card">
          <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
            <div>
              <div className="inline-flex items-center rounded-full bg-white px-3 py-1 text-xs font-black uppercase tracking-wide text-brand">
                <ShoppingBag className="mr-1.5 h-3.5 w-3.5" />
                Tenant Submission
              </div>

              <h2 className="mt-3 font-heading text-2xl font-black text-brand-ink">
                Pilih produk terbaik untuk masuk Lapakin Mall.
              </h2>

              <p className="mt-2 max-w-2xl text-sm font-medium leading-relaxed text-brand-mute">
                Produk yang kamu submit akan masuk status pending. Admin akan review, lalu produk approved tampil di public Mall.
                Order tetap langsung ke WhatsApp toko kamu.
              </p>

              <div className="mt-4 flex flex-wrap gap-2 text-xs font-black">
                <span className="rounded-full bg-white px-3 py-1 text-brand-mute">Shop: {shop.name || "-"}</span>
                <span className="rounded-full bg-white px-3 py-1 text-brand-mute">Slug: /toko/{shop.slug || "-"}</span>
                <span className={`rounded-full px-3 py-1 ${summary.has_order_contact ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                  {summary.has_order_contact ? "WhatsApp siap" : "Nomor WA belum terdeteksi"}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-2">
              {[
                ["Eligible", summary.eligible],
                ["Pending", summary.pending],
                ["Approved", summary.approved],
                ["Rejected", summary.rejected],
              ].map(([label, value]) => (
                <div key={label} className="rounded-2xl border border-brand-line bg-white p-4 shadow-sm">
                  <div className="text-xs font-black uppercase tracking-wide text-brand-mute">{label}</div>
                  <div className="mt-1 text-2xl font-black text-brand-ink">{Number(value || 0).toLocaleString("id-ID")}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {!summary.shop_ready || !summary.has_order_contact ? (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900" data-testid="tenant-mall-readiness-warning">
            <div className="flex gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <div className="font-heading text-lg font-black">Lengkapi toko sebelum submit ke Mall</div>
                <p className="mt-1 text-sm leading-relaxed">
                  Mall butuh toko aktif, slug storefront, dan nomor WhatsApp/order supaya pembeli bisa langsung menghubungi toko.
                </p>
                <Link to="/dashboard/settings" className="mt-3 inline-flex rounded-xl bg-amber-900 px-4 py-2 text-sm font-black text-white hover:opacity-90">
                  Buka Pengaturan Toko
                </Link>
              </div>
            </div>
          </section>
        ) : null}

        {/* LAPAKIN_MALL_PHASE1F_ANALYTICS_V1 */}
        <section className="rounded-2xl border border-brand-line bg-white p-5 shadow-card" data-testid="tenant-mall-analytics">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-brand" />
                <h2 className="font-heading text-xl font-black text-brand-ink">Mall Analytics</h2>
              </div>
              <p className="mt-1 text-sm text-brand-mute">
                Performa produk tokomu dari Lapakin Mall 30 hari terakhir.
              </p>
            </div>

            <button
              type="button"
              onClick={loadMallAnalytics}
              disabled={analyticsLoading}
              className="inline-flex items-center rounded-xl border border-brand-line bg-white px-3 py-2 text-xs font-black text-brand-ink hover:bg-brand-off disabled:opacity-60"
            >
              <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${analyticsLoading ? "animate-spin" : ""}`} />
              Refresh Analytics
            </button>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <div className="rounded-2xl border border-brand-line bg-brand-off/50 p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase text-brand-mute">Detail Views</span>
                <MousePointerClick className="h-4 w-4 text-brand" />
              </div>
              <div className="mt-1 text-2xl font-black text-brand-ink">{Number(mallAnalytics?.totals?.mall_product_view || 0).toLocaleString("id-ID")}</div>
            </div>

            <div className="rounded-2xl border border-brand-line bg-brand-off/50 p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase text-brand-mute">Card Clicks</span>
                <ShoppingBag className="h-4 w-4 text-brand" />
              </div>
              <div className="mt-1 text-2xl font-black text-brand-ink">{Number(mallAnalytics?.totals?.mall_product_click || 0).toLocaleString("id-ID")}</div>
            </div>

            <div className="rounded-2xl border border-brand-line bg-brand-off/50 p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase text-brand-mute">Klik Pesan</span>
                <MessageCircle className="h-4 w-4 text-brand" />
              </div>
              <div className="mt-1 text-2xl font-black text-brand-ink">{Number(mallAnalytics?.totals?.mall_order_click || 0).toLocaleString("id-ID")}</div>
            </div>

            <div className="rounded-2xl border border-brand-line bg-brand-off/50 p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase text-brand-mute">Klik Toko</span>
                <Store className="h-4 w-4 text-brand" />
              </div>
              <div className="mt-1 text-2xl font-black text-brand-ink">{Number(mallAnalytics?.totals?.mall_store_click || 0).toLocaleString("id-ID")}</div>
            </div>

            <div className="rounded-2xl border border-brand-line bg-brand-off/50 p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase text-brand-mute">Conversion</span>
                <TrendingUp className="h-4 w-4 text-brand" />
              </div>
              <div className="mt-1 text-2xl font-black text-brand-ink">{Number(mallAnalytics?.conversion_rate || 0).toLocaleString("id-ID")}%</div>
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-brand-line bg-white p-4">
            <h3 className="font-heading text-lg font-black text-brand-ink">Top Produk Kamu di Mall</h3>
            <div className="mt-3 divide-y divide-brand-line">
              {(mallAnalytics?.top_products || []).length === 0 ? (
                <div className="py-6 text-sm font-semibold text-brand-mute">
                  Belum ada traffic dari Mall untuk produkmu.
                </div>
              ) : mallAnalytics.top_products.map((row, index) => (
                <div key={row.product_id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="font-bold text-brand-ink">{index + 1}. {row.name}</div>
                    <div className="text-xs font-semibold text-brand-mute">{row.product_id}</div>
                  </div>
                  <div className="shrink-0 text-right text-xs font-black text-brand-mute">
                    <div>{row.order_clicks} pesan</div>
                    <div>{row.detail_views} views</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-brand-line bg-white p-4 shadow-card">
          <div className="grid gap-3 md:grid-cols-[1fr_220px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-mute" />
              <input
                value={q}
                onChange={(event) => setQ(event.target.value)}
                placeholder="Cari produk, kategori, highlight..."
                className="h-11 w-full rounded-xl border border-brand-line bg-white pl-9 pr-3 text-sm font-bold text-brand-ink outline-none focus:border-brand"
                data-testid="tenant-mall-search"
              />
            </div>

            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="h-11 rounded-xl border border-brand-line bg-white px-3 text-sm font-bold text-brand-ink outline-none focus:border-brand"
              data-testid="tenant-mall-status-filter"
            >
              <option value="all">Semua status</option>
              <option value="not_submitted">Belum submit</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="hidden">Hidden</option>
            </select>
          </div>
        </section>

        {loading ? (
          <div className="rounded-2xl border border-brand-line bg-white p-12 text-center font-semibold text-brand-mute shadow-card">
            Memuat data Mall...
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-brand-line bg-white p-12 text-center shadow-card">
            <div className="font-heading text-xl font-black text-brand-ink">Produk tidak ditemukan</div>
            <p className="mt-2 text-sm text-brand-mute">Coba ubah keyword atau filter status.</p>
          </div>
        ) : (
          <div className="grid gap-5 xl:grid-cols-2">
            {filteredItems.map((item) => {
              const meta = statusMeta(item?.listing?.status);
              const Icon = meta.icon;
              const draft = drafts[item.product_id] || {};
              const busy = busyId === item.product_id;
              const status = item?.listing?.status || "not_submitted";
              const canSubmit = item.eligible_for_mall && ["not_submitted", "rejected", "hidden"].includes(status);
              const canWithdraw = ["pending", "approved"].includes(status) && item?.listing?.listing_id;

              return (
                <article key={item.product_id} className="rounded-3xl border border-brand-line bg-white p-5 shadow-card" data-testid={`tenant-mall-product-${item.product_id}`}>
                  <div className="flex gap-4">
                    <div className="h-28 w-28 shrink-0 overflow-hidden rounded-2xl border border-brand-line bg-brand-off">
                      <ProductThumb item={item} />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-black uppercase ${meta.cls}`}>
                          <Icon className="mr-1 h-3 w-3" />
                          {meta.label}
                        </span>

                        {item?.listing?.featured ? (
                          <span className="rounded-full bg-brand px-2.5 py-1 text-[11px] font-black uppercase text-white">
                            Featured
                          </span>
                        ) : null}

                        {!item.eligible_for_mall ? (
                          <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-black uppercase text-red-700">
                            Not eligible
                          </span>
                        ) : null}
                      </div>

                      <h3 className="mt-2 line-clamp-2 font-heading text-xl font-black text-brand-ink">{item.name}</h3>
                      <div className="mt-1 text-lg font-black text-brand">{formatPrice(item.price)}</div>
                      <p className="mt-1 text-xs font-semibold text-brand-mute">{item.product_id}</p>

                      <div className="mt-3 text-sm font-semibold text-brand-mute">{meta.desc}</div>

                      {!item.eligibility?.product_active ? (
                        <div className="mt-2 text-xs font-bold text-red-700">Produk hidden/habis/tidak aktif belum bisa diajukan.</div>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-5 grid gap-3 md:grid-cols-2">
                    <label className="block">
                      <span className="text-xs font-black uppercase text-brand-mute">Kategori Mall</span>
                      <input
                        value={draft.mall_category || ""}
                        onChange={(event) => setDraft(item.product_id, "mall_category", event.target.value)}
                        placeholder="Makanan, Minuman, Fashion..."
                        className="mt-1 h-10 w-full rounded-xl border border-brand-line bg-white px-3 text-sm font-bold text-brand-ink outline-none focus:border-brand"
                      />
                    </label>

                    <label className="block">
                      <span className="text-xs font-black uppercase text-brand-mute">Badge opsional</span>
                      <input
                        value={draft.mall_badge || ""}
                        onChange={(event) => setDraft(item.product_id, "mall_badge", event.target.value)}
                        placeholder="Best Seller / Promo"
                        className="mt-1 h-10 w-full rounded-xl border border-brand-line bg-white px-3 text-sm font-bold text-brand-ink outline-none focus:border-brand"
                      />
                    </label>

                    <label className="block md:col-span-2">
                      <span className="text-xs font-black uppercase text-brand-mute">Highlight untuk Mall</span>
                      <textarea
                        value={draft.highlight || ""}
                        onChange={(event) => setDraft(item.product_id, "highlight", event.target.value)}
                        rows={3}
                        placeholder="Tulis alasan produk ini layak tampil di Mall..."
                        className="mt-1 min-h-[88px] w-full rounded-2xl border border-brand-line bg-white px-4 py-3 text-sm font-semibold text-brand-ink outline-none focus:border-brand"
                      />
                    </label>
                  </div>

                  {item?.listing?.admin_note ? (
                    <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                      <b>Catatan admin:</b> {item.listing.admin_note}
                    </div>
                  ) : null}

                  <div className="mt-5 flex flex-wrap gap-2">
                    {status === "not_submitted" ? (
                      <button
                        type="button"
                        onClick={() => submitProduct(item)}
                        disabled={!canSubmit || busy}
                        className="inline-flex h-11 items-center rounded-xl bg-brand px-4 text-sm font-black text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
                        data-testid={`tenant-mall-submit-${item.product_id}`}
                      >
                        <Send className="mr-2 h-4 w-4" />
                        Submit ke Mall
                      </button>
                    ) : null}

                    {["rejected", "hidden"].includes(status) ? (
                      <button
                        type="button"
                        onClick={() => resubmitListing(item)}
                        disabled={!canSubmit || busy}
                        className="inline-flex h-11 items-center rounded-xl bg-brand px-4 text-sm font-black text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
                        data-testid={`tenant-mall-resubmit-${item.product_id}`}
                      >
                        <Send className="mr-2 h-4 w-4" />
                        Submit Ulang
                      </button>
                    ) : null}

                    {canWithdraw ? (
                      <button
                        type="button"
                        onClick={() => withdrawListing(item)}
                        disabled={busy}
                        className="inline-flex h-11 items-center rounded-xl border border-brand-line bg-white px-4 text-sm font-black text-brand-ink hover:bg-brand-off disabled:opacity-50"
                        data-testid={`tenant-mall-withdraw-${item.product_id}`}
                      >
                        Withdraw
                      </button>
                    ) : null}

                    {status === "approved" ? (
                      <a
                        href="/mall"
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-11 items-center rounded-xl border border-brand-line bg-white px-4 text-sm font-black text-brand-ink hover:bg-brand-off"
                      >
                        <ExternalLink className="mr-2 h-4 w-4" />
                        Lihat di Mall
                      </a>
                    ) : null}

                    <Link
                      to={`/toko/${shop.slug || ""}`}
                      className="inline-flex h-11 items-center rounded-xl border border-brand-line bg-white px-4 text-sm font-black text-brand-ink hover:bg-brand-off"
                    >
                      <Store className="mr-2 h-4 w-4" />
                      Lihat Toko
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
