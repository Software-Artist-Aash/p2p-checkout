import { useEffect, useState, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useSendTransaction } from "@privy-io/react-auth";
import { useCheckoutWallet } from "../hooks/use-checkout-wallet";
import { getRelayIdentity } from "@p2pdotme/sdk/payload";
import {
  createPublicClient,
  http,
  formatUnits,
  encodeFunctionData,
  decodeEventLog,
  stringToHex,
  fromHex,
} from "viem";
import { baseSepolia, base } from "viem/chains";
import { USDC_DECIMALS, CHAIN_ID, CURRENCIES, type CurrencyConfig } from "../lib/config";
import { CLIENT_ABI, INTEGRATOR_ABI, OrderStatus } from "../lib/contracts";
import { fetchUserOrders, type SubgraphOrder } from "../lib/subgraph";
import { decodeCheckoutPayload, saveOrderRedirect } from "../lib/checkout-link";
import { S, color, radius, font, weight, shadow, space, statusMeta } from "../lib/theme";

const chain = CHAIN_ID === 84532 ? baseSepolia : base;
const publicClient = createPublicClient({ chain, transport: http() });

const CHECKOUT_ORDER_CREATED_EVENT = {
  type: "event" as const,
  name: "CheckoutOrderCreated",
  inputs: [
    { name: "orderId", type: "uint256", indexed: true },
    { name: "user", type: "address", indexed: true },
    { name: "client", type: "address", indexed: true },
    { name: "productId", type: "uint256", indexed: false },
    { name: "usdcAmount", type: "uint256", indexed: false },
  ],
};

const B2B_ORDER_PLACED_EVENT = {
  type: "event" as const,
  name: "B2BOrderPlaced",
  inputs: [
    { name: "orderId", type: "uint256", indexed: true },
    { name: "integrator", type: "address", indexed: true },
    { name: "user", type: "address", indexed: true },
    { name: "amount", type: "uint256", indexed: false },
  ],
};

type Tab = "checkout" | "history";

export default function CheckoutPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { ready, authenticated, login, logout, address } = useCheckoutWallet();
  const { sendTransaction } = useSendTransaction();

  const sessionToken = searchParams.get("session");
  const sessionPayload = sessionToken ? decodeCheckoutPayload(sessionToken) : null;

  const integratorAddr = (sessionPayload?.integrator ?? searchParams.get("integrator") ?? "") as `0x${string}`;
  const clientAddr = (sessionPayload?.client ?? searchParams.get("client") ?? "") as `0x${string}`;
  const productId = sessionPayload?.productId?.toString() ?? searchParams.get("productId") ?? "0";
  const quantity = Math.max(1, sessionPayload?.quantity ?? Number(searchParams.get("quantity") ?? "1"));
  const defaultCurrency = sessionPayload?.currency ?? searchParams.get("currency") ?? "INR";
  const redirectUrl = sessionPayload?.redirectUrl ?? null;

  const [tab, setTab] = useState<Tab>("checkout");
  const [selectedCurrency, setSelectedCurrency] = useState<CurrencyConfig>(
    CURRENCIES.find((c) => c.symbol === defaultCurrency) ?? CURRENCIES[0]
  );
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);
  const [productPrice, setProductPrice] = useState<bigint | null>(null);
  const [txLimit, setTxLimit] = useState<bigint | null>(null);
  const [remainingCount, setRemainingCount] = useState<bigint | null>(null);
  const [dailyCountLimit, setDailyCountLimit] = useState<bigint | null>(null);
  const [isPlacing, setIsPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoLoginAttempted, setAutoLoginAttempted] = useState(false);

  const [orders, setOrders] = useState<SubgraphOrder[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // Auto-prompt login if redirected from merchant
  useEffect(() => {
    if (!ready || authenticated || autoLoginAttempted) return;
    if (!sessionPayload) return;
    setAutoLoginAttempted(true);
    login();
  }, [ready, authenticated, sessionPayload, autoLoginAttempted, login]);

  // Product price
  useEffect(() => {
    if (!clientAddr || clientAddr === "0x") return;
    setLoading(true);
    publicClient.readContract({
      address: clientAddr,
      abi: CLIENT_ABI,
      functionName: "getProductPrice",
      args: [BigInt(productId)],
    })
      .then(setProductPrice)
      .catch((err) => { console.error(err); setError("Failed to fetch product price."); })
      .finally(() => setLoading(false));
  }, [clientAddr, productId]);

  // Limits (V2 functions)
  useEffect(() => {
    if (!integratorAddr || integratorAddr === "0x" || !address) return;
    const V2_ABI = [
      { name: "getUserTxLimit", type: "function", stateMutability: "view", inputs: [{ name: "user", type: "address" }, { name: "currency", type: "bytes32" }], outputs: [{ name: "", type: "uint256" }] },
      { name: "getRemainingDailyCount", type: "function", stateMutability: "view", inputs: [{ name: "user", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
      { name: "dailyTxCountLimit", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
    ] as const;
    const curBytes = stringToHex(selectedCurrency.symbol, { size: 32 });
    Promise.all([
      publicClient.readContract({ address: integratorAddr, abi: V2_ABI, functionName: "getUserTxLimit", args: [address, curBytes] }).catch(() => null),
      publicClient.readContract({ address: integratorAddr, abi: V2_ABI, functionName: "getRemainingDailyCount", args: [address] }).catch(() => null),
      publicClient.readContract({ address: integratorAddr, abi: V2_ABI, functionName: "dailyTxCountLimit" }).catch(() => null),
    ]).then(([t, r, d]) => {
      if (t !== null) setTxLimit(t);
      if (r !== null) setRemainingCount(r);
      if (d !== null) setDailyCountLimit(d);
    });
  }, [integratorAddr, address, selectedCurrency.symbol]);

  const loadHistory = useCallback(async () => {
    if (!address) return;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      setOrders(await fetchUserOrders(address));
    } catch (err: any) {
      setHistoryError(err?.message ?? "Failed to load orders");
    } finally {
      setHistoryLoading(false);
    }
  }, [address]);

  useEffect(() => { if (tab === "history" && address) loadHistory(); }, [tab, address, loadHistory]);

  const handlePay = async () => {
    if (!address || !productPrice) return;
    setIsPlacing(true);
    setError(null);
    try {
      const relayResult = getRelayIdentity();
      if (relayResult.isErr()) throw new Error(relayResult.error.message);
      const pubKey = relayResult.value.publicKey;
      const currency = stringToHex(selectedCurrency.symbol, { size: 32 });

      const data = encodeFunctionData({
        abi: INTEGRATOR_ABI,
        functionName: "userPlaceOrder",
        args: [clientAddr, BigInt(productId), BigInt(quantity), currency, BigInt(selectedCurrency.circleId), pubKey, 0n, 0n],
      });
      const { hash } = await sendTransaction({ to: integratorAddr, data, gasLimit: 600000 });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      let orderId: string | null = null;
      for (const log of receipt.logs) {
        try {
          const d = decodeEventLog({ abi: [CHECKOUT_ORDER_CREATED_EVENT], data: log.data, topics: log.topics });
          if (d.eventName === "CheckoutOrderCreated") { orderId = (d.args as any).orderId.toString(); break; }
        } catch {}
      }
      if (!orderId) {
        for (const log of receipt.logs) {
          try {
            const d = decodeEventLog({ abi: [B2B_ORDER_PLACED_EVENT], data: log.data, topics: log.topics });
            if (d.eventName === "B2BOrderPlaced") { orderId = (d.args as any).orderId.toString(); break; }
          } catch {}
        }
      }

      if (orderId) {
        if (redirectUrl) saveOrderRedirect(orderId, redirectUrl);
        navigate(`/checkout/order/${orderId}`);
      } else {
        setError("Order placed but could not parse order ID.");
      }
    } catch (err: any) {
      setError(err?.shortMessage || err?.message || "Failed to place order");
    } finally {
      setIsPlacing(false);
    }
  };

  if (!integratorAddr || !clientAddr || !productId) {
    return (
      <div style={pageStyles.page}>
        <div style={{ ...S.card, padding: "32px", maxWidth: 420, margin: "80px auto" }}>
          <h2 style={S.h2}>Invalid Checkout Link</h2>
          <p style={{ ...S.muted, marginTop: 8 }}>Missing required parameters.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={pageStyles.page}>
      <TopBar address={address} authenticated={authenticated} onLogout={logout} />

      <div style={pageStyles.shell}>
        {/* Tab bar */}
        {authenticated && (
          <div style={pageStyles.tabBar}>
            <TabButton active={tab === "checkout"} onClick={() => setTab("checkout")}>Checkout</TabButton>
            <TabButton active={tab === "history"} onClick={() => setTab("history")}>History</TabButton>
          </div>
        )}

        {tab === "checkout" ? (
          <div style={pageStyles.twoCol} data-two-col="true">
            {/* LEFT — Order Summary */}
            <section style={{ ...S.cardFlat, padding: "24px" }}>
              <p style={S.label}>Order Summary</p>
              <h1 style={{ ...S.h1, marginTop: 4, fontSize: font.display }}>
                <span style={S.num}>
                  {productPrice ? formatUnits(productPrice * BigInt(quantity), USDC_DECIMALS) : "—"}
                </span>{" "}
                <span style={{ fontSize: font.lg, color: color.textMuted, fontWeight: weight.medium }}>USDC</span>
              </h1>

              <div style={{ marginTop: 24, display: "flex", alignItems: "center", gap: 16 }}>
                <div style={pageStyles.productThumb}>
                  <span style={{ fontSize: 28 }}>🎟️</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ ...S.body, fontWeight: weight.medium, margin: 0 }}>Product #{productId}</p>
                  <p style={{ ...S.faint, margin: "2px 0 0" }}>
                    Qty {quantity} · Delivered as NFT{quantity > 1 ? "s" : ""} to your wallet
                  </p>
                </div>
                <span style={{ ...S.body, fontWeight: weight.semibold, ...S.num }}>
                  {productPrice ? formatUnits(productPrice * BigInt(quantity), USDC_DECIMALS) : "—"}
                </span>
              </div>

              <div style={S.divider} />

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={S.rowBetween}>
                  <span style={S.muted}>Unit price</span>
                  <span style={{ ...S.body, ...S.num }}>
                    {productPrice ? formatUnits(productPrice, USDC_DECIMALS) : "—"} USDC
                  </span>
                </div>
                <div style={S.rowBetween}>
                  <span style={S.muted}>Quantity</span>
                  <span style={{ ...S.body, ...S.num }}>× {quantity}</span>
                </div>
                <div style={S.rowBetween}>
                  <span style={S.muted}>Network fee</span>
                  <span style={S.muted}>Paid by merchant</span>
                </div>
              </div>

              <div style={S.divider} />

              <div style={S.rowBetween}>
                <span style={{ ...S.body, fontWeight: weight.semibold }}>Total</span>
                <span style={{ fontSize: font.xl, fontWeight: weight.bold, ...S.num }}>
                  {productPrice ? formatUnits(productPrice * BigInt(quantity), USDC_DECIMALS) : "—"} USDC
                </span>
              </div>
            </section>

            {/* RIGHT — Payment */}
            <section style={{ ...S.card, padding: "24px" }}>
              <p style={S.label}>Pay with</p>
              <h2 style={{ ...S.h2, marginTop: 4, marginBottom: 16 }}>P2P Checkout</h2>

              {!ready ? (
                <Loader label="Loading wallet..." />
              ) : !authenticated ? (
                <>
                  <p style={{ ...S.muted, marginBottom: 16 }}>Sign in to continue</p>
                  <button style={S.primaryBtn} onClick={login}>
                    Connect Wallet
                  </button>
                </>
              ) : (
                <>
                  {/* Currency picker */}
                  <div style={{ marginBottom: 20 }}>
                    <label style={{ ...S.label, display: "block", marginBottom: 6 }}>Currency</label>
                    <button
                      style={pageStyles.currencyBtn}
                      onClick={() => setShowCurrencyPicker(!showCurrencyPicker)}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 18 }}>{selectedCurrency.flag}</span>
                        <span style={{ fontWeight: weight.semibold }}>{selectedCurrency.symbol}</span>
                        <span style={S.faint}>· {selectedCurrency.paymentMethod}</span>
                      </span>
                      <span style={{ color: color.textMuted, fontSize: 12 }}>
                        {showCurrencyPicker ? "▲" : "▼"}
                      </span>
                    </button>
                    {showCurrencyPicker && (
                      <div style={pageStyles.currencyDropdown}>
                        {CURRENCIES.map((c) => (
                          <button
                            key={c.symbol}
                            style={{
                              ...pageStyles.currencyOption,
                              background: c.symbol === selectedCurrency.symbol ? color.accentSoft : "transparent",
                            }}
                            onClick={() => {
                              setSelectedCurrency(c);
                              setShowCurrencyPicker(false);
                            }}
                          >
                            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ fontSize: 16 }}>{c.flag}</span>
                              <span style={{ fontWeight: weight.medium }}>{c.symbol}</span>
                            </span>
                            <span style={S.faint}>{c.paymentMethod}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Limits strip */}
                  <div style={pageStyles.limitStrip}>
                    <div>
                      <p style={S.label}>Per-tx limit</p>
                      <p style={{ ...S.body, fontWeight: weight.semibold, marginTop: 2, ...S.num }}>
                        {txLimit !== null ? formatUnits(txLimit, USDC_DECIMALS) : "—"} USDC
                      </p>
                    </div>
                    <div style={{ width: 1, background: color.border }} />
                    <div>
                      <p style={S.label}>Today</p>
                      <p style={{ ...S.body, fontWeight: weight.semibold, marginTop: 2, ...S.num }}>
                        {remainingCount !== null && dailyCountLimit !== null
                          ? `${(Number(dailyCountLimit) - Number(remainingCount))} / ${dailyCountLimit.toString()}`
                          : "—"}
                      </p>
                    </div>
                  </div>

                  {error && (
                    <div style={pageStyles.errorBox}>
                      <span style={{ color: color.danger, fontSize: font.md }}>{error}</span>
                    </div>
                  )}

                  <button
                    style={{ ...S.primaryBtn, marginTop: 16, opacity: isPlacing || !productPrice ? 0.5 : 1 }}
                    onClick={handlePay}
                    disabled={isPlacing || !productPrice}
                  >
                    {isPlacing ? "Placing order..." : loading ? "Loading..." : "Pay now"}
                  </button>

                  <p style={{ ...S.faint, textAlign: "center", marginTop: 12 }}>
                    You'll pay {selectedCurrency.symbol} via {selectedCurrency.paymentMethod} to a verified merchant.
                  </p>
                </>
              )}
            </section>
          </div>
        ) : (
          <HistoryPanel
            loading={historyLoading}
            error={historyError}
            orders={orders}
            onRefresh={loadHistory}
            onOpen={(id) => navigate(`/checkout/order/${id}`)}
          />
        )}
      </div>

      <Footer />
    </div>
  );
}

// ─── Components ──────────────────────────────────────────────────

function TopBar({ address, authenticated, onLogout }: {
  address?: `0x${string}`; authenticated: boolean; onLogout: () => void;
}) {
  return (
    <header style={pageStyles.topBar}>
      <div style={pageStyles.topBarInner}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={pageStyles.logo}>P</div>
          <span style={{ fontWeight: weight.semibold, fontSize: font.lg }}>P2P Checkout</span>
        </div>
        {authenticated && address && (
          <button style={pageStyles.walletChip} onClick={onLogout}>
            <span style={pageStyles.walletDot} />
            <span style={S.mono}>{address.slice(0, 6)}…{address.slice(-4)}</span>
          </button>
        )}
      </div>
    </header>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "8px 14px",
        borderRadius: radius.md,
        border: "none",
        fontSize: font.base,
        fontWeight: active ? weight.semibold : weight.medium,
        cursor: "pointer",
        background: active ? color.surface : "transparent",
        color: active ? color.text : color.textMuted,
        boxShadow: active ? shadow.sm : "none",
      }}
    >
      {children}
    </button>
  );
}

function Loader({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, color: color.textMuted }}>
      <div style={pageStyles.spinner} />
      <span style={S.md}>{label}</span>
    </div>
  );
}

function Footer() {
  return (
    <footer style={pageStyles.footer}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, color: color.textMuted, fontSize: font.sm }}>
        <LockIcon />
        <span>Powered by</span>
        <span style={{ fontWeight: weight.semibold, color: color.text }}>P2P.me</span>
      </div>
    </footer>
  );
}

function LockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
    </svg>
  );
}

// ─── History Panel ──────────────────────────────────────────────

function HistoryPanel({ loading, error, orders, onRefresh, onOpen }: {
  loading: boolean; error: string | null;
  orders: SubgraphOrder[];
  onRefresh: () => void;
  onOpen: (orderId: string) => void;
}) {
  return (
    <section style={{ ...S.card, padding: 0 }}>
      <div style={{ padding: "20px 24px", borderBottom: `1px solid ${color.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={S.h3}>Order history</h2>
        <button style={S.ghostBtn} onClick={onRefresh} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {loading ? (
        <div style={{ padding: "48px 24px", textAlign: "center" as const }}><Loader label="Loading orders…" /></div>
      ) : error ? (
        <div style={{ padding: "24px" }}><span style={{ color: color.danger }}>{error}</span></div>
      ) : orders.length === 0 ? (
        <div style={{ padding: "48px 24px", textAlign: "center" as const }}>
          <p style={{ ...S.body, fontWeight: weight.medium }}>No orders yet</p>
          <p style={{ ...S.faint, marginTop: 4 }}>Your orders will appear here once placed.</p>
        </div>
      ) : (
        <div>
          {orders.map((o, i) => <OrderRow key={o.orderId} order={o} divider={i > 0} onClick={() => onOpen(o.orderId)} />)}
        </div>
      )}
    </section>
  );
}

function OrderRow({ order, divider, onClick }: { order: SubgraphOrder; divider: boolean; onClick: () => void }) {
  const status = statusMeta(order.status);
  const amount = order.actualUsdcAmount !== "0"
    ? formatUnits(BigInt(order.actualUsdcAmount), USDC_DECIMALS)
    : formatUnits(BigInt(order.usdcAmount), USDC_DECIMALS);

  let cur = "";
  try {
    cur = order.currency.startsWith("0x")
      ? fromHex(order.currency as `0x${string}`, "string").replace(/\0/g, "")
      : order.currency;
  } catch {}

  const when = order.placedAt !== "0"
    ? formatTimeAgo(new Date(Number(order.placedAt) * 1000))
    : "";

  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        width: "100%",
        alignItems: "center",
        gap: 16,
        padding: "16px 24px",
        background: "transparent",
        border: "none",
        borderTop: divider ? `1px solid ${color.border}` : "none",
        cursor: "pointer",
        textAlign: "left" as const,
        color: "inherit",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ ...S.body, fontWeight: weight.semibold }}>Order #{order.orderId}</span>
          <span style={{
            fontSize: font.xs, fontWeight: weight.medium,
            padding: "2px 8px", borderRadius: radius.pill,
            background: status.bg, color: status.color,
          }}>{status.label}</span>
        </div>
        <p style={{ ...S.faint, margin: "4px 0 0" }}>{cur} · {when}</p>
      </div>
      <span style={{ ...S.body, fontWeight: weight.semibold, ...S.num }}>{amount} USDC</span>
      <span style={{ color: color.textFaint }}>›</span>
    </button>
  );
}

function formatTimeAgo(date: Date): string {
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 30 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return date.toLocaleDateString();
}

// ─── Styles ─────────────────────────────────────────────────────

const pageStyles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: color.bg,
    display: "flex",
    flexDirection: "column",
  },
  topBar: {
    background: color.surface,
    borderBottom: `1px solid ${color.border}`,
    padding: "14px 24px",
  },
  topBarInner: {
    maxWidth: 960,
    margin: "0 auto",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  logo: {
    width: 28, height: 28, borderRadius: 8, background: color.accent,
    color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
    fontWeight: weight.bold, fontSize: 14,
  },
  walletChip: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    height: 32,
    padding: "0 10px 0 8px",
    background: color.surfaceAlt,
    border: `1px solid ${color.border}`,
    borderRadius: radius.pill,
    fontSize: font.md,
    color: color.text,
    cursor: "pointer",
  },
  walletDot: {
    width: 8, height: 8, borderRadius: 999, background: color.success,
  },
  shell: {
    flex: 1,
    maxWidth: 960,
    width: "100%",
    margin: "0 auto",
    padding: "32px 24px",
    boxSizing: "border-box",
  },
  tabBar: {
    display: "inline-flex",
    gap: 4,
    padding: 4,
    background: color.surfaceAlt,
    border: `1px solid ${color.border}`,
    borderRadius: radius.md,
    marginBottom: 24,
  },
  twoCol: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 24,
  },
  productThumb: {
    width: 48, height: 48,
    background: color.accentSoft,
    borderRadius: radius.md,
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  currencyBtn: {
    width: "100%",
    height: 44,
    padding: "0 14px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    background: color.surface,
    border: `1px solid ${color.border}`,
    borderRadius: radius.md,
    fontSize: font.base,
    color: color.text,
    cursor: "pointer",
  },
  currencyDropdown: {
    marginTop: 4,
    border: `1px solid ${color.border}`,
    borderRadius: radius.md,
    background: color.surface,
    boxShadow: shadow.pop,
    overflow: "hidden",
    animation: "fade-in 120ms ease-out",
  },
  currencyOption: {
    width: "100%",
    padding: "10px 14px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    background: "transparent",
    border: "none",
    borderBottom: `1px solid ${color.border}`,
    fontSize: font.md,
    color: color.text,
    cursor: "pointer",
  },
  limitStrip: {
    display: "flex",
    gap: 16,
    padding: "12px 14px",
    background: color.surfaceAlt,
    borderRadius: radius.md,
    marginBottom: 12,
  },
  errorBox: {
    marginTop: 12,
    padding: "10px 12px",
    background: color.dangerSoft,
    border: `1px solid ${color.danger}22`,
    borderRadius: radius.md,
  },
  spinner: {
    width: 16, height: 16,
    border: `2px solid ${color.border}`,
    borderTopColor: color.accent,
    borderRadius: "50%",
    animation: "spin 800ms linear infinite",
  },
  footer: {
    padding: "24px",
    display: "flex",
    justifyContent: "center",
  },
};

// Mobile stacking
if (typeof document !== "undefined") {
  const id = "checkout-responsive";
  if (!document.getElementById(id)) {
    const style = document.createElement("style");
    style.id = id;
    style.textContent = `
      @media (max-width: 720px) {
        [data-two-col="true"] { grid-template-columns: 1fr !important; }
      }
    `;
    document.head.appendChild(style);
  }
}
