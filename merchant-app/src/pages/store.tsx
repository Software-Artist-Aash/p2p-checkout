import { useState, useMemo, useCallback } from "react";
import { usePrivy, useSendTransaction } from "@privy-io/react-auth";
import { createPublicClient, http, encodeFunctionData, stringToHex, keccak256, toHex } from "viem";
import { baseSepolia } from "viem/chains";
import { getRelayIdentity } from "@p2pdotme/sdk/payload";

const KNOWN_ERRORS: Record<string, string> = {
  "0xfb42a67d": "Currency mismatch — the merchant circle doesn't support this currency.",
  "0x9e05e975": "Client not registered on the integrator.",
  "0x79de4af5": "Product not found — price not set for this product.",
  "0x524f409b": "Quantity must be at least 1.",
  "0xea8e4eb5": "Not authorized — daily transaction limit reached or per-tx limit exceeded.",
  "0x5fc483c5": "Only the integrator owner can do this.",
};

function decodeRevertReason(err: any): string {
  // Viem wraps revert data in nested cause objects
  const data = err?.cause?.data?.data ?? err?.data?.data ?? err?.data ?? err?.cause?.data ?? "";
  if (typeof data === "string" && data.startsWith("0x") && data.length >= 10) {
    const selector = data.slice(0, 10);
    const known = KNOWN_ERRORS[selector];
    if (known) return known;
  }
  // Fallback to viem's shortMessage or the raw message
  const msg = err?.shortMessage || err?.cause?.shortMessage || err?.message || "";
  if (msg.includes("reverted")) return "Transaction would fail. Check your limits and try a smaller amount.";
  if (msg.includes("rejected") || msg.includes("denied")) return "Transaction rejected in wallet.";
  if (msg.includes("insufficient funds")) return "Insufficient funds for gas.";
  return msg || "Transaction failed. Please try again.";
}
import {
  P2PCheckout,
  parseOrderIdFromReceipt,
  type CheckoutSigner,
  type PlaceOrderResult,
} from "@p2pdotme/checkout-widget";
import {
  INTEGRATOR_ADDRESS,
  CLIENT_ADDRESS,
  PRODUCTS,
} from "../lib/config";

const INTEGRATOR_ABI = [
  {
    name: "userPlaceOrder", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "client", type: "address" },
      { name: "productId", type: "uint256" },
      { name: "quantity", type: "uint256" },
      { name: "currency", type: "bytes32" },
      { name: "circleId", type: "uint256" },
      { name: "pubKey", type: "string" },
      { name: "preferredPaymentChannelConfigId", type: "uint256" },
      { name: "fiatAmountLimit", type: "uint256" },
    ],
    outputs: [{ name: "orderId", type: "uint256" }],
  },
] as const;

const publicClient = createPublicClient({ chain: baseSepolia, transport: http() });

export default function Store() {
  const { ready, authenticated, login, user, logout } = usePrivy();
  const { sendTransaction } = useSendTransaction();
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [checkoutProduct, setCheckoutProduct] = useState<number | null>(null);

  const qty = (id: number) => quantities[id] ?? 1;
  const setQty = (id: number, q: number) =>
    setQuantities({ ...quantities, [id]: Math.max(1, Math.min(10, q)) });

  const signer: CheckoutSigner | null = useMemo(() => {
    const addr = user?.wallet?.address;
    if (!addr) return null;
    return {
      address: addr as `0x${string}`,
      sendTransaction: async (tx) => {
        const result = await sendTransaction(tx, { sponsor: true });
        return { hash: result.hash as `0x${string}` };
      },
    };
  }, [user?.wallet?.address, sendTransaction]);

  const handleBuyNow = (productId: number) => {
    if (!authenticated) { login(); return; }
    setCheckoutProduct(productId);
  };

  const placeOrder = useCallback(async (): Promise<PlaceOrderResult> => {
    if (!signer || checkoutProduct === null) throw new Error("Not ready");

    const relayResult = getRelayIdentity();
    if (relayResult.isErr()) throw new Error(relayResult.error.message);
    const pubKey = relayResult.value.publicKey;
    const currency = stringToHex("INR", { size: 32 });
    const q = qty(checkoutProduct);

    const data = encodeFunctionData({
      abi: INTEGRATOR_ABI,
      functionName: "userPlaceOrder",
      args: [
        CLIENT_ADDRESS, BigInt(checkoutProduct), BigInt(q),
        currency, 1n, pubKey, 0n, 0n,
      ],
    });

    let gasLimit: bigint;
    try {
      const est = await publicClient.estimateGas({
        account: signer.address, to: INTEGRATOR_ADDRESS, data,
      });
      gasLimit = (est * 3n) / 2n;
    } catch (err: any) {
      throw new Error(decodeRevertReason(err));
    }

    const { hash } = await signer.sendTransaction({
      to: INTEGRATOR_ADDRESS, data, gasLimit: Number(gasLimit),
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    if (receipt.status === "reverted") {
      throw new Error("Transaction reverted on chain. You were not charged USDC.");
    }

    const orderId = parseOrderIdFromReceipt(receipt);
    if (!orderId) throw new Error("Order confirmed but could not read order ID from receipt.");

    return { orderId, txHash: hash };
  }, [signer, checkoutProduct, quantities]);

  const activeProduct = checkoutProduct !== null ? PRODUCTS.find((p) => p.id === checkoutProduct) : null;
  const activeQty = checkoutProduct !== null ? qty(checkoutProduct) : 1;

  return (
    <div style={s.page}>
      <header style={s.header}>
        <div style={s.headerInner}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={s.logo}>S</div>
            <span style={{ fontWeight: 600, fontSize: 16 }}>Demo Store</span>
          </div>
          {ready && (
            <div>
              {authenticated ? (
                <button style={s.walletChip} onClick={logout}>
                  <span style={s.walletDot} />
                  <span style={s.mono}>
                    {user?.wallet?.address?.slice(0, 6)}…
                    {user?.wallet?.address?.slice(-4)}
                  </span>
                </button>
              ) : (
                <button style={s.headerBtn} onClick={login}>Sign in</button>
              )}
            </div>
          )}
        </div>
      </header>

      <main style={s.main}>
        <div style={{ marginBottom: 32 }}>
          <h1 style={s.pageTitle}>Featured NFTs</h1>
          <p style={s.pageSubtitle}>
            Pay with fiat through the P2P checkout. Your USDC mints an NFT directly to your wallet.
          </p>
        </div>

        <div style={s.grid}>
          {PRODUCTS.map((p) => {
            const q = qty(p.id);
            const total = (p.priceUsdc * q).toFixed(p.priceUsdc % 1 === 0 ? 0 : 2);
            return (
              <div key={p.id} style={s.card}>
                <img src={p.image} alt={p.name} style={s.image} />
                <div style={s.cardBody}>
                  <h3 style={s.cardTitle}>{p.name}</h3>
                  <p style={s.cardDesc}>{p.description}</p>
                  <div style={s.priceRow}>
                    <span style={{ ...s.unitPrice, fontVariantNumeric: "tabular-nums" }}>${p.priceUsdc} USDC</span>
                    <span style={s.unitLabel}>per unit</span>
                  </div>
                  <div style={s.qtyRow}>
                    <span style={s.qtyLabel}>Quantity</span>
                    <div style={s.qtyControl}>
                      <button style={{ ...s.qtyBtn, opacity: q <= 1 ? 0.4 : 1 }} onClick={() => setQty(p.id, q - 1)} disabled={q <= 1}>−</button>
                      <span style={{ ...s.qtyValue, fontVariantNumeric: "tabular-nums" }}>{q}</span>
                      <button style={{ ...s.qtyBtn, opacity: q >= 10 ? 0.4 : 1 }} onClick={() => setQty(p.id, q + 1)} disabled={q >= 10}>+</button>
                    </div>
                  </div>
                  <div style={s.cardFooter}>
                    <div>
                      <span style={s.totalLabel}>Total</span>
                      <span style={{ ...s.totalPrice, fontVariantNumeric: "tabular-nums" }}>${total} USDC</span>
                    </div>
                    <button style={s.buyBtn} onClick={() => handleBuyNow(p.id)}>Buy now</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </main>

      <footer style={s.footer}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#6b6b6b", fontSize: 12 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          <span>Secure checkout powered by</span>
          <span style={{ fontWeight: 600, color: "#0a0b0d" }}>P2P.me</span>
        </div>
      </footer>

      {/* P2P widget — only handles the protocol flow, not the integrator call */}
      {checkoutProduct !== null && signer && (
        <P2PCheckout
          placeOrder={placeOrder}
          amount={activeProduct ? `${activeProduct.priceUsdc * activeQty} USDC` : undefined}
          productName={activeProduct ? `${activeProduct.name} × ${activeQty}` : undefined}
          signer={signer}
          demo={false}
          mode="modal"
          open={true}
          onClose={() => setCheckoutProduct(null)}
          onComplete={(orderId) => {
            setCheckoutProduct(null);
            window.location.href = `/success?orderId=${orderId}`;
          }}
          onError={(err) => console.error("Checkout error:", err)}
        />
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", background: "#fafafa", fontFamily: "Inter, system-ui, sans-serif", color: "#0a0b0d", display: "flex", flexDirection: "column" },
  header: { background: "#fff", borderBottom: "1px solid #eaeaea", padding: "14px 24px" },
  headerInner: { maxWidth: 1100, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center" },
  logo: { width: 28, height: 28, borderRadius: 8, background: "#0a0b0d", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14 },
  headerBtn: { padding: "8px 14px", background: "#0a0b0d", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" },
  walletChip: { display: "flex", alignItems: "center", gap: 8, height: 32, padding: "0 10px 0 8px", background: "#f5f5f5", border: "1px solid #eaeaea", borderRadius: 999, fontSize: 12, color: "#0a0b0d", cursor: "pointer" },
  walletDot: { width: 8, height: 8, borderRadius: 999, background: "#0f9b53" },
  mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
  main: { flex: 1, maxWidth: 1100, margin: "0 auto", padding: "48px 24px", width: "100%", boxSizing: "border-box" },
  pageTitle: { fontSize: 32, fontWeight: 700, letterSpacing: "-0.02em", margin: 0 },
  pageSubtitle: { color: "#6b6b6b", fontSize: 15, marginTop: 8 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20 },
  card: { background: "#fff", borderRadius: 12, overflow: "hidden", border: "1px solid #eaeaea", display: "flex", flexDirection: "column", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" },
  image: { width: "100%", aspectRatio: "1", objectFit: "cover" as const, borderBottom: "1px solid #eaeaea" },
  cardBody: { padding: 20, display: "flex", flexDirection: "column", gap: 12, flex: 1 },
  cardTitle: { fontSize: 16, fontWeight: 600, margin: 0, letterSpacing: "-0.01em" },
  cardDesc: { color: "#6b6b6b", fontSize: 13, margin: 0, lineHeight: 1.5 },
  priceRow: { display: "flex", alignItems: "baseline", gap: 6 },
  unitPrice: { fontSize: 18, fontWeight: 700 },
  unitLabel: { fontSize: 12, color: "#9a9a9a" },
  qtyRow: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderTop: "1px solid #f0f0f0", borderBottom: "1px solid #f0f0f0" },
  qtyLabel: { fontSize: 13, color: "#6b6b6b", fontWeight: 500 },
  qtyControl: { display: "flex", alignItems: "center", gap: 0, background: "#f5f5f5", borderRadius: 8, padding: 3 },
  qtyBtn: { width: 28, height: 28, background: "#fff", border: "1px solid #eaeaea", borderRadius: 6, fontSize: 16, fontWeight: 500, cursor: "pointer", color: "#0a0b0d" },
  qtyValue: { minWidth: 28, textAlign: "center" as const, fontSize: 14, fontWeight: 600, padding: "0 4px" },
  cardFooter: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginTop: "auto" },
  totalLabel: { display: "block", fontSize: 11, color: "#9a9a9a", textTransform: "uppercase" as const, letterSpacing: "0.06em", fontWeight: 500, marginBottom: 2 },
  totalPrice: { fontSize: 18, fontWeight: 700 },
  buyBtn: { padding: "10px 18px", background: "#7C3AED", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer" },
  footer: { padding: "24px", display: "flex", justifyContent: "center" },
};
