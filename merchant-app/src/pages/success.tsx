import { Link, useSearchParams } from "react-router-dom";
import { PRODUCTS } from "../lib/config";

export default function Success() {
  const [params] = useSearchParams();
  const orderId = params.get("orderId");
  const productIdParam = params.get("productId");
  const product = productIdParam
    ? PRODUCTS.find((p) => p.id === Number(productIdParam))
    : null;

  const viewNftsHref = productIdParam
    ? `/my-nfts?orderId=${orderId ?? ""}&productId=${productIdParam}`
    : "/my-nfts";

  return (
    <div style={s.page}>
      <div style={s.card}>
        <div style={s.checkmark}>✓</div>
        <h1 style={s.title}>Payment successful</h1>
        <p style={s.subtitle}>
          Your order has been confirmed and the NFT minted to your wallet.
        </p>

        {product && (
          <div style={s.productRow}>
            <img src={product.image} alt={product.name} style={s.productImage} />
            <div style={{ textAlign: "left" }}>
              <p style={s.productLabel}>You purchased</p>
              <h3 style={s.productName}>{product.name}</h3>
            </div>
          </div>
        )}

        {orderId && (
          <p style={s.orderRow}>
            <span style={s.orderLabel}>Order</span>
            <span style={s.orderValue}>#{orderId}</span>
          </p>
        )}

        <Link to={viewNftsHref} style={s.primaryBtn}>View My NFTs</Link>
        <Link to="/" style={s.secondaryBtn}>Back to shop</Link>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh", background: "#fafafa", fontFamily: "Inter, system-ui, sans-serif",
    color: "#0a0b0d", display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
  },
  card: {
    background: "#fff", border: "1px solid #eaeaea", borderRadius: 16,
    padding: "40px 32px", maxWidth: 420, width: "100%", textAlign: "center" as const,
    boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.04)",
  },
  checkmark: {
    width: 64, height: 64, borderRadius: "50%", background: "#22c55e", color: "#fff",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 32, fontWeight: 700, margin: "0 auto 20px",
  },
  title: { fontSize: 24, fontWeight: 700, margin: "0 0 8px", letterSpacing: "-0.02em" },
  subtitle: { fontSize: 14, color: "#6b6b6b", margin: "0 0 24px", lineHeight: 1.5 },
  productRow: {
    display: "flex", alignItems: "center", gap: 14, padding: 14,
    background: "#fafafa", borderRadius: 12, marginBottom: 16,
  },
  productImage: { width: 56, height: 56, borderRadius: 10, objectFit: "cover" as const },
  productLabel: { fontSize: 11, color: "#9a9a9a", textTransform: "uppercase" as const, letterSpacing: "0.06em", margin: 0, fontWeight: 500 },
  productName: { fontSize: 15, fontWeight: 600, margin: "4px 0 0" },
  orderRow: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "12px 14px", background: "#fafafa", borderRadius: 10, margin: "0 0 20px",
  },
  orderLabel: { fontSize: 12, color: "#6b6b6b", fontWeight: 500 },
  orderValue: { fontSize: 13, fontWeight: 600, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
  primaryBtn: {
    display: "block", width: "100%", padding: "12px 18px", background: "#7C3AED",
    color: "#fff", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 600,
    cursor: "pointer", textDecoration: "none", textAlign: "center" as const, marginBottom: 8,
    boxSizing: "border-box" as const,
  },
  secondaryBtn: {
    display: "block", width: "100%", padding: "12px 18px", background: "#fff",
    color: "#0a0b0d", border: "1px solid #eaeaea", borderRadius: 10, fontSize: 14, fontWeight: 500,
    cursor: "pointer", textDecoration: "none", textAlign: "center" as const,
    boxSizing: "border-box" as const,
  },
};
