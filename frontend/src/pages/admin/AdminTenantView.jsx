/* LAPAKIN_ADMIN_TENANT_VIEW_PHASE1C_POLISH_V1 */
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import AdminLayout from "@/components/AdminLayout";
import api, { rupiah } from "@/lib/api";
import { toast } from "sonner";
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  CheckCircle2,
  BarChart3,
  Copy,
  ExternalLink,
  Eye,
  History,
  HeartPulse,
  MessageSquare,
  Package,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  StickyNote,
  User,
  XCircle,
} from "lucide-react";

function formatDate(value) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return value;
  }
}

function formatMoney(value) {
  try {
    return rupiah(Number(value || 0));
  } catch {
    return `Rp ${Number(value || 0).toLocaleString("id-ID")}`;
  }
}

function cleanText(value) {
  return String(value || "").trim();
}

function getProductCategory(product) {
  return cleanText(product?.category_name || product?.category || product?.product_category || product?.type || "");
}

function getProductAvailabilityKey(product) {
  const raw = String(product?.availability_status || "").toLowerCase();
  if (raw === "hidden") return "hidden";
  if (raw === "out_of_stock") return "out_of_stock";
  if (product?.is_active === false) return "hidden";
  return "active";
}

function getProductAvailability(product) {
  const key = getProductAvailabilityKey(product);
  if (key === "hidden") return "Hidden";
  if (key === "out_of_stock") return "Habis";
  return "Aktif";
}

function productMatchesQuery(product, query) {
  const q = cleanText(query).toLowerCase();
  if (!q) return true;

  return [
    product?.name,
    product?.description,
    product?.caption,
    getProductCategory(product),
    product?.product_id,
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(q));
}

function getLeadName(lead) {
  return lead?.customer_name || lead?.name || lead?.buyer_name || "-";
}

function getLeadPhone(lead) {
  return lead?.customer_phone || lead?.phone || lead?.whatsapp || lead?.wa_phone || "-";
}

function getLeadItemsText(lead) {
  const items = lead?.items || lead?.cart_items || lead?.products || [];
  if (Array.isArray(items) && items.length) {
    return items.map((item) => item?.name || item?.product_name || item?.title || "Item").slice(0, 4).join(", ");
  }
  return lead?.product_name || lead?.message || "-";
}

function leadMatchesQuery(lead, query) {
  const q = cleanText(query).toLowerCase();
  if (!q) return true;

  return [
    getLeadName(lead),
    getLeadPhone(lead),
    getLeadItemsText(lead),
    lead?.status,
    lead?.lead_id,
    lead?.id,
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(q));
}

function StatCard({ icon: Icon, label, value, helper }) {
  return (
    <div className="rounded-2xl border border-brand-line bg-white p-4 shadow-card">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-black uppercase tracking-wide text-brand-mute">{label}</div>
          <div className="mt-1 text-2xl font-black text-brand-ink">{value}</div>
          {helper ? <div className="mt-1 text-xs text-brand-mute">{helper}</div> : null}
        </div>
        <div className="grid h-11 w-11 place-items-center rounded-2xl bg-brand-off text-brand">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}


// LAPAKIN_ADMIN_TENANT_VIEW_PHASE1D_HEALTH_CHECK_V1
function hasAnyValue(source, keys) {
  return keys.some((key) => cleanText(source?.[key]));
}

function productHasImage(product) {
  return Boolean(
    product?.image_url ||
    product?.image_data ||
    product?.photo_url ||
    product?.thumbnail_url ||
    (Array.isArray(product?.images) && product.images.length > 0)
  );
}

function buildTenantHealthChecks({ shop, owner, summary, totals, products, leads }) {
  const status = String(shop?.status || "active").toLowerCase();
  const hasSlug = Boolean(cleanText(shop?.slug));
  const storefrontActive = hasSlug && status !== "suspended" && status !== "deleted";
  const activeProducts = Number(summary?.products_active || 0);
  const totalProducts = Number(summary?.products_total || 0);
  const visits = Number(totals?.view_shop || 0) + Number(totals?.storefront_view || 0);
  const orderClicks = Number(totals?.click_order || 0) + Number(totals?.whatsapp_checkout_click || 0);
  const leadCount = Number(summary?.leads_total || 0);
  const hasContact = hasAnyValue(shop, [
    "whatsapp",
    "whatsapp_number",
    "wa_number",
    "phone",
    "phone_number",
    "contact_phone",
    "order_phone",
    "order_whatsapp",
    "contact_whatsapp",
  ]);

  const hasDescription = Boolean(cleanText(shop?.description) || cleanText(shop?.tagline) || cleanText(shop?.about));
  const ownerReady = Boolean(cleanText(owner?.email) || cleanText(owner?.name));
  const productsWithoutImage = (products || []).filter((product) => !productHasImage(product)).length;
  const productsWithoutPrice = (products || []).filter((product) => Number(product?.price || 0) <= 0).length;

  return [
    {
      key: "storefront",
      status: storefrontActive ? "good" : "critical",
      title: "Storefront publik",
      detail: storefrontActive
        ? `Aktif di /toko/${shop.slug}`
        : hasSlug
          ? `Toko berstatus ${status || "unknown"}`
          : "Slug toko belum tersedia",
      action: storefrontActive ? "Aman" : "Cek status toko dan slug.",
    },
    {
      key: "products",
      status: activeProducts > 0 ? "good" : totalProducts > 0 ? "warning" : "critical",
      title: "Produk aktif",
      detail: `${activeProducts} aktif dari ${totalProducts} total produk`,
      action: activeProducts > 0 ? "Aman" : "Tenant perlu mengaktifkan / tambah produk.",
    },
    {
      key: "contact",
      status: hasContact ? "good" : "critical",
      title: "Kontak WhatsApp/order",
      detail: hasContact ? "Kontak order terdeteksi di data toko" : "Nomor kontak order belum terdeteksi",
      action: hasContact ? "Aman" : "Minta tenant isi nomor WhatsApp/order di pengaturan toko.",
    },
    {
      key: "profile",
      status: hasDescription ? "good" : "warning",
      title: "Profil toko",
      detail: hasDescription ? "Deskripsi/tagline toko sudah ada" : "Deskripsi/tagline toko masih kosong",
      action: hasDescription ? "Aman" : "Sarankan tenant lengkapi cerita/deskripsi toko.",
    },
    {
      key: "analytics",
      status: visits > 0 ? "good" : "warning",
      title: "Kunjungan 30 hari",
      detail: `${visits} kunjungan tercatat`,
      action: visits > 0 ? "Ada movement" : "Cek apakah link toko sudah dibagikan atau tracking storefront aktif.",
    },
    {
      key: "conversion",
      status: orderClicks > 0 || leadCount > 0 ? "good" : "warning",
      title: "Klik order / leads",
      detail: `${orderClicks} klik order · ${leadCount} leads`,
      action: orderClicks > 0 || leadCount > 0 ? "Ada intent pembeli" : "Cek CTA WhatsApp, nomor order, dan posisi tombol order.",
    },
    {
      key: "images",
      status: totalProducts === 0 ? "warning" : productsWithoutImage === 0 ? "good" : "warning",
      title: "Foto produk",
      detail: totalProducts === 0
        ? "Belum ada produk untuk dicek"
        : `${productsWithoutImage} produk tanpa foto dari ${totalProducts} produk`,
      action: productsWithoutImage === 0 && totalProducts > 0 ? "Aman" : "Sarankan tenant upload foto produk utama.",
    },
    {
      key: "pricing",
      status: totalProducts === 0 ? "warning" : productsWithoutPrice === 0 ? "good" : "warning",
      title: "Harga produk",
      detail: totalProducts === 0
        ? "Belum ada produk untuk dicek"
        : `${productsWithoutPrice} produk tanpa harga valid`,
      action: productsWithoutPrice === 0 && totalProducts > 0 ? "Aman" : "Cek produk yang harga masih kosong/0.",
    },
    {
      key: "owner",
      status: ownerReady ? "good" : "warning",
      title: "Data owner",
      detail: ownerReady ? owner.email || owner.name : "Owner tidak terdeteksi lengkap",
      action: ownerReady ? "Aman" : "Cek relasi owner_user_id toko.",
    },
  ];
}

function getHealthSummary(checks) {
  const critical = checks.filter((item) => item.status === "critical").length;
  const warning = checks.filter((item) => item.status === "warning").length;
  const good = checks.filter((item) => item.status === "good").length;

  return { critical, warning, good, total: checks.length };
}

function healthToneClass(status) {
  if (status === "critical") return "border-red-200 bg-red-50 text-red-800";
  if (status === "warning") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-emerald-200 bg-emerald-50 text-emerald-800";
}

function HealthIcon({ status }) {
  if (status === "critical") return <XCircle className="h-5 w-5" />;
  if (status === "warning") return <AlertTriangle className="h-5 w-5" />;
  return <CheckCircle2 className="h-5 w-5" />;
}

export default function AdminTenantView() {
  const { shopId } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  // LAPAKIN_ADMIN_TENANT_VIEW_PHASE1E_SUPPORT_NOTES_V1
  const [supportNotes, setSupportNotes] = useState([]);
  const [supportNotesLoading, setSupportNotesLoading] = useState(false);
  const [newSupportNote, setNewSupportNote] = useState("");
  const [newSupportNotePriority, setNewSupportNotePriority] = useState("normal");

  // LAPAKIN_ADMIN_TENANT_VIEW_PHASE2A_ASSISTED_ACTIONS_V1
  const [assistBusy, setAssistBusy] = useState("");
  const [assistResult, setAssistResult] = useState(null);

  // LAPAKIN_ADMIN_TENANT_VIEW_PHASE2B_OG_TIMELINE_V1
  const [supportTimeline, setSupportTimeline] = useState([]);
  const [supportTimelineLoading, setSupportTimelineLoading] = useState(false);

  const [productSearch, setProductSearch] = useState("");
  const [productStatusFilter, setProductStatusFilter] = useState("all");
  const [productCategoryFilter, setProductCategoryFilter] = useState("all");
  const [leadSearch, setLeadSearch] = useState("");

  const shop = data?.shop || {};
  const owner = data?.owner || {};
  const summary = data?.summary || {};
  const analytics = data?.analytics || {};
  const totals = analytics?.totals || {};
  const products = data?.products || [];
  const leads = data?.leads || [];

  const productCategories = useMemo(() => {
    return Array.from(new Set(products.map(getProductCategory).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  }, [products]);

  const filteredProducts = useMemo(() => {
    return products.filter((product) => {
      const statusOk =
        productStatusFilter === "all" ||
        getProductAvailabilityKey(product) === productStatusFilter;

      const categoryOk =
        productCategoryFilter === "all" ||
        getProductCategory(product).toLowerCase() === productCategoryFilter.toLowerCase();

      return statusOk && categoryOk && productMatchesQuery(product, productSearch);
    });
  }, [products, productSearch, productStatusFilter, productCategoryFilter]);

  const filteredLeads = useMemo(() => {
    return leads.filter((lead) => leadMatchesQuery(lead, leadSearch));
  }, [leads, leadSearch]);

  const maxDaily = useMemo(() => {
    return Math.max(1, ...(analytics?.daily || []).map((row) => Number(row.visits || 0)));
  }, [analytics?.daily]);

  // LAPAKIN_ADMIN_TENANT_VIEW_PHASE1D_HEALTH_CHECK_V1
  const healthChecks = useMemo(() => {
    if (!data) return [];
    return buildTenantHealthChecks({ shop, owner, summary, totals, products, leads });
  }, [data, shop, owner, summary, totals, products, leads]);

  const healthSummary = useMemo(() => getHealthSummary(healthChecks), [healthChecks]);

  const load = async () => {
    setLoading(true);
    setSupportNotesLoading(true);

    try {
      // LAPAKIN_ADMIN_TENANT_VIEW_PHASE1E_SUPPORT_NOTES_V1
      const [tenantResponse, notesResponse] = await Promise.allSettled([
        api.get(`/admin/tenant-view/${shopId}`, { params: { days: 30 } }),
        api.get(`/admin/tenant-view/${shopId}/notes`, { params: { limit: 50 } }),
      ]);

      if (tenantResponse.status === "fulfilled") {
        setData(tenantResponse.value.data || null);
      } else {
        throw tenantResponse.reason;
      }

      if (notesResponse.status === "fulfilled") {
        setSupportNotes(notesResponse.value?.data?.items || []);
      } else {
        setSupportNotes([]);
      }
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Gagal memuat tenant view");
    } finally {
      setLoading(false);
      setSupportNotesLoading(false);
    }
  };

  const copySupportSummary = async () => {
    const healthIssueText = healthChecks
      .filter((item) => item.status !== "good")
      .map((item) => `${item.status.toUpperCase()}: ${item.title} — ${item.detail}`)
      .join("; ") || "Tidak ada issue utama";

    const text = [
      `Tenant View Support Summary`,
      `Shop: ${shop.name || "-"}`,
      `Shop ID: ${shop.shop_id || shopId}`,
      `Slug: ${shop.slug || "-"}`,
      `Owner: ${owner.email || owner.name || "-"}`,
      `Tier: ${owner.tier || owner.plan || "-"}`,
      `Products: ${summary.products_total || 0} total, ${summary.products_active || 0} active, ${summary.products_hidden || 0} hidden, ${summary.products_out_of_stock || 0} out_of_stock`,
      `Visits 30d: ${(totals.view_shop || 0) + (totals.storefront_view || 0)}`,
      `Order clicks 30d: ${(totals.click_order || 0) + (totals.whatsapp_checkout_click || 0)}`,
      `Leads: ${summary.leads_total || 0}`,
      `Health: ${healthSummary.good}/${healthSummary.total} good, ${healthSummary.warning} warning, ${healthSummary.critical} critical`,
      `Health issues: ${healthIssueText}`,
      `Support notes visible: ${supportNotes.length}`,
      `Storefront: ${shop.slug ? `/toko/${shop.slug}` : "-"}`,
    ].join("\n");

    try {
      await navigator.clipboard.writeText(text);
      toast.success("Support summary disalin");
    } catch {
      toast.error("Gagal menyalin support summary");
    }
  };

  // LAPAKIN_ADMIN_TENANT_VIEW_PHASE1E_SUPPORT_NOTES_V1
  const createSupportNote = async () => {
    const note = newSupportNote.trim();

    if (!note) {
      toast.error("Catatan tidak boleh kosong");
      return;
    }

    setSupportNotesLoading(true);

    try {
      const response = await api.post(`/admin/tenant-view/${shopId}/notes`, {
        note,
        priority: newSupportNotePriority,
        category: "support",
      });

      const item = response.data?.item;
      if (item) {
        setSupportNotes((current) => [item, ...current]);
      }

      setNewSupportNote("");
      setNewSupportNotePriority("normal");
      toast.success("Support note ditambahkan");
      loadSupportTimeline();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Gagal menambah support note");
    } finally {
      setSupportNotesLoading(false);
    }
  };

  const archiveSupportNote = async (noteId) => {
    if (!noteId) return;

    setSupportNotesLoading(true);

    try {
      await api.patch(`/admin/tenant-view/${shopId}/notes/${noteId}/archive`);
      setSupportNotes((current) => current.filter((item) => item.note_id !== noteId));
      toast.success("Support note diarsipkan");
      loadSupportTimeline();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Gagal archive support note");
    } finally {
      setSupportNotesLoading(false);
    }
  };

  // LAPAKIN_ADMIN_TENANT_VIEW_PHASE2A_ASSISTED_ACTIONS_V1
  const runAssistAction = async (action) => {
    setAssistBusy(action);
    setAssistResult(null);

    try {
      const response = await api.post(`/admin/tenant-view/${shopId}/assist-action`, { action });
      const payload = response.data || {};
      setAssistResult(payload);

      if (["copy_debug_bundle", "og_debug"].includes(action) && payload.debug_text) {
        await navigator.clipboard.writeText(payload.debug_text);
        toast.success(action === "og_debug" ? "OG debug links disalin" : "Debug bundle disalin");
      } else {
        toast.success(payload.message || "Assisted action selesai");
      }
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Assisted action gagal");
    } finally {
      setAssistBusy("");
    }
  };

  const copyAssistResult = async () => {
    if (!assistResult?.debug_text) return;

    try {
      await navigator.clipboard.writeText(assistResult.debug_text);
      toast.success("Hasil assisted action disalin");
    } catch {
      toast.error("Gagal menyalin hasil");
    }
  };

  // LAPAKIN_ADMIN_TENANT_VIEW_PHASE2B_OG_TIMELINE_V1
  const loadSupportTimeline = async () => {
    setSupportTimelineLoading(true);

    try {
      const response = await api.get(`/admin/tenant-view/${shopId}/timeline`, { params: { limit: 80 } });
      setSupportTimeline(response.data?.items || []);
    } catch {
      setSupportTimeline([]);
    } finally {
      setSupportTimelineLoading(false);
    }
  };

  const refreshOgCache = async () => {
    setAssistBusy("refresh_og_cache");
    setAssistResult(null);

    try {
      const response = await api.post(`/admin/tenant-view/${shopId}/refresh-og-cache`);
      const payload = response.data || {};
      setAssistResult({ ...payload, action: "refresh_og_cache" });

      if (payload.debug_text) {
        await navigator.clipboard.writeText(payload.debug_text);
      }

      toast.success(payload.message || "OG cache-busted links dibuat");
      loadSupportTimeline();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "Gagal refresh OG cache");
    } finally {
      setAssistBusy("");
    }
  };

  useEffect(() => {
    load();
    loadSupportTimeline();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopId]);

  return (
    <AdminLayout
      title="Tenant View"
      subtitle="Mode admin read-only untuk cek dashboard toko tanpa impersonation."
      actions={
        <div className="flex flex-wrap gap-2">
          <Link to="/admin/shops" className="inline-flex items-center rounded-xl border border-brand-line bg-white px-4 py-2 text-sm font-black text-brand-ink hover:bg-brand-off">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Kembali
          </Link>

          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex items-center rounded-xl border border-brand-line bg-white px-4 py-2 text-sm font-black text-brand-ink hover:bg-brand-off disabled:opacity-60"
            data-testid="admin-tenant-view-refresh"
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>

          <button
            type="button"
            onClick={copySupportSummary}
            disabled={!data}
            className="inline-flex items-center rounded-xl border border-brand-line bg-white px-4 py-2 text-sm font-black text-brand-ink hover:bg-brand-off disabled:opacity-60"
            data-testid="admin-tenant-view-copy-summary"
          >
            <Copy className="mr-2 h-4 w-4" />
            Copy Summary
          </button>

          {shop?.slug ? (
            <a href={`/toko/${shop.slug}`} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-xl bg-brand px-4 py-2 text-sm font-black text-white hover:bg-brand-dark">
              <ExternalLink className="mr-2 h-4 w-4" />
              Lihat Storefront
            </a>
          ) : null}
        </div>
      }
    >
      <div className="space-y-5" data-testid="admin-tenant-view-page">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900 shadow-sm" data-testid="admin-tenant-view-banner">
          <div className="flex gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <div className="font-heading text-lg font-black">ADMIN VIEW MODE · READ ONLY</div>
              <p className="mt-1 text-sm leading-relaxed">
                Kamu sedang melihat data tenant <b>{shop?.name || shopId}</b>. Mode ini tidak membuka akses edit, hapus,
                generate AI, billing action, atau write action tenant.
              </p>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-brand-line bg-white p-10 text-center text-brand-mute shadow-card">Memuat tenant view...</div>
        ) : !data ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-10 text-center text-red-700">Data toko tidak ditemukan.</div>
        ) : (
          <>
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="rounded-2xl border border-brand-line bg-white p-5 shadow-card lg:col-span-2">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div className="flex items-start gap-4">
                    <div className="grid h-14 w-14 place-items-center rounded-2xl text-lg font-black text-white" style={{ background: shop.brand_color || "#C04A3B" }}>
                      {(shop.name || "?").slice(0, 1).toUpperCase()}
                    </div>
                    <div>
                      <h2 className="font-heading text-2xl font-black text-brand-ink">{shop.name || "-"}</h2>
                      <div className="mt-1 text-sm font-semibold text-brand-mute">/toko/{shop.slug || "-"}</div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <span className="rounded-full bg-brand-off px-3 py-1 text-xs font-black text-brand-mute">Status: <span className="text-brand-ink">{shop.status || "active"}</span></span>
                        <span className="rounded-full bg-brand-off px-3 py-1 text-xs font-black text-brand-mute">Tipe: <span className="text-brand-ink">{shop.business_type || "-"}</span></span>
                        <span className="rounded-full bg-brand-off px-3 py-1 text-xs font-black text-brand-mute">Shop ID: <span className="text-brand-ink">{shop.shop_id}</span></span>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl bg-brand-off p-3 text-xs text-brand-mute">
                    Dibuat: <b className="text-brand-ink">{formatDate(shop.created_at)}</b><br />
                    Update: <b className="text-brand-ink">{formatDate(shop.updated_at)}</b>
                  </div>
                </div>

                {shop.description || shop.tagline ? (
                  <div className="mt-5 rounded-2xl bg-brand-off/70 p-4 text-sm leading-relaxed text-brand-ink">
                    <b>{shop.tagline || "Deskripsi toko"}</b>
                    {shop.description ? <p className="mt-1 text-brand-mute">{shop.description}</p> : null}
                  </div>
                ) : null}
              </div>

              <div className="rounded-2xl border border-brand-line bg-white p-5 shadow-card">
                <div className="flex items-center gap-3">
                  <div className="grid h-11 w-11 place-items-center rounded-2xl bg-brand-off text-brand">
                    <User className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-xs font-black uppercase text-brand-mute">Owner</div>
                    <div className="font-heading text-lg font-black text-brand-ink">{owner.name || owner.email || "-"}</div>
                  </div>
                </div>

                <div className="mt-4 space-y-2 text-sm">
                  <div className="flex justify-between gap-3"><span className="text-brand-mute">Email</span><span className="font-bold text-brand-ink">{owner.email || "-"}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-brand-mute">Tier</span><span className="font-bold uppercase text-brand-ink">{owner.tier || owner.plan || "-"}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-brand-mute">User ID</span><span className="font-bold text-brand-ink">{owner.user_id || shop.owner_user_id || "-"}</span></div>
                </div>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <StatCard icon={Package} label="Total Produk" value={summary.products_total || 0} helper={`${summary.products_active || 0} aktif`} />
              <StatCard icon={Eye} label="Kunjungan" value={(totals.view_shop || 0) + (totals.storefront_view || 0)} helper="30 hari terakhir" />
              <StatCard icon={MessageSquare} label="Klik Order" value={(totals.click_order || 0) + (totals.whatsapp_checkout_click || 0)} helper="Legacy + storefront events" />
              <StatCard icon={BarChart3} label="Leads" value={summary.leads_total || 0} helper="Storefront leads" />
            </div>

            {/* LAPAKIN_ADMIN_TENANT_VIEW_PHASE2A_ASSISTED_ACTIONS_V1 */}
            <div className="rounded-2xl border border-brand-line bg-white p-5 shadow-card" data-testid="admin-tenant-assisted-actions">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-5 w-5 text-brand" />
                    <h2 className="font-heading text-xl font-black text-brand-ink">Assisted Actions</h2>
                  </div>
                  <p className="mt-1 text-xs text-brand-mute">
                    Tools support admin yang aman. Tidak mengubah data tenant dan semua action masuk audit log.
                  </p>
                </div>

                <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">
                  Read-only safe
                </span>
              </div>

              <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                <button
                  type="button"
                  onClick={() => runAssistAction("copy_debug_bundle")}
                  disabled={Boolean(assistBusy)}
                  className="inline-flex items-center justify-center rounded-xl border border-brand-line bg-brand-off px-4 py-3 text-sm font-black text-brand-ink hover:border-brand/40 disabled:opacity-60"
                  data-testid="admin-tenant-assist-debug-bundle"
                >
                  <Copy className="mr-2 h-4 w-4" />
                  Copy Debug Bundle
                </button>

                <button
                  type="button"
                  onClick={() => runAssistAction("test_whatsapp_cta")}
                  disabled={Boolean(assistBusy)}
                  className="inline-flex items-center justify-center rounded-xl border border-brand-line bg-brand-off px-4 py-3 text-sm font-black text-brand-ink hover:border-brand/40 disabled:opacity-60"
                  data-testid="admin-tenant-assist-wa-test"
                >
                  <MessageSquare className="mr-2 h-4 w-4" />
                  Test WhatsApp CTA
                </button>

                <button
                  type="button"
                  onClick={() => runAssistAction("og_debug")}
                  disabled={Boolean(assistBusy)}
                  className="inline-flex items-center justify-center rounded-xl border border-brand-line bg-brand-off px-4 py-3 text-sm font-black text-brand-ink hover:border-brand/40 disabled:opacity-60"
                  data-testid="admin-tenant-assist-og-debug"
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Copy OG Debug Links
                </button>

                <button
                  type="button"
                  onClick={refreshOgCache}
                  disabled={Boolean(assistBusy)}
                  className="inline-flex items-center justify-center rounded-xl border border-brand-line bg-amber-50 px-4 py-3 text-sm font-black text-amber-900 hover:border-amber-300 disabled:opacity-60"
                  data-testid="admin-tenant-assist-refresh-og-cache"
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Refresh OG Cache
                </button>

                <button
                  type="button"
                  onClick={() => runAssistAction("tracking_probe")}
                  disabled={Boolean(assistBusy)}
                  className="inline-flex items-center justify-center rounded-xl border border-brand-line bg-brand-off px-4 py-3 text-sm font-black text-brand-ink hover:border-brand/40 disabled:opacity-60"
                  data-testid="admin-tenant-assist-tracking-probe"
                >
                  <BarChart3 className="mr-2 h-4 w-4" />
                  Recheck Tracking
                </button>
              </div>

              {assistBusy ? (
                <div className="mt-4 rounded-2xl bg-brand-off p-4 text-sm font-bold text-brand-mute">
                  <RefreshCw className="mr-2 inline h-4 w-4 animate-spin" />
                  Menjalankan assisted action...
                </div>
              ) : null}

              {assistResult ? (
                <div className="mt-4 rounded-2xl border border-brand-line bg-brand-off/70 p-4" data-testid="admin-tenant-assist-result">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="text-xs font-black uppercase text-brand-mute">{assistResult.action}</div>
                      <div className="mt-1 font-heading text-lg font-black text-brand-ink">{assistResult.message || "Assisted action selesai"}</div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {assistResult.wa_url ? (
                        <a
                          href={assistResult.wa_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center rounded-xl bg-brand px-3 py-2 text-xs font-black text-white hover:bg-brand-dark"
                        >
                          <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                          Open WA
                        </a>
                      ) : null}

                      {(assistResult.storefront_cache_busted_url || assistResult.share_url) ? (
                        <a
                          href={assistResult.storefront_cache_busted_url || assistResult.share_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center rounded-xl bg-brand px-3 py-2 text-xs font-black text-white hover:bg-brand-dark"
                        >
                          <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                          Open Cache-busted URL
                        </a>
                      ) : null}

                      {assistResult.debug_text ? (
                        <button
                          type="button"
                          onClick={copyAssistResult}
                          className="inline-flex items-center rounded-xl border border-brand-line bg-white px-3 py-2 text-xs font-black text-brand-ink hover:bg-brand-off"
                        >
                          <Copy className="mr-1.5 h-3.5 w-3.5" />
                          Copy Result
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {assistResult.debug_text ? (
                    <pre className="mt-4 max-h-64 overflow-auto whitespace-pre-wrap rounded-xl bg-white p-3 text-xs leading-relaxed text-brand-ink">
                      {assistResult.debug_text}
                    </pre>
                  ) : null}
                </div>
              ) : null}
            </div>

            {/* LAPAKIN_ADMIN_TENANT_VIEW_PHASE2B_OG_TIMELINE_V1 */}
            <div className="rounded-2xl border border-brand-line bg-white p-5 shadow-card" data-testid="admin-tenant-support-timeline">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <History className="h-5 w-5 text-brand" />
                    <h2 className="font-heading text-xl font-black text-brand-ink">Support Timeline</h2>
                  </div>
                  <p className="mt-1 text-xs text-brand-mute">
                    Riwayat notes, assisted actions, dan audit terkait toko ini.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={loadSupportTimeline}
                  disabled={supportTimelineLoading}
                  className="inline-flex items-center rounded-xl border border-brand-line bg-white px-3 py-2 text-xs font-black text-brand-ink hover:bg-brand-off disabled:opacity-60"
                  data-testid="admin-tenant-support-timeline-refresh"
                >
                  <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${supportTimelineLoading ? "animate-spin" : ""}`} />
                  Refresh Timeline
                </button>
              </div>

              <div className="mt-4 space-y-3">
                {supportTimelineLoading && supportTimeline.length === 0 ? (
                  <div className="rounded-2xl bg-brand-off p-4 text-sm font-semibold text-brand-mute">
                    Memuat timeline...
                  </div>
                ) : supportTimeline.length === 0 ? (
                  <div className="rounded-2xl bg-brand-off p-4 text-sm font-semibold text-brand-mute">
                    Belum ada timeline support untuk toko ini.
                  </div>
                ) : supportTimeline.slice(0, 12).map((item) => (
                  <div key={`${item.source}-${item.id}-${item.created_at}`} className="rounded-2xl border border-brand-line bg-brand-off/50 p-4" data-testid={`admin-tenant-timeline-${item.kind}`}>
                    <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-black uppercase text-brand-mute">
                            {item.kind || "event"}
                          </span>
                          <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-black uppercase text-brand-mute">
                            {item.source || "timeline"}
                          </span>
                          <span className="text-xs font-bold text-brand-mute">
                            {formatDate(item.created_at)}
                          </span>
                        </div>

                        <div className="mt-2 font-heading text-sm font-black text-brand-ink">
                          {item.title || "Admin activity"}
                        </div>

                        {item.description ? (
                          <p className="mt-1 whitespace-pre-wrap text-sm font-semibold leading-relaxed text-brand-ink">
                            {item.description}
                          </p>
                        ) : null}

                        <div className="mt-2 text-xs text-brand-mute">
                          by <b>{item.actor || "admin"}</b>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-brand-line bg-white p-5 shadow-card" data-testid="admin-tenant-support-notes">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <StickyNote className="h-5 w-5 text-brand" />
                    <h2 className="font-heading text-xl font-black text-brand-ink">Admin Support Notes</h2>
                  </div>
                  <p className="mt-1 text-xs text-brand-mute">
                    Catatan internal admin per toko. Tidak terlihat oleh tenant.
                  </p>
                </div>

                <span className="rounded-full bg-brand-off px-3 py-1 text-xs font-black text-brand-mute">
                  {supportNotes.length} active notes
                </span>
              </div>

              <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_160px_auto]">
                <textarea
                  value={newSupportNote}
                  onChange={(event) => setNewSupportNote(event.target.value)}
                  placeholder="Contoh: Owner komplain klik WA tidak masuk. Sudah dicek nomor WA valid, perlu cek CTA storefront."
                  rows={3}
                  className="min-h-[88px] rounded-2xl border border-brand-line bg-white px-4 py-3 text-sm font-semibold text-brand-ink outline-none focus:border-brand"
                  data-testid="admin-tenant-support-note-input"
                />

                <select
                  value={newSupportNotePriority}
                  onChange={(event) => setNewSupportNotePriority(event.target.value)}
                  className="h-11 rounded-xl border border-brand-line bg-white px-3 text-sm font-bold text-brand-ink outline-none focus:border-brand"
                  data-testid="admin-tenant-support-note-priority"
                >
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>

                <button
                  type="button"
                  onClick={createSupportNote}
                  disabled={supportNotesLoading || !newSupportNote.trim()}
                  className="inline-flex h-11 items-center justify-center rounded-xl bg-brand px-4 text-sm font-black text-white hover:bg-brand-dark disabled:opacity-60"
                  data-testid="admin-tenant-support-note-submit"
                >
                  <Send className="mr-2 h-4 w-4" />
                  Simpan Note
                </button>
              </div>

              <div className="mt-4 space-y-3">
                {supportNotesLoading && supportNotes.length === 0 ? (
                  <div className="rounded-2xl bg-brand-off p-4 text-sm font-semibold text-brand-mute">
                    Memuat support notes...
                  </div>
                ) : supportNotes.length === 0 ? (
                  <div className="rounded-2xl bg-brand-off p-4 text-sm font-semibold text-brand-mute">
                    Belum ada support note untuk toko ini.
                  </div>
                ) : supportNotes.map((note) => (
                  <div key={note.note_id} className="rounded-2xl border border-brand-line bg-brand-off/50 p-4" data-testid={`admin-tenant-support-note-${note.note_id}`}>
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-black uppercase text-brand-mute">
                            {note.priority || "normal"}
                          </span>
                          <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-black uppercase text-brand-mute">
                            {note.category || "support"}
                          </span>
                          <span className="text-xs font-bold text-brand-mute">
                            {formatDate(note.created_at)}
                          </span>
                        </div>

                        <p className="mt-3 whitespace-pre-wrap text-sm font-semibold leading-relaxed text-brand-ink">
                          {note.note}
                        </p>

                        <div className="mt-2 text-xs text-brand-mute">
                          by <b>{note.created_by_email || "admin"}</b>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => archiveSupportNote(note.note_id)}
                        disabled={supportNotesLoading}
                        className="inline-flex items-center rounded-xl border border-brand-line bg-white px-3 py-2 text-xs font-black text-brand-ink hover:bg-brand-off disabled:opacity-60"
                        data-testid={`admin-tenant-support-note-archive-${note.note_id}`}
                      >
                        <Archive className="mr-1.5 h-3.5 w-3.5" />
                        Archive
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-brand-line bg-white p-5 shadow-card" data-testid="admin-tenant-health-check">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <HeartPulse className="h-5 w-5 text-brand" />
                    <h2 className="font-heading text-xl font-black text-brand-ink">Tenant Health Checklist</h2>
                  </div>
                  <p className="mt-1 text-xs text-brand-mute">
                    Diagnosis cepat untuk support. Checklist ini read-only dan tidak mengubah data tenant.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2 text-xs font-black">
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700">{healthSummary.good} Good</span>
                  <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-700">{healthSummary.warning} Warning</span>
                  <span className="rounded-full bg-red-50 px-3 py-1 text-red-700">{healthSummary.critical} Critical</span>
                </div>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {healthChecks.map((item) => (
                  <div key={item.key} className={`rounded-2xl border p-4 ${healthToneClass(item.status)}`} data-testid={`tenant-health-${item.key}`}>
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 shrink-0">
                        <HealthIcon status={item.status} />
                      </div>

                      <div className="min-w-0">
                        <div className="font-heading text-sm font-black">{item.title}</div>
                        <div className="mt-1 text-sm font-semibold opacity-90">{item.detail}</div>
                        <div className="mt-2 text-xs leading-relaxed opacity-80">{item.action}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-3">
              <div className="rounded-2xl border border-brand-line bg-white p-5 shadow-card xl:col-span-2">
                <h2 className="font-heading text-xl font-black text-brand-ink">Grafik Kunjungan 30 Hari</h2>
                <p className="mt-1 text-xs text-brand-mute">Read-only dari analytics/storefront events.</p>

                <div className="mt-5 h-52 rounded-2xl border border-brand-line bg-brand-off/40 px-3 pb-3 pt-8">
                  <div className="flex h-full items-stretch gap-1.5">
                    {(analytics.daily || []).map((row) => {
                      const visits = Number(row.visits || 0);
                      const percent = visits > 0 ? Math.max(8, (visits / maxDaily) * 100) : 0;

                      return (
                        <div key={row.date} className="flex min-w-0 flex-1 flex-col items-center gap-2" title={`${row.date}: ${visits} visit`}>
                          <div className="relative flex min-h-0 w-full flex-1 items-end justify-center border-b border-brand-line">
                            {visits > 0 ? <span className="absolute -top-6 rounded-full bg-white px-2 py-0.5 text-[10px] font-black text-brand-ink shadow-sm">{visits}</span> : null}
                            <div className={`w-full max-w-[36px] rounded-t-xl ${visits > 0 ? "bg-brand" : "bg-brand-line/80"}`} style={{ height: visits > 0 ? `${percent}%` : "4px" }} />
                          </div>
                          <span className="w-full truncate text-center text-[10px] text-brand-mute">{row.date?.slice(5)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-brand-line bg-white p-5 shadow-card">
                <h2 className="font-heading text-xl font-black text-brand-ink">Ringkasan Katalog</h2>
                <div className="mt-4 space-y-3 text-sm">
                  <div className="flex justify-between"><span className="text-brand-mute">Aktif</span><b>{summary.products_active || 0}</b></div>
                  <div className="flex justify-between"><span className="text-brand-mute">Hidden</span><b>{summary.products_hidden || 0}</b></div>
                  <div className="flex justify-between"><span className="text-brand-mute">Habis</span><b>{summary.products_out_of_stock || 0}</b></div>
                  <div className="flex justify-between border-t border-brand-line pt-3"><span className="text-brand-mute">Nilai Stok</span><b>{formatMoney(summary.inventory_value)}</b></div>
                </div>

                <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
                  <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
                  Semua action edit/hapus/generate sengaja tidak disediakan di Phase 1.
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-brand-line bg-white shadow-card">
              <div className="border-b border-brand-line p-5">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div>
                    <h2 className="font-heading text-xl font-black text-brand-ink">Produk Tenant</h2>
                    <p className="mt-1 text-xs text-brand-mute">
                      Menampilkan <b>{filteredProducts.length}</b> dari <b>{products.length}</b> produk. Maksimal 200 produk terbaru. Read-only.
                    </p>
                  </div>

                  <div className="grid gap-2 md:grid-cols-3 xl:w-[680px]">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-mute" />
                      <input
                        value={productSearch}
                        onChange={(event) => setProductSearch(event.target.value)}
                        placeholder="Cari produk..."
                        className="h-11 w-full rounded-xl border border-brand-line bg-white pl-9 pr-3 text-sm font-bold text-brand-ink outline-none focus:border-brand"
                        data-testid="admin-tenant-product-search"
                      />
                    </div>

                    <select
                      value={productCategoryFilter}
                      onChange={(event) => setProductCategoryFilter(event.target.value)}
                      className="h-11 rounded-xl border border-brand-line bg-white px-3 text-sm font-bold text-brand-ink outline-none focus:border-brand"
                      data-testid="admin-tenant-product-category-filter"
                    >
                      <option value="all">Semua kategori</option>
                      {productCategories.map((category) => (
                        <option key={category} value={category}>{category}</option>
                      ))}
                    </select>

                    <select
                      value={productStatusFilter}
                      onChange={(event) => setProductStatusFilter(event.target.value)}
                      className="h-11 rounded-xl border border-brand-line bg-white px-3 text-sm font-bold text-brand-ink outline-none focus:border-brand"
                      data-testid="admin-tenant-product-status-filter"
                    >
                      <option value="all">Semua status</option>
                      <option value="active">Aktif</option>
                      <option value="out_of_stock">Habis</option>
                      <option value="hidden">Hidden</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-brand-off/60 text-left text-xs uppercase tracking-wide text-brand-mute">
                    <tr>
                      <th className="px-5 py-3 font-black">Produk</th>
                      <th className="px-5 py-3 font-black">Kategori</th>
                      <th className="px-5 py-3 font-black text-right">Harga</th>
                      <th className="px-5 py-3 font-black text-center">Stok</th>
                      <th className="px-5 py-3 font-black">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-brand-line">
                    {filteredProducts.length === 0 ? (
                      <tr><td colSpan={5} className="px-5 py-8 text-center text-brand-mute">Produk tidak ditemukan.</td></tr>
                    ) : filteredProducts.slice(0, 80).map((product) => (
                      <tr key={product.product_id}>
                        <td className="px-5 py-3"><div className="font-bold text-brand-ink">{product.name || "-"}</div><div className="text-xs text-brand-mute">{product.product_id}</div></td>
                        <td className="px-5 py-3 text-brand-mute">{getProductCategory(product) || "-"}</td>
                        <td className="px-5 py-3 text-right font-bold">{formatMoney(product.price)}</td>
                        <td className="px-5 py-3 text-center">{product.stock ?? "-"}</td>
                        <td className="px-5 py-3"><span className="rounded-full bg-brand-off px-2 py-1 text-xs font-black text-brand-mute">{getProductAvailability(product)}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-2xl border border-brand-line bg-white shadow-card">
              <div className="border-b border-brand-line p-5">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h2 className="font-heading text-xl font-black text-brand-ink">Lead / Order Inbox Terbaru</h2>
                    <p className="mt-1 text-xs text-brand-mute">
                      Menampilkan <b>{filteredLeads.length}</b> dari <b>{leads.length}</b> lead terbaru. Read-only.
                    </p>
                  </div>

                  <div className="relative md:w-80">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-mute" />
                    <input
                      value={leadSearch}
                      onChange={(event) => setLeadSearch(event.target.value)}
                      placeholder="Cari nama, WA, produk..."
                      className="h-11 w-full rounded-xl border border-brand-line bg-white pl-9 pr-3 text-sm font-bold text-brand-ink outline-none focus:border-brand"
                      data-testid="admin-tenant-lead-search"
                    />
                  </div>
                </div>
              </div>

              <div className="divide-y divide-brand-line">
                {filteredLeads.length === 0 ? (
                  <div className="p-8 text-center text-brand-mute">Lead tidak ditemukan.</div>
                ) : filteredLeads.map((lead, index) => (
                  <div key={lead.lead_id || lead.id || index} className="p-5">
                    <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="font-bold text-brand-ink">{getLeadName(lead)}</div>
                        <div className="text-xs text-brand-mute">{getLeadPhone(lead)}</div>
                        <div className="mt-2 text-sm text-brand-ink">{getLeadItemsText(lead)}</div>
                      </div>
                      <div className="text-xs font-bold text-brand-mute">{formatDate(lead.created_at)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
