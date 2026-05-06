function formatAdminDate(value, compact = false) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(compact ? {} : { hour: "2-digit", minute: "2-digit" }),
  });
}

function formatMoney(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "-";
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(number);
}

function pick(user, key, fallbackKey) {
  return user?.admin_lifecycle?.[key] || user?.[key] || (fallbackKey ? user?.[fallbackKey] : null);
}

function DetailItem({ label, value }) {
  return (
    <div className="rounded-lg bg-white/80 px-2 py-1">
      <div className="text-[10px] font-bold uppercase tracking-wide text-brand-mute">{label}</div>
      <div className="break-words text-[11px] font-semibold text-brand-ink">{value || "-"}</div>
    </div>
  );
}

export default function AdminUserDetails({ user }) {
  const shop = user?.admin_shop || {};
  const deposit = user?.admin_deposit || {};

  const trialStatus = user?.trial
    ? "aktif"
    : user?.trial_expired
      ? "expired"
      : user?.trial_used
        ? "pernah"
        : "belum";

  const trialEnds = pick(user, "trial_expires_at");
  const subscriptionEnds = pick(user, "subscription_expires_at");
  const shopName = shop.name || user?.shop_name || (user?.shop_id ? "Toko aktif" : "-");

  return (
    <details
      className="group relative mt-2 w-fit"
      data-testid={`admin-user-details-${user?.user_id || user?.email || "unknown"}`}
    >
      <summary className="flex max-w-[230px] cursor-pointer list-none items-center gap-2 rounded-xl border border-brand-line bg-brand-off/70 px-2.5 py-1.5 text-[11px] font-bold text-brand-ink transition hover:bg-brand-off [&::-webkit-details-marker]:hidden">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
        <span className="truncate">
          Detail admin · Trial {trialStatus}
        </span>
        <span className="text-brand-mute transition group-open:rotate-180">▾</span>
      </summary>

      <div className="absolute left-0 top-full z-50 mt-2 w-[min(760px,calc(100vw-2rem))] rounded-2xl border border-brand-line bg-white p-3 text-[11px] leading-relaxed text-brand-mute shadow-2xl">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-brand-line pb-2">
          <div>
            <div className="font-extrabold text-brand-ink">Detail admin user</div>
            <div className="text-brand-mute">{user?.email || "-"}</div>
          </div>
          <div className="rounded-full bg-brand-off px-3 py-1 text-[10px] font-extrabold uppercase text-brand">
            {user?.tier || "free"} · {trialStatus}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <section className="space-y-1.5">
            <div className="font-extrabold text-brand-ink">Lifecycle</div>
            <DetailItem label="Dibuat" value={formatAdminDate(pick(user, "account_created_at", "created_at"))} />
            <DetailItem label="Update" value={formatAdminDate(pick(user, "account_updated_at", "updated_at"))} />
            <DetailItem label="Trial" value={trialStatus} />
            <DetailItem label="Trial mulai" value={formatAdminDate(pick(user, "trial_started_at"))} />
            <DetailItem label="Trial berakhir" value={formatAdminDate(trialEnds)} />
            <DetailItem label="Tier diubah" value={formatAdminDate(pick(user, "tier_updated_at"))} />
            <DetailItem label="Langganan mulai" value={formatAdminDate(pick(user, "subscription_started_at"))} />
            <DetailItem label="Langganan berakhir" value={formatAdminDate(subscriptionEnds)} />
          </section>

          <section className="space-y-1.5">
            <div className="font-extrabold text-brand-ink">Toko</div>
            <DetailItem label="Nama" value={shopName} />
            <DetailItem label="Slug" value={shop.slug || user?.shop_slug || "-"} />
            <DetailItem label="Status" value={shop.status || user?.shop_status || "-"} />
            <DetailItem label="Shop ID" value={shop.shop_id || user?.shop_id || "-"} />
            <DetailItem label="Renderer" value={shop.renderer || "-"} />
            <DetailItem label="Mode" value={shop.mode || "-"} />
            <DetailItem label="Style" value={shop.style || "-"} />
            <DetailItem label="Dibuat" value={formatAdminDate(shop.created_at)} />
          </section>

          <section className="space-y-1.5">
            <div className="font-extrabold text-brand-ink">Deposit / Payment</div>
            <DetailItem label="Saldo" value={formatMoney(deposit.balance)} />
            <DetailItem label="Pembayaran sukses" value={formatMoney(deposit.total_success_amount)} />
            <DetailItem label="Pending" value={String(deposit.pending_count ?? 0)} />
            <DetailItem label="Terakhir bayar" value={formatAdminDate(deposit.last_payment_at)} />
            <DetailItem label="Status terakhir" value={deposit.last_payment_status || "-"} />
            <DetailItem label="Sample pembayaran" value={String(deposit.payments_count_sample ?? 0)} />
          </section>
        </div>

        <div className="mt-3 rounded-xl bg-brand-off/70 px-3 py-2 text-[10px] text-brand-mute">
          Ringkas: trial berakhir {formatAdminDate(trialEnds, true)}, langganan berakhir {formatAdminDate(subscriptionEnds, true)}.
        </div>
      </div>
    </details>
  );
}
