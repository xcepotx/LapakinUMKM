import { useEffect, useState } from "react";
import api from "@/lib/api";
import AdminLayout from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import {
  Activity,
  Cpu,
  Database,
  HardDrive,
  RefreshCw,
  Server,
  Timer,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = Number(bytes || 0);
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatUptime(seconds) {
  if (!seconds && seconds !== 0) return "-";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d} hari ${h} jam ${m} menit`;
  if (h > 0) return `${h} jam ${m} menit`;
  return `${m} menit`;
}

function MetricCard({ icon: Icon, label, value, sub, percent, dangerAt = 85, testid }) {
  const hasPercent = typeof percent === "number";
  const danger = hasPercent && percent >= dangerAt;

  return (
    <div className="bg-white border border-brand-line rounded-2xl p-5 shadow-card" data-testid={testid}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wider font-bold text-brand-mute">{label}</div>
          <div className={`font-heading font-extrabold text-3xl mt-2 ${danger ? "text-red-700" : "text-brand-ink"}`}>
            {value}
          </div>
          {sub && <div className="text-sm text-brand-mute mt-1">{sub}</div>}
        </div>
        <div className={`w-11 h-11 rounded-xl grid place-items-center ${danger ? "bg-red-50 text-red-700" : "bg-brand-off text-brand"}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>

      {hasPercent && (
        <div className="mt-4">
          <div className="h-2 bg-brand-off rounded-full overflow-hidden">
            <div
              className={`h-full transition-all ${danger ? "bg-red-500" : "bg-brand"}`}
              style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
            />
          </div>
          <div className="text-xs text-brand-mute mt-1">{percent}% terpakai</div>
        </div>
      )}
    </div>
  );
}

export default function AdminServerMonitor() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async ({ silent = false } = {}) => {
    try {
      const res = await api.get("/admin/server/metrics");
      setData(res.data);
      if (!silent) toast.success("Metric server diperbarui");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Gagal memuat metric server");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load({ silent: true });
    const id = setInterval(() => load({ silent: true }), 15000);
    return () => clearInterval(id);
  }, []);

  if (loading) {
    return (
      <AdminLayout title="Server Monitor" subtitle="Memantau performa VPS Lapakin.">
        <div className="text-brand-mute" data-testid="admin-server-loading">Memuat metric server…</div>
      </AdminLayout>
    );
  }

  const cpuPct = data?.cpu?.percent ?? 0;
  const mem = data?.memory || {};
  const disk = data?.disk || {};
  const service = data?.service || {};
  const process = data?.process || {};
  const loadAvg = data?.cpu?.load_average || {};

  return (
    <AdminLayout title="Server Monitor" subtitle="Pantau CPU, RAM, disk, uptime, dan service backend VPS.">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <div className="text-sm text-brand-mute">
          Host: <span className="font-semibold text-brand-ink">{data?.hostname || "-"}</span>
          {data?.timestamp && (
            <span> · Update terakhir: {new Date(data.timestamp).toLocaleString("id-ID")}</span>
          )}
        </div>
        <Button onClick={() => load()} variant="outline" className="rounded-xl border-brand-line" data-testid="admin-server-refresh">
          <RefreshCw className="w-4 h-4 mr-2" /> Refresh
        </Button>
      </div>

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard
          icon={Cpu}
          label="CPU"
          value={`${cpuPct || 0}%`}
          sub={`${data?.cpu?.cores || "-"} core · load ${loadAvg["1m"] ?? "-"} / ${loadAvg["5m"] ?? "-"} / ${loadAvg["15m"] ?? "-"}`}
          percent={cpuPct || 0}
          testid="admin-server-cpu"
        />
        <MetricCard
          icon={Database}
          label="RAM"
          value={`${mem.percent ?? 0}%`}
          sub={`${formatBytes(mem.used_bytes)} / ${formatBytes(mem.total_bytes)}`}
          percent={mem.percent ?? 0}
          testid="admin-server-memory"
        />
        <MetricCard
          icon={HardDrive}
          label="Disk"
          value={`${disk.percent ?? 0}%`}
          sub={`${formatBytes(disk.used_bytes)} / ${formatBytes(disk.total_bytes)} di ${disk.mount || "/"}`}
          percent={disk.percent ?? 0}
          testid="admin-server-disk"
        />
        <MetricCard
          icon={Timer}
          label="Uptime"
          value={formatUptime(data?.uptime_seconds)}
          sub={data?.platform || "-"}
          testid="admin-server-uptime"
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-4 mt-5">
        <div className="bg-white border border-brand-line rounded-2xl p-5 shadow-card" data-testid="admin-server-service">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-heading font-bold text-xl flex items-center gap-2">
                <Server className="w-5 h-5 text-brand" /> Backend Service
              </h2>
              <p className="text-sm text-brand-mute mt-1">{service.name || "lapakin-backend.service"}</p>
            </div>
            <span className={`text-xs font-bold rounded-full px-3 py-1 ${
              service.active === "active"
                ? "bg-green-100 text-green-800"
                : "bg-red-100 text-red-800"
            }`}>
              {service.active || "unknown"}
            </span>
          </div>

          <div className="grid sm:grid-cols-2 gap-3 mt-5 text-sm">
            <div className="rounded-xl bg-brand-off/50 border border-brand-line p-3">
              <div className="text-brand-mute text-xs">Enabled</div>
              <div className="font-bold">{service.enabled || "-"}</div>
            </div>
            <div className="rounded-xl bg-brand-off/50 border border-brand-line p-3">
              <div className="text-brand-mute text-xs">Sub-state</div>
              <div className="font-bold">{service.sub_state || "-"}</div>
            </div>
            <div className="rounded-xl bg-brand-off/50 border border-brand-line p-3">
              <div className="text-brand-mute text-xs">Main PID</div>
              <div className="font-bold">{service.main_pid || "-"}</div>
            </div>
            <div className="rounded-xl bg-brand-off/50 border border-brand-line p-3">
              <div className="text-brand-mute text-xs">Active since</div>
              <div className="font-bold text-xs">{service.active_since || "-"}</div>
            </div>
          </div>
        </div>

        <div className="bg-white border border-brand-line rounded-2xl p-5 shadow-card" data-testid="admin-server-process">
          <h2 className="font-heading font-bold text-xl flex items-center gap-2">
            <Activity className="w-5 h-5 text-brand" /> Process
          </h2>
          <div className="grid sm:grid-cols-2 gap-3 mt-5 text-sm">
            <div className="rounded-xl bg-brand-off/50 border border-brand-line p-3">
              <div className="text-brand-mute text-xs">PID</div>
              <div className="font-bold">{process.pid || "-"}</div>
            </div>
            <div className="rounded-xl bg-brand-off/50 border border-brand-line p-3">
              <div className="text-brand-mute text-xs">RSS Memory</div>
              <div className="font-bold">{formatBytes(process.rss_bytes)}</div>
            </div>
          </div>
          <div className="mt-3 rounded-xl bg-brand-off/50 border border-brand-line p-3">
            <div className="text-brand-mute text-xs">Command</div>
            <div className="font-mono text-xs mt-1 break-all">{process.cmdline || "-"}</div>
          </div>
        </div>
      </div>

      <div className="mt-5 bg-white border border-brand-line rounded-2xl p-5 shadow-card" data-testid="admin-server-notes">
        <h2 className="font-heading font-bold text-xl flex items-center gap-2">
          <Zap className="w-5 h-5 text-brand" /> Catatan
        </h2>
        <ul className="text-sm text-brand-mute mt-3 space-y-1 list-disc pl-5">
          <li>Metric refresh otomatis setiap 15 detik.</li>
          <li>CPU dihitung dari sample pendek <code>/proc/stat</code>.</li>
          <li>Service status membaca <code>systemctl lapakin-backend.service</code>.</li>
        </ul>
      </div>
    </AdminLayout>
  );
}
