import { useEffect, useState } from "react";
import { useOutletContext, useNavigate } from "react-router-dom";
import { formatUnits, fromHex } from "viem";
import {
  fetchB2BOrders,
  fetchOrderDetail,
  type SubgraphB2BOrder,
  type SubgraphOrder,
} from "../../lib/subgraph";
import { USDC_DECIMALS } from "../../lib/config";
import { OrderStatus } from "../../lib/contracts";

export default function AdminOrders() {
  const { integratorAddr } = useOutletContext<{ integratorAddr: string }>();
  const navigate = useNavigate();
  const [b2bOrders, setB2BOrders] = useState<SubgraphB2BOrder[]>([]);
  const [orderDetails, setOrderDetails] = useState<Record<string, SubgraphOrder>>({});
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;

  useEffect(() => {
    setLoading(true);
    fetchB2BOrders(integratorAddr, page * PAGE_SIZE, PAGE_SIZE)
      .then(async (orders) => {
        setB2BOrders(orders);
        // Fetch full details for each
        const details: Record<string, SubgraphOrder> = {};
        await Promise.all(
          orders.map(async (o) => {
            const d = await fetchOrderDetail(o.orderId).catch(() => null);
            if (d) details[o.orderId] = d;
          })
        );
        setOrderDetails(details);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [integratorAddr, page]);

  const statusLabel = (status: number) => {
    switch (status) {
      case OrderStatus.PLACED: return "Placed";
      case OrderStatus.ACCEPTED: return "Accepted";
      case OrderStatus.PAID: return "Paid";
      case OrderStatus.COMPLETED: return "Completed";
      case OrderStatus.CANCELLED: return "Cancelled";
      default: return "—";
    }
  };

  const statusColor = (status: number) => {
    switch (status) {
      case OrderStatus.COMPLETED: return "#4ade80";
      case OrderStatus.CANCELLED: return "#f87171";
      case OrderStatus.PAID: return "#fbbf24";
      case OrderStatus.ACCEPTED: return "#60a5fa";
      default: return "#a78bfa";
    }
  };

  return (
    <div>
      <h1 style={s.title}>Orders</h1>

      {loading ? (
        <p style={{ color: "#888" }}>Loading orders...</p>
      ) : b2bOrders.length === 0 ? (
        <p style={{ color: "#555" }}>No B2B orders found for this integrator.</p>
      ) : (
        <>
          <div style={s.table}>
            <div style={s.headerRow}>
              <span style={{ width: 60 }}>ID</span>
              <span style={{ flex: 2 }}>User</span>
              <span style={{ width: 80, textAlign: "right" }}>USDC</span>
              <span style={{ width: 60, textAlign: "center" }}>Currency</span>
              <span style={{ width: 80, textAlign: "center" }}>Status</span>
              <span style={{ width: 100, textAlign: "right" }}>Date</span>
            </div>
            {b2bOrders.map((o) => {
              const detail = orderDetails[o.orderId];
              let currency = "";
              try {
                currency = detail?.currency
                  ? fromHex(detail.currency as `0x${string}`, "string").replace(/\0/g, "")
                  : "";
              } catch { currency = ""; }

              const status = detail?.status ?? -1;
              const date = o.blockTimestamp !== "0"
                ? new Date(Number(o.blockTimestamp) * 1000).toLocaleDateString()
                : "";

              return (
                <div
                  key={o.orderId}
                  style={s.row}
                  onClick={() => navigate(`/checkout/order/${o.orderId}`)}
                >
                  <span style={{ width: 60, fontWeight: "600" }}>#{o.orderId}</span>
                  <span style={{ flex: 2, color: "#888", fontSize: "12px", fontFamily: "monospace" }}>
                    {o.user.slice(0, 10)}...{o.user.slice(-6)}
                  </span>
                  <span style={{ width: 80, textAlign: "right" }}>
                    {formatUnits(BigInt(o.amount), USDC_DECIMALS)}
                  </span>
                  <span style={{ width: 60, textAlign: "center", fontSize: "12px" }}>
                    {currency}
                  </span>
                  <span style={{ width: 80, textAlign: "center" }}>
                    <span
                      style={{
                        fontSize: "11px",
                        padding: "2px 8px",
                        borderRadius: "999px",
                        background: "#12121f",
                        color: statusColor(status),
                      }}
                    >
                      {statusLabel(status)}
                    </span>
                  </span>
                  <span style={{ width: 100, textAlign: "right", color: "#888", fontSize: "12px" }}>
                    {date}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          <div style={{ display: "flex", gap: "8px", marginTop: "12px", justifyContent: "center" }}>
            <button
              style={s.pageBtn}
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              Prev
            </button>
            <span style={{ color: "#888", fontSize: "13px", alignSelf: "center" }}>
              Page {page + 1}
            </span>
            <button
              style={s.pageBtn}
              disabled={b2bOrders.length < PAGE_SIZE}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  title: { fontSize: "22px", fontWeight: "700", marginBottom: "24px" },
  table: {
    background: "#1a1a2e",
    borderRadius: "12px",
    border: "1px solid #2a2a4a",
    overflow: "hidden",
  },
  headerRow: {
    display: "flex",
    alignItems: "center",
    padding: "10px 16px",
    fontSize: "12px",
    color: "#888",
    borderBottom: "1px solid #2a2a4a",
    gap: "8px",
  },
  row: {
    display: "flex",
    alignItems: "center",
    padding: "10px 16px",
    fontSize: "14px",
    borderBottom: "1px solid #12121f",
    cursor: "pointer",
    gap: "8px",
  },
  pageBtn: {
    padding: "6px 14px",
    background: "#2a2a4a",
    border: "none",
    borderRadius: "6px",
    color: "#fff",
    fontSize: "13px",
    cursor: "pointer",
  },
};
