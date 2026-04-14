import { useEffect, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { formatUnits, fromHex } from "viem";
import {
  fetchIntegratorStats,
  fetchB2BOrders,
  fetchOrderDetail,
  type SubgraphIntegrator,
  type SubgraphB2BOrder,
  type SubgraphOrder,
} from "../../lib/subgraph";
import { USDC_DECIMALS } from "../../lib/config";
import { OrderStatus } from "../../lib/contracts";

export default function AdminDashboard() {
  const { integratorAddr } = useOutletContext<{ integratorAddr: string }>();
  const [stats, setStats] = useState<SubgraphIntegrator | null>(null);
  const [recentOrders, setRecentOrders] = useState<SubgraphB2BOrder[]>([]);
  const [orderDetails, setOrderDetails] = useState<Record<string, SubgraphOrder>>({});
  const [counts, setCounts] = useState({
    total: 0,
    completed: 0,
    cancelled: 0,
    inProgress: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    (async () => {
      try {
        // 1. Integrator stats
        const s = await fetchIntegratorStats(integratorAddr).catch(() => null);
        setStats(s);

        // 2. Fetch ALL B2B orders for this integrator (up to 1000) to compute counts
        const all = await fetchB2BOrders(integratorAddr, 0, 1000).catch(() => []);

        // 3. Fetch order details in parallel batches of 10
        const detailMap: Record<string, SubgraphOrder> = {};
        const batchSize = 10;
        for (let i = 0; i < all.length; i += batchSize) {
          const batch = all.slice(i, i + batchSize);
          const results = await Promise.all(
            batch.map((o) => fetchOrderDetail(o.orderId).catch(() => null))
          );
          batch.forEach((o, idx) => {
            const r = results[idx];
            if (r) detailMap[o.orderId] = r;
          });
        }
        setOrderDetails(detailMap);

        // 4. Compute counts
        let completed = 0;
        let cancelled = 0;
        let inProgress = 0;
        for (const o of all) {
          const d = detailMap[o.orderId];
          if (!d) continue;
          if (d.status === OrderStatus.COMPLETED) completed++;
          else if (d.status === OrderStatus.CANCELLED) cancelled++;
          else inProgress++;
        }
        setCounts({ total: all.length, completed, cancelled, inProgress });

        // 5. Take 10 most recent for the table
        setRecentOrders(all.slice(0, 10));
      } finally {
        setLoading(false);
      }
    })();
  }, [integratorAddr]);

  if (loading) return <p style={{ color: "#888" }}>Loading dashboard...</p>;

  const totalVolumeUsdc = stats?.totalVolume
    ? formatUnits(BigInt(stats.totalVolume), USDC_DECIMALS) + " USDC"
    : "0 USDC";

  const debtUsdc = stats?.outstandingDebt
    ? formatUnits(BigInt(stats.outstandingDebt), USDC_DECIMALS) + " USDC"
    : "0 USDC";

  return (
    <div>
      <h1 style={s.title}>Dashboard</h1>

      {/* Status banner */}
      <div style={{ ...s.banner, background: stats?.isActive ? "#052e16" : "#2a1215", color: stats?.isActive ? "#4ade80" : "#f87171" }}>
        {stats ? (stats.isActive ? "● Active on Diamond" : "● Inactive on Diamond") : "Not yet indexed"}
      </div>

      {/* Stats */}
      <div style={s.grid}>
        <StatCard label="Total Volume" value={totalVolumeUsdc} />
        <StatCard label="Outstanding Debt" value={debtUsdc} />
        <StatCard label="Total Orders" value={counts.total.toString()} />
        <StatCard label="In Progress" value={counts.inProgress.toString()} />
        <StatCard label="Completed" value={counts.completed.toString()} accent="#4ade80" />
        <StatCard label="Cancelled" value={counts.cancelled.toString()} accent="#f87171" />
      </div>

      {/* Recent Orders */}
      <div style={{ marginTop: "32px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px" }}>
          <h2 style={s.subtitle}>Recent Orders</h2>
          <Link
            to={`/admin/orders?integrator=${integratorAddr}`}
            style={{ color: "#7C3AED", fontSize: "13px", textDecoration: "none" }}
          >
            View all
          </Link>
        </div>

        {recentOrders.length === 0 ? (
          <p style={{ color: "#555", fontSize: "14px" }}>
            No B2B orders indexed yet.
          </p>
        ) : (
          <div style={s.table}>
            <div style={s.tableHeader}>
              <span style={{ width: 60 }}>Order</span>
              <span style={{ flex: 1 }}>User</span>
              <span style={{ width: 70, textAlign: "right" }}>USDC</span>
              <span style={{ width: 60, textAlign: "center" }}>Cur</span>
              <span style={{ width: 80, textAlign: "center" }}>Status</span>
            </div>
            {recentOrders.map((o) => {
              const d = orderDetails[o.orderId];
              let cur = "";
              try {
                cur = d?.currency
                  ? fromHex(d.currency as `0x${string}`, "string").replace(/\0/g, "")
                  : "";
              } catch {}
              return (
                <div key={o.orderId} style={s.tableRow}>
                  <span style={{ width: 60, fontWeight: "600" }}>#{o.orderId}</span>
                  <span style={{ flex: 1, color: "#888", fontSize: "12px", fontFamily: "monospace" }}>
                    {o.user.slice(0, 8)}...{o.user.slice(-6)}
                  </span>
                  <span style={{ width: 70, textAlign: "right" }}>
                    {formatUnits(BigInt(o.amount), USDC_DECIMALS)}
                  </span>
                  <span style={{ width: 60, textAlign: "center", fontSize: "12px" }}>{cur}</span>
                  <span style={{ width: 80, textAlign: "center" }}>
                    <StatusBadge status={d?.status ?? -1} />
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={s.statCard}>
      <p style={{ color: "#888", fontSize: "12px", marginBottom: "4px" }}>{label}</p>
      <p style={{ fontSize: "20px", fontWeight: "700", color: accent ?? "#fff" }}>{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: number }) {
  const labels: Record<number, { label: string; color: string }> = {
    [-1]: { label: "—", color: "#555" },
    [OrderStatus.PLACED]: { label: "Placed", color: "#a78bfa" },
    [OrderStatus.ACCEPTED]: { label: "Accepted", color: "#60a5fa" },
    [OrderStatus.PAID]: { label: "Paid", color: "#fbbf24" },
    [OrderStatus.COMPLETED]: { label: "Done", color: "#4ade80" },
    [OrderStatus.CANCELLED]: { label: "Cancelled", color: "#f87171" },
  };
  const meta = labels[status] ?? labels[-1];
  return (
    <span
      style={{
        fontSize: "11px",
        padding: "2px 8px",
        borderRadius: "999px",
        background: "#12121f",
        color: meta.color,
      }}
    >
      {meta.label}
    </span>
  );
}

const s: Record<string, React.CSSProperties> = {
  title: { fontSize: "22px", fontWeight: "700", marginBottom: "16px" },
  banner: {
    padding: "8px 14px",
    borderRadius: "10px",
    fontSize: "13px",
    fontWeight: "500",
    marginBottom: "16px",
    display: "inline-block",
  },
  subtitle: { fontSize: "16px", fontWeight: "600" },
  grid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr",
    gap: "12px",
  },
  statCard: {
    background: "#1a1a2e",
    borderRadius: "12px",
    padding: "16px",
    border: "1px solid #2a2a4a",
  },
  table: {
    background: "#1a1a2e",
    borderRadius: "12px",
    border: "1px solid #2a2a4a",
    overflow: "hidden",
  },
  tableHeader: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "10px 16px",
    fontSize: "12px",
    color: "#888",
    borderBottom: "1px solid #2a2a4a",
  },
  tableRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "10px 16px",
    fontSize: "14px",
    borderBottom: "1px solid #12121f",
  },
};
