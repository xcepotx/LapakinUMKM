import React, { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import {
  Plus,
  Trash2,
  Pencil,
  RefreshCw,
  Wallet,
  ShoppingBag,
  AlertCircle,
  TrendingUp,
} from "lucide-react";
import api from "../lib/api";

const CHANNELS = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "instagram", label: "Instagram" },
  { value: "offline", label: "Offline" },
  { value: "other", label: "Lainnya" },
];

const PAYMENT_STATUSES = [
  { value: "paid", label: "Lunas" },
  { value: "partial", label: "DP / Sebagian" },
  { value: "unpaid", label: "Belum Bayar" },
];

function formatRupiah(value) {
  const number = Number(value || 0);
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(number);
}

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function addOneDay(dateString) {
  if (!dateString) return "";
  const date = new Date(`${dateString}T00:00:00`);
  date.setDate(date.getDate() + 1);
  return date.toISOString();
}

function dateToStartIso(dateString) {
  if (!dateString) return "";
  return new Date(`${dateString}T00:00:00`).toISOString();
}

function csvEscape(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(filename, rows) {
  const blob = new Blob([rows.join("\n")], {
    type: "text/csv;charset=utf-8;",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function emptyItem() {
  return {
    product_id: "",
    name: "",
    qty: 1,
    unit: "pcs",
    unit_price: 0,
  };
}

export default function SalesBook() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sales, setSales] = useState([]);
  const [summary, setSummary] = useState(null);
  const [products, setProducts] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingSaleId, setEditingSaleId] = useState(null);
  const [filterStatus, setFilterStatus] = useState("");
  const [filterChannel, setFilterChannel] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    customer_name: "",
    customer_phone: "",
    channel: "whatsapp",
    payment_status: "paid",
    paid_amount: "",
    notes: "",
    update_stock: false,
    items: [emptyItem()],
  });

  const filteredSales = useMemo(() => sales, [sales]);

  const formTotal = useMemo(() => {
    return form.items.reduce((sum, item) => {
      const qty = Number(item.qty || 0);
      const price = Number(item.unit_price || 0);
      return sum + qty * price;
    }, 0);
  }, [form.items]);

  async function loadData() {
    setLoading(true);
    setError("");

    try {
      const params = {};

      if (filterStatus) params.status = filterStatus;
      if (filterChannel) params.channel = filterChannel;
      if (startDate) params.start = dateToStartIso(startDate);
      if (endDate) params.end = addOneDay(endDate);

      const [salesRes, summaryRes, productsRes] = await Promise.all([
        api.get("/sales", { params }),
        api.get("/sales/summary"),
        api.get("/products"),
      ]);

      setSales(Array.isArray(salesRes.data) ? salesRes.data : []);
      setSummary(summaryRes.data || null);
      setProducts(Array.isArray(productsRes.data) ? productsRes.data : []);
    } catch (err) {
      setError(
        err?.response?.data?.detail ||
          "Gagal memuat Buku Jualan. Coba refresh halaman."
      );
    } finally {
      setLoading(false);
    }
  }

  function resetFilters() {
    setFilterStatus("");
    setFilterChannel("");
    setStartDate("");
    setEndDate("");

    setTimeout(() => {
      loadData();
    }, 0);
  }

  function exportSalesCsv() {
    const header = [
      "Tanggal",
      "Pelanggan",
      "No HP",
      "Channel",
      "Status Pembayaran",
      "Item",
      "Total",
      "Dibayar",
      "Belum Dibayar",
      "Catatan",
    ];

    const rows = filteredSales.map((sale) => {
      const items = (sale.items || [])
        .map((item) => `${item.name} x${item.qty} ${item.unit || ""}`)
        .join("; ");

      return [
        formatDate(sale.sale_date),
        sale.customer_name || "",
        sale.customer_phone || "",
        sale.channel || "",
        sale.payment_status || "",
        items,
        sale.total || 0,
        sale.paid_amount || 0,
        sale.unpaid_amount || 0,
        sale.notes || "",
      ].map(csvEscape).join(",");
    });

    const filename = `buku-jualan-${startDate || "awal"}-${endDate || "akhir"}.csv`;

    downloadCsv(filename, [header.map(csvEscape).join(","), ...rows]);
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateForm(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function updateItem(index, field, value) {
    setForm((prev) => {
      const items = [...prev.items];
      items[index] = { ...items[index], [field]: value };
      return { ...prev, items };
    });
  }

  function chooseProduct(index, productId) {
    const product = products.find((item) => item.product_id === productId);

    if (!product) {
      updateItem(index, "product_id", "");
      return;
    }

    setForm((prev) => {
      const items = [...prev.items];
      items[index] = {
        ...items[index],
        product_id: product.product_id,
        name: product.name || "",
        unit_price: product.price || 0,
        unit: items[index].unit || "pcs",
      };
      return { ...prev, items };
    });
  }

  function addItem() {
    setForm((prev) => ({
      ...prev,
      items: [...prev.items, emptyItem()],
    }));
  }

  function removeItem(index) {
    setForm((prev) => {
      const items = prev.items.filter((_, itemIndex) => itemIndex !== index);
      return { ...prev, items: items.length ? items : [emptyItem()] };
    });
  }

  function resetForm() {
    setEditingSaleId(null);
    setForm({
      customer_name: "",
      customer_phone: "",
      channel: "whatsapp",
      payment_status: "paid",
      paid_amount: "",
      notes: "",
      update_stock: false,
      items: [emptyItem()],
    });
  }

function startEdit(sale) {
  setEditingSaleId(sale.sale_id);
  setShowForm(true);

  setForm({
    customer_name: sale.customer_name || "",
    customer_phone: sale.customer_phone || "",
    channel: sale.channel || "whatsapp",
    payment_status: sale.payment_status || "paid",
    paid_amount: sale.paid_amount || "",
    notes: sale.notes || "",
    update_stock: false,
    items:
      sale.items && sale.items.length
        ? sale.items.map((item) => ({
            product_id: item.product_id || "",
            name: item.name || "",
            qty: item.qty || 1,
            unit: item.unit || "pcs",
            unit_price: item.unit_price || 0,
          }))
        : [emptyItem()],
  });

  window.scrollTo({ top: 0, behavior: "smooth" });
}

  async function submitSale(event) {
    event.preventDefault();
    setSaving(true);
    setError("");

    const payload = {
      customer_name: form.customer_name,
      customer_phone: form.customer_phone,
      channel: form.channel,
      payment_status: form.payment_status,
      paid_amount:
        form.payment_status === "partial" ? Number(form.paid_amount || 0) : null,
      notes: form.notes,
      update_stock: form.update_stock,
      items: form.items
        .filter((item) => item.name && Number(item.qty) > 0)
        .map((item) => ({
          product_id: item.product_id || "",
          name: item.name,
          qty: Number(item.qty || 0),
          unit: item.unit || "pcs",
          unit_price: Number(item.unit_price || 0),
        })),
    };

    if (!payload.items.length) {
      setSaving(false);
      setError("Minimal masukkan 1 produk/jualan.");
      return;
    }

    try {
      if (editingSaleId) {
        const editPayload = {
          customer_name: payload.customer_name,
          customer_phone: payload.customer_phone,
          channel: payload.channel,
          payment_status: payload.payment_status,
          paid_amount: payload.paid_amount,
          notes: payload.notes,
          items: payload.items,
        };

        await api.put(`/sales/${editingSaleId}`, editPayload);
      } else {
        await api.post("/sales", payload);
      }

      resetForm();
      setShowForm(false);
      await loadData();
    } catch (err) {
      setError(
        err?.response?.data?.detail ||
          "Gagal menyimpan catatan penjualan."
      );
    } finally {
      setSaving(false);
    }
  }

  async function deleteSale(saleId) {
    const ok = window.confirm("Hapus catatan penjualan ini?");
    if (!ok) return;

    try {
      await api.delete(`/sales/${saleId}`);
      await loadData();
    } catch (err) {
      setError(
        err?.response?.data?.detail ||
          "Gagal menghapus catatan penjualan."
      );
    }
  }

  const cards = [
    {
      title: "Omzet Hari Ini",
      value: formatRupiah(summary?.omzet_today),
      icon: Wallet,
    },
    {
      title: "Omzet Bulan Ini",
      value: formatRupiah(summary?.omzet_month),
      icon: TrendingUp,
    },
    {
      title: "Transaksi Hari Ini",
      value: summary?.transaction_today || 0,
      icon: ShoppingBag,
    },
    {
      title: "Belum Dibayar",
      value: formatRupiah(summary?.unpaid_total),
      icon: AlertCircle,
    },
  ];

const pageActions = (
  <div className="flex gap-2">
    <button
      type="button"
      onClick={loadData}
      className="inline-flex items-center gap-2 rounded-xl border border-brand-line bg-white px-4 py-2 text-sm font-semibold text-brand-ink shadow-sm hover:bg-brand-off"
    >
      <RefreshCw size={16} />
      Refresh
    </button>


    <button
      type="button"
      onClick={exportSalesCsv}
      disabled={!filteredSales.length}
      className="inline-flex items-center gap-2 rounded-xl border border-brand-line bg-white px-4 py-2 text-sm font-semibold text-brand-ink shadow-sm hover:bg-brand-off disabled:cursor-not-allowed disabled:opacity-50"
    >
      Export CSV
    </button>

    <button
      type="button"
      onClick={() => setShowForm((value) => !value)}
      className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90"
    >
      <Plus size={16} />
      Catat Penjualan
    </button>
  </div>
);

  return (
    <DashboardLayout
      title="Buku Jualan"
      subtitle="Catat transaksi harian, pantau omzet, dan lihat produk yang paling laku."
      actions={pageActions}
    >
    <div className="space-y-6">
      {error && (
        <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.title}
              className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm"
            >
              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-500">{card.title}</p>
                <div className="rounded-xl bg-[#FDFBF7] p-2 text-[#C04A3B]">
                  <Icon size={18} />
                </div>
              </div>
              <p className="mt-3 text-2xl font-bold text-slate-900">
                {card.value}
              </p>
            </div>
          );
        })}
      </div>

      {showForm && (
        <form
          onSubmit={submitSale}
          className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm"
        >
          <div className="mb-5">
            <h2 className="text-lg font-bold text-slate-900">
              {editingSaleId ? "Edit Penjualan" : "Catat Penjualan Baru"}
            </h2>
            <p className="text-sm text-slate-500">
              {editingSaleId
                ? "Perbarui detail transaksi yang sudah dicatat."
                : "Bisa pilih produk dari katalog atau isi manual."}
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Nama pelanggan
              </label>
              <input
                value={form.customer_name}
                onChange={(event) =>
                  updateForm("customer_name", event.target.value)
                }
                placeholder="Contoh: Bu Rina"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#C04A3B]"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Nomor pelanggan
              </label>
              <input
                value={form.customer_phone}
                onChange={(event) =>
                  updateForm("customer_phone", event.target.value)
                }
                placeholder="Opsional"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#C04A3B]"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Channel
              </label>
              <select
                value={form.channel}
                onChange={(event) => updateForm("channel", event.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#C04A3B]"
              >
                {CHANNELS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Status pembayaran
              </label>
              <select
                value={form.payment_status}
                onChange={(event) =>
                  updateForm("payment_status", event.target.value)
                }
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#C04A3B]"
              >
                {PAYMENT_STATUSES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>

            {form.payment_status === "partial" && (
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Jumlah dibayar
                </label>
                <input
                  type="number"
                  min="0"
                  value={form.paid_amount}
                  onChange={(event) =>
                    updateForm("paid_amount", event.target.value)
                  }
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#C04A3B]"
                />
              </div>
            )}
          </div>

          <div className="mt-6 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-900">Item Penjualan</h3>
              <button
                type="button"
                onClick={addItem}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                + Tambah Item
              </button>
            </div>

            {form.items.map((item, index) => (
              <div
                key={index}
                className="grid gap-3 rounded-2xl border border-slate-100 bg-[#FDFBF7] p-4 md:grid-cols-12"
              >
                <div className="md:col-span-3">
                  <label className="mb-1 block text-xs font-medium text-slate-600">
                    Pilih produk
                  </label>
                  <select
                    value={item.product_id}
                    onChange={(event) =>
                      chooseProduct(index, event.target.value)
                    }
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#C04A3B]"
                  >
                    <option value="">Manual</option>
                    {products.map((product) => (
                      <option
                        key={product.product_id}
                        value={product.product_id}
                      >
                        {product.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="md:col-span-3">
                  <label className="mb-1 block text-xs font-medium text-slate-600">
                    Nama item
                  </label>
                  <input
                    value={item.name}
                    onChange={(event) =>
                      updateItem(index, "name", event.target.value)
                    }
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#C04A3B]"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs font-medium text-slate-600">
                    Qty
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={item.qty}
                    onChange={(event) =>
                      updateItem(index, "qty", event.target.value)
                    }
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#C04A3B]"
                  />
                </div>

                <div className="md:col-span-1">
                  <label className="mb-1 block text-xs font-medium text-slate-600">
                    Satuan
                  </label>
                  <input
                    value={item.unit}
                    onChange={(event) =>
                      updateItem(index, "unit", event.target.value)
                    }
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#C04A3B]"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs font-medium text-slate-600">
                    Harga
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={item.unit_price}
                    onChange={(event) =>
                      updateItem(index, "unit_price", event.target.value)
                    }
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#C04A3B]"
                  />
                </div>

                <div className="flex items-end md:col-span-1">
                  <button
                    type="button"
                    onClick={() => removeItem(index)}
                    className="rounded-xl border border-red-100 bg-white p-2 text-red-600 hover:bg-red-50"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            {!editingSaleId && (
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={form.update_stock}
                  onChange={(event) =>
                    updateForm("update_stock", event.target.checked)
                  }
                />
                Kurangi stok produk otomatis
              </label>
            )}
            <div className="text-right">
              <p className="text-sm text-slate-500">Total</p>
              <p className="text-2xl font-bold text-slate-900">
                {formatRupiah(formTotal)}
              </p>
            </div>
          </div>

          <div className="mt-4">
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Catatan
            </label>
            <textarea
              value={form.notes}
              onChange={(event) => updateForm("notes", event.target.value)}
              placeholder="Contoh: ambil jam 4 sore, kirim ke kantor, DP dulu, dll."
              rows={3}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#C04A3B]"
            />
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                resetForm();
                setShowForm(false);
              }}
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-[#C04A3B] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
            >
              {saving
                ? "Menyimpan..."
                : editingSaleId
                ? "Simpan Perubahan"
                : "Simpan Penjualan"}
            </button>
          </div>
        </form>
      )}

      <div className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              Riwayat Penjualan
            </h2>
            <p className="text-sm text-slate-500">
              Semua catatan transaksi toko kamu.
            </p>
          </div>

          <div className="grid gap-2 md:grid-cols-5">
            <input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#C04A3B]"
            />

            <input
            type="date"
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#C04A3B]"
          />

          <select
            value={filterStatus}
            onChange={(event) => setFilterStatus(event.target.value)}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#C04A3B]"
          >
            <option value="">Semua status</option>
            <option value="paid">Lunas</option>
            <option value="partial">DP / Sebagian</option>
            <option value="unpaid">Belum Bayar</option>
          </select>

          <select
            value={filterChannel}
            onChange={(event) => setFilterChannel(event.target.value)}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#C04A3B]"
          >
            <option value="">Semua channel</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="instagram">Instagram</option>
            <option value="offline">Offline</option>
            <option value="other">Lainnya</option>
          </select>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={loadData}
              className="rounded-xl bg-[#C04A3B] px-3 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              Terapkan
            </button>

            <button
              type="button"
              onClick={resetFilters}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Reset
            </button>
          </div>
        </div>
        </div>
        {loading ? (
          <div className="py-10 text-center text-sm text-slate-500">
            Memuat Buku Jualan...
          </div>
        ) : filteredSales.length === 0 ? (
          <div className="rounded-2xl bg-[#FDFBF7] py-10 text-center">
            <p className="font-semibold text-slate-800">
              Belum ada catatan penjualan.
            </p>
            <p className="mt-1 text-sm text-slate-500">
              Mulai catat transaksi pertama kamu hari ini.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-slate-500">
                  <th className="py-3 pr-4 font-medium">Tanggal</th>
                  <th className="py-3 pr-4 font-medium">Item</th>
                  <th className="py-3 pr-4 font-medium">Pelanggan</th>
                  <th className="py-3 pr-4 font-medium">Channel</th>
                  <th className="py-3 pr-4 font-medium">Total</th>
                  <th className="py-3 pr-4 font-medium">Status</th>
                  <th className="py-3 pr-4 font-medium">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {filteredSales.map((sale) => (
                  <tr
                    key={sale.sale_id}
                    className="border-b border-slate-50 text-slate-700"
                  >
                    <td className="py-3 pr-4 whitespace-nowrap">
                      {formatDate(sale.sale_date)}
                    </td>
                    <td className="py-3 pr-4">
                      <div className="font-medium text-slate-900">
                        {(sale.items || [])
                          .map((item) => `${item.name} x${item.qty}`)
                          .join(", ")}
                      </div>
                      {sale.notes && (
                        <div className="mt-1 text-xs text-slate-500">
                          {sale.notes}
                        </div>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      <div>{sale.customer_name || "-"}</div>
                      {sale.customer_phone && (
                        <div className="text-xs text-slate-500">
                          {sale.customer_phone}
                        </div>
                      )}
                    </td>
                    <td className="py-3 pr-4 capitalize">
                      {sale.channel || "-"}
                    </td>
                    <td className="py-3 pr-4 font-semibold text-slate-900">
                      {formatRupiah(sale.total)}
                    </td>
                    <td className="py-3 pr-4">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          sale.payment_status === "paid"
                            ? "bg-green-50 text-green-700"
                            : sale.payment_status === "partial"
                            ? "bg-yellow-50 text-yellow-700"
                            : "bg-red-50 text-red-700"
                        }`}
                      >
                        {sale.payment_status === "paid"
                          ? "Lunas"
                          : sale.payment_status === "partial"
                          ? "DP"
                          : "Belum Bayar"}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => startEdit(sale)}
                          className="rounded-xl border border-slate-200 p-2 text-slate-600 hover:bg-slate-50"
                          title="Edit transaksi"
                        >
                          <Pencil size={16} />
                        </button>

                        <button
                          type="button"
                          onClick={() => deleteSale(sale.sale_id)}
                          className="rounded-xl border border-red-100 p-2 text-red-600 hover:bg-red-50"
                          title="Hapus transaksi"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>

                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {summary?.top_products?.length > 0 && (
        <div className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900">
            Produk Terlaris Bulan Ini
          </h2>
          <div className="mt-4 space-y-3">
            {summary.top_products.map((item, index) => (
              <div
                key={`${item.product_id || item.name}-${index}`}
                className="flex items-center justify-between rounded-2xl bg-[#FDFBF7] px-4 py-3"
              >
                <div>
                  <p className="font-semibold text-slate-900">{item.name}</p>
                  <p className="text-sm text-slate-500">
                    Terjual {item.qty} item
                  </p>
                </div>
                <p className="font-bold text-slate-900">
                  {formatRupiah(item.revenue)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
    </DashboardLayout>
  );
}
