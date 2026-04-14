import { useParams } from "react-router-dom";
import { useEffect, useState, useCallback, useRef } from "react";
import { useSendTransaction } from "@privy-io/react-auth";
import { useCheckoutWallet } from "../hooks/use-checkout-wallet";
import { decryptPaymentAddress } from "@p2pdotme/sdk/payload";
import { createPublicClient, http, formatUnits, encodeFunctionData, fromHex } from "viem";
import { baseSepolia, base } from "viem/chains";
import { CHAIN_ID, DIAMOND_ADDRESS, USDC_DECIMALS, CURRENCIES } from "../lib/config";
import { DIAMOND_ABI, OrderStatus } from "../lib/contracts";
import { getOrderRedirect, buildRedirectBackUrl } from "../lib/checkout-link";
import { S, color, radius, font, weight, shadow } from "../lib/theme";

const chain = CHAIN_ID === 84532 ? baseSepolia : base;
const publicClient = createPublicClient({ chain, transport: http() });

interface OrderData {
  amount: bigint;
  fiatAmount: bigint;
  status: number;
  encUpi: string;
  currency: string;
  acceptedMerchant: string;
  completedTimestamp: bigint;
}

export default function CheckoutOrderPage() {
  const { orderId: orderIdParam } = useParams<{ orderId: string }>();
  const { address, logout } = useCheckoutWallet();
  const { sendTransaction } = useSendTransaction();

  const orderId = BigInt(orderIdParam ?? "0");

  const [order, setOrder] = useState<OrderData | null>(null);
  const [actualFiatAmount, setActualFiatAmount] = useState<bigint | null>(null);
  const [decryptedUpi, setDecryptedUpi] = useState<string | null>(null);
  const [decryptError, setDecryptError] = useState<string | null>(null);
  const [isMarkingPaid, setIsMarkingPaid] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [redirectCountdown, setRedirectCountdown] = useState<number | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchOrder = useCallback(async () => {
    if (!DIAMOND_ADDRESS || orderId === 0n) return;
    try {
      const [rawOrder, details] = await Promise.all([
        publicClient.readContract({ address: DIAMOND_ADDRESS, abi: DIAMOND_ABI, functionName: "getOrdersById", args: [orderId] }),
        publicClient.readContract({ address: DIAMOND_ADDRESS, abi: DIAMOND_ABI, functionName: "getAdditionalOrderDetails", args: [orderId] }),
      ]);
      const o = rawOrder as any;
      let cur = "";
      try { cur = fromHex(o.currency as `0x${string}`, "string").replace(/\0/g, ""); } catch { cur = o.currency; }
      setOrder({
        amount: o.amount, fiatAmount: o.fiatAmount,
        status: Number(o.status), encUpi: o.encUpi,
        currency: cur, acceptedMerchant: o.acceptedMerchant,
        completedTimestamp: o.completedTimestamp,
      });
      const d = details as any;
      setActualFiatAmount(d.actualFiatAmount > 0n ? d.actualFiatAmount : o.fiatAmount);
    } catch (err) { console.error(err); }
  }, [orderId]);

  useEffect(() => {
    fetchOrder();
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [fetchOrder]);

  useEffect(() => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    if (!order) return;
    let interval: number | null = null;
    if (order.status === OrderStatus.PLACED) interval = 3000;
    else if (order.status === OrderStatus.PAID) interval = 10000;
    if (interval) pollingRef.current = setInterval(fetchOrder, interval);
  }, [order?.status, fetchOrder]);

  // Auto-redirect on completion
  useEffect(() => {
    if (order?.status !== OrderStatus.COMPLETED) return;
    const url = getOrderRedirect(orderIdParam ?? "");
    if (!url) return;
    setRedirectCountdown(5);
    const interval = setInterval(() => {
      setRedirectCountdown((c) => {
        if (c === null || c <= 1) {
          clearInterval(interval);
          window.location.href = buildRedirectBackUrl(url, orderIdParam ?? "");
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [order?.status, orderIdParam]);

  // Decrypt payment address
  useEffect(() => {
    if (!order || order.status < OrderStatus.ACCEPTED) return;
    if (decryptedUpi || decryptError) return;
    (async () => {
      const result = await decryptPaymentAddress(order.encUpi);
      if (result.isOk()) setDecryptedUpi(result.value);
      else { setDecryptedUpi("Session changed"); setDecryptError("session-changed"); }
    })();
  }, [order?.status, order?.encUpi, decryptedUpi, decryptError]);

  const handleMarkPaid = async () => {
    if (!address) return;
    setIsMarkingPaid(true); setError(null);
    try {
      const data = encodeFunctionData({ abi: DIAMOND_ABI, functionName: "paidBuyOrder", args: [orderId] });
      const { hash } = await sendTransaction({ to: DIAMOND_ADDRESS, data, gasLimit: 300000 });
      await publicClient.waitForTransactionReceipt({ hash });
      await fetchOrder();
    } catch (err: any) {
      setError(err?.shortMessage || err?.message || "Failed to mark as paid");
    } finally { setIsMarkingPaid(false); }
  };

  const handleCancel = async () => {
    if (!address) return;
    setIsCancelling(true); setError(null);
    try {
      const data = encodeFunctionData({
        abi: [{ name: "cancelOrder", type: "function", stateMutability: "nonpayable",
          inputs: [{ name: "_orderId", type: "uint256" }], outputs: [] }],
        functionName: "cancelOrder", args: [orderId],
      });
      const { hash } = await sendTransaction({ to: DIAMOND_ADDRESS, data, gasLimit: 300000 });
      await publicClient.waitForTransactionReceipt({ hash });
      setShowCancelConfirm(false);
      await fetchOrder();
    } catch (err: any) {
      setError(err?.shortMessage || err?.message || "Failed to cancel order");
    } finally { setIsCancelling(false); }
  };

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1400);
  };

  const currencyConfig = order ? CURRENCIES.find((c) => c.symbol === order.currency) : null;
  const isCompound = currencyConfig && "compoundFields" in currencyConfig && currencyConfig.compoundFields;
  const compoundParts = decryptedUpi && isCompound ? decryptedUpi.split("|") : [];

  const fiatDisplay = actualFiatAmount
    ? (Number(actualFiatAmount) / 1e6).toFixed(2)
    : order ? (Number(order.fiatAmount) / 1e6).toFixed(2) : "—";
  const usdcDisplay = order ? formatUnits(order.amount, USDC_DECIMALS) : "—";
  const status = order?.status ?? -1;

  return (
    <div style={pageStyles.page}>
      <header style={pageStyles.topBar}>
        <div style={pageStyles.topBarInner}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={pageStyles.logo}>P</div>
            <span style={{ fontWeight: weight.semibold, fontSize: font.lg }}>P2P Checkout</span>
          </div>
          {address && (
            <button style={pageStyles.walletChip} onClick={logout}>
              <span style={pageStyles.walletDot} />
              <span style={S.mono}>{address.slice(0, 6)}…{address.slice(-4)}</span>
            </button>
          )}
        </div>
      </header>

      <div style={pageStyles.shell}>
        {/* Progress */}
        <Stepper status={status} />

        {/* Status card */}
        <section style={{ ...S.card, padding: "32px", marginTop: 20 }}>
          {status === -1 && <CenterLoader label="Loading order…" />}

          {status === OrderStatus.PLACED && (
            <CenterStatus
              icon={<PulseDot />}
              title="Finding a merchant"
              subtitle={`Order #${orderIdParam}. A merchant will accept your order shortly.`}
            />
          )}

          {status === OrderStatus.ACCEPTED && (
            <AcceptedView
              orderIdParam={orderIdParam ?? ""}
              order={order!}
              fiatDisplay={fiatDisplay}
              usdcDisplay={usdcDisplay}
              currencyConfig={currencyConfig}
              isCompound={!!isCompound}
              compoundParts={compoundParts}
              decryptedUpi={decryptedUpi}
              decryptError={decryptError}
              copied={copied}
              onCopy={copy}
              onMarkPaid={handleMarkPaid}
              isMarkingPaid={isMarkingPaid}
              error={error}
              showCancelConfirm={showCancelConfirm}
              setShowCancelConfirm={setShowCancelConfirm}
              onCancel={handleCancel}
              isCancelling={isCancelling}
            />
          )}

          {status === OrderStatus.PAID && (
            <CenterStatus
              icon={<Spinner />}
              title="Verifying your payment"
              subtitle="The merchant is confirming your payment. This usually takes under a minute."
            />
          )}

          {status === OrderStatus.COMPLETED && (
            <CompletedView
              orderIdParam={orderIdParam ?? ""}
              fiatDisplay={fiatDisplay}
              usdcDisplay={usdcDisplay}
              order={order!}
              currencyConfig={currencyConfig}
              decryptedUpi={decryptedUpi}
              isCompound={!!isCompound}
              redirectCountdown={redirectCountdown}
            />
          )}

          {status === OrderStatus.CANCELLED && (
            <CenterStatus
              icon={<XIcon />}
              title="Order cancelled"
              subtitle="This order was cancelled. You were not charged."
              variant="danger"
            />
          )}
        </section>

        <Footer />
      </div>
    </div>
  );
}

// ─── Stepper ────────────────────────────────────────────────────

function Stepper({ status }: { status: number }) {
  const steps = ["Merchant", "Payment", "Complete"];
  const stepIndex = (() => {
    if (status >= OrderStatus.COMPLETED) return 3;
    if (status >= OrderStatus.PAID) return 2;
    if (status >= OrderStatus.ACCEPTED) return 1;
    return 0;
  })();
  return (
    <div style={stepperStyles.row}>
      {steps.map((label, i) => {
        const done = stepIndex > i;
        const active = stepIndex === i;
        return (
          <div key={label} style={{ display: "flex", alignItems: "center", flex: i < steps.length - 1 ? 1 : "initial" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 28, height: 28, borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
                background: done || active ? color.accent : color.surface,
                color: done || active ? "#fff" : color.textMuted,
                border: done || active ? "none" : `1px solid ${color.border}`,
                fontSize: font.sm, fontWeight: weight.semibold,
              }}>
                {done ? "✓" : i + 1}
              </div>
              <span style={{
                fontSize: font.md,
                fontWeight: active ? weight.semibold : weight.medium,
                color: done || active ? color.text : color.textMuted,
              }}>
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div style={{ flex: 1, height: 1, background: done ? color.accent : color.border, margin: "0 12px" }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Views ──────────────────────────────────────────────────────

function AcceptedView(props: any) {
  const {
    order, fiatDisplay, usdcDisplay, currencyConfig, isCompound, compoundParts,
    decryptedUpi, decryptError, copied, onCopy, onMarkPaid, isMarkingPaid,
    error, showCancelConfirm, setShowCancelConfirm, onCancel, isCancelling,
    orderIdParam,
  } = props;

  return (
    <div>
      <div style={{ textAlign: "center" as const, marginBottom: 24 }}>
        <p style={S.label}>Pay exactly</p>
        <h1 style={{ ...S.h1, fontSize: font.hero, marginTop: 6, ...S.num }}>
          {order.currency} {fiatDisplay}
        </h1>
        <p style={{ ...S.muted, marginTop: 4 }}>to receive {usdcDisplay} USDC</p>
      </div>

      {/* Payment card */}
      <div style={{ ...S.cardFlat, padding: "20px", background: color.surfaceAlt }}>
        <div style={S.rowBetween}>
          <span style={S.label}>{currencyConfig?.paymentMethod ?? "Payment"}</span>
          <span style={S.faint}>Order #{orderIdParam}</span>
        </div>

        <div style={{ marginTop: 12 }}>
          {isCompound && currencyConfig?.compoundFields && decryptError !== "session-changed" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {currencyConfig.compoundFields.map((field: string, i: number) => (
                <div key={field}>
                  <p style={{ ...S.label, marginBottom: 4 }}>{field}</p>
                  <CopyRow
                    value={compoundParts[i] ?? "…"}
                    copied={copied === field}
                    onCopy={() => onCopy(compoundParts[i], field)}
                  />
                </div>
              ))}
            </div>
          ) : decryptedUpi ? (
            <CopyRow
              value={decryptedUpi}
              copied={copied === "upi"}
              onCopy={() => decryptError !== "session-changed" && onCopy(decryptedUpi, "upi")}
              disabled={decryptError === "session-changed"}
            />
          ) : (
            <p style={S.muted}>Decrypting payment details…</p>
          )}
        </div>

        {/* QR for INR */}
        {decryptedUpi && !decryptError && currencyConfig?.hasQR && order.currency === "INR" && (
          <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}>
            <div style={{ padding: 12, background: "#fff", borderRadius: radius.md, border: `1px solid ${color.border}` }}>
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=0&data=${encodeURIComponent(
                  `upi://pay?pa=${decryptedUpi}&am=${fiatDisplay}&cu=INR&tr=${orderIdParam}`
                )}`}
                alt="Payment QR"
                style={{ width: 180, height: 180, display: "block" }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Amount row */}
      <div style={{ marginTop: 16, padding: "12px 14px", background: color.surfaceAlt, borderRadius: radius.md, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={S.muted}>Amount to pay</span>
        <CopyInline
          value={`${order.currency} ${fiatDisplay}`}
          copyValue={fiatDisplay}
          copied={copied === "amount"}
          onCopy={() => onCopy(fiatDisplay, "amount")}
        />
      </div>

      {error && (
        <div style={{ marginTop: 12, padding: "10px 12px", background: color.dangerSoft, borderRadius: radius.md, color: color.danger, fontSize: font.md }}>
          {error}
        </div>
      )}

      <button
        style={{ ...S.primaryBtn, marginTop: 20, opacity: isMarkingPaid ? 0.5 : 1 }}
        onClick={onMarkPaid}
        disabled={isMarkingPaid}
      >
        {isMarkingPaid ? "Confirming…" : "I've paid"}
      </button>

      {!showCancelConfirm ? (
        <button
          style={{ ...S.ghostBtn, width: "100%", marginTop: 8, height: 40 }}
          onClick={() => setShowCancelConfirm(true)}
        >
          Cancel order
        </button>
      ) : (
        <div style={{ marginTop: 12, padding: 14, borderRadius: radius.md, background: color.dangerSoft, border: `1px solid ${color.danger}22` }}>
          <p style={{ fontSize: font.md, color: color.danger, marginTop: 0 }}>
            Cancel this order? This cannot be undone.
          </p>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button
              style={{ ...S.secondaryBtn, flex: 1, height: 38, borderColor: color.danger, color: color.danger }}
              onClick={onCancel}
              disabled={isCancelling}
            >
              {isCancelling ? "Cancelling…" : "Yes, cancel"}
            </button>
            <button
              style={{ ...S.secondaryBtn, flex: 1, height: 38 }}
              onClick={() => setShowCancelConfirm(false)}
            >
              Keep order
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CompletedView(props: any) {
  const { orderIdParam, fiatDisplay, usdcDisplay, order, currencyConfig, decryptedUpi, isCompound, redirectCountdown } = props;
  const redirectUrl = getOrderRedirect(orderIdParam);

  return (
    <div style={{ textAlign: "center" as const }}>
      <div style={{
        width: 64, height: 64, borderRadius: "50%",
        background: color.successSoft,
        color: color.success,
        display: "flex", alignItems: "center", justifyContent: "center",
        margin: "0 auto 20px",
      }}>
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
      <h1 style={{ ...S.h1, fontSize: font.xxl }}>Payment complete</h1>
      <p style={{ ...S.muted, marginTop: 8 }}>
        {usdcDisplay} USDC has been delivered to your recipient.
      </p>

      {/* Receipt */}
      <div style={{ ...S.cardFlat, padding: "20px", marginTop: 24, textAlign: "left" as const }}>
        <ReceiptRow label="Order" value={`#${orderIdParam}`} mono />
        <ReceiptRow label="Amount received" value={`${usdcDisplay} USDC`} num bold />
        <ReceiptRow label="You paid" value={`${order.currency} ${fiatDisplay}`} num />
        <ReceiptRow label="Method" value={currencyConfig?.paymentMethod ?? order.currency} />
        <ReceiptRow label="Product" value="NFT minted" />
        {decryptedUpi && !isCompound && (
          <ReceiptRow label="Paid to" value={decryptedUpi} truncate />
        )}
      </div>

      {redirectCountdown !== null && redirectUrl && (
        <div style={{ marginTop: 20 }}>
          <p style={{ ...S.muted, marginBottom: 10 }}>
            Redirecting to merchant in <span style={{ color: color.text, fontWeight: weight.semibold }}>{redirectCountdown}s</span>…
          </p>
          <button
            style={S.primaryBtn}
            onClick={() => (window.location.href = buildRedirectBackUrl(redirectUrl, orderIdParam))}
          >
            Return to merchant now
          </button>
        </div>
      )}
    </div>
  );
}

function ReceiptRow({ label, value, num, bold, mono, truncate }: {
  label: string; value: string; num?: boolean; bold?: boolean; mono?: boolean; truncate?: boolean;
}) {
  return (
    <div style={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      gap: 16,
      padding: "10px 0",
      borderBottom: `1px solid ${color.border}`,
    }}>
      <span style={S.muted}>{label}</span>
      <span style={{
        fontSize: font.base,
        fontWeight: bold ? weight.semibold : weight.medium,
        color: color.text,
        ...(num ? S.num : {}),
        ...(mono ? S.mono : {}),
        maxWidth: truncate ? 200 : undefined,
        wordBreak: truncate ? "break-all" as const : "normal" as const,
        textAlign: "right" as const,
      }}>
        {value}
      </span>
    </div>
  );
}

// ─── Small components ──────────────────────────────────────────

function CopyRow({ value, copied, onCopy, disabled }: {
  value: string; copied: boolean; onCopy: () => void; disabled?: boolean;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      background: color.surface, border: `1px solid ${color.border}`, borderRadius: radius.md,
      padding: "10px 12px",
    }}>
      <span style={{ ...S.mono, fontSize: font.md, wordBreak: "break-all", flex: 1, color: disabled ? color.textMuted : color.text }}>
        {value}
      </span>
      {!disabled && (
        <button
          style={{
            height: 28, padding: "0 10px",
            background: copied ? color.successSoft : color.surfaceAlt,
            color: copied ? color.success : color.text,
            border: "none",
            borderRadius: radius.sm,
            fontSize: font.sm,
            fontWeight: weight.medium,
            cursor: "pointer",
          }}
          onClick={onCopy}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      )}
    </div>
  );
}

function CopyInline({ value, copyValue, copied, onCopy }: {
  value: string; copyValue: string; copied: boolean; onCopy: () => void;
}) {
  return (
    <button
      onClick={onCopy}
      style={{
        display: "inline-flex", alignItems: "center", gap: 8,
        padding: "6px 12px",
        background: color.surface, border: `1px solid ${color.border}`,
        borderRadius: radius.sm,
        fontSize: font.md, fontWeight: weight.semibold, color: color.text,
        cursor: "pointer",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <span>{value}</span>
      <span style={{ fontSize: font.sm, fontWeight: weight.medium, color: copied ? color.success : color.textMuted }}>
        {copied ? "✓" : "⎘"}
      </span>
    </button>
  );
}

function CenterStatus({ icon, title, subtitle, variant }: {
  icon: React.ReactNode; title: string; subtitle: string; variant?: "danger";
}) {
  return (
    <div style={{ textAlign: "center" as const, padding: "16px 0" }}>
      <div style={{ marginBottom: 20, display: "inline-flex" }}>{icon}</div>
      <h1 style={{ ...S.h1, fontSize: font.xxl, color: variant === "danger" ? color.danger : color.text }}>{title}</h1>
      <p style={{ ...S.muted, marginTop: 8, maxWidth: 320, marginLeft: "auto", marginRight: "auto" }}>
        {subtitle}
      </p>
    </div>
  );
}

function CenterLoader({ label }: { label: string }) {
  return (
    <div style={{ padding: "32px", textAlign: "center" as const }}>
      <div style={{ display: "inline-flex" }}><Spinner /></div>
      <p style={{ ...S.muted, marginTop: 12 }}>{label}</p>
    </div>
  );
}

function Spinner() {
  return (
    <div style={{
      width: 32, height: 32,
      border: `3px solid ${color.border}`,
      borderTopColor: color.accent,
      borderRadius: "50%",
      animation: "spin 800ms linear infinite",
    }} />
  );
}

function PulseDot() {
  return (
    <div style={{ position: "relative", width: 32, height: 32 }}>
      <div style={{
        position: "absolute", inset: 0, borderRadius: "50%",
        background: color.accent, opacity: 0.25,
        animation: "pulse-ring 1.2s ease-out infinite",
      }} />
      <div style={{
        position: "absolute", inset: 8, borderRadius: "50%", background: color.accent,
      }} />
      <style>{`
        @keyframes pulse-ring {
          0% { transform: scale(0.6); opacity: 0.5; }
          100% { transform: scale(1.6); opacity: 0; }
        }
      `}</style>
    </div>
  );
}

function XIcon() {
  return (
    <div style={{
      width: 56, height: 56, borderRadius: "50%",
      background: color.dangerSoft, color: color.danger,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </div>
  );
}

function Footer() {
  return (
    <footer style={{ padding: "24px 0", display: "flex", justifyContent: "center" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, color: color.textMuted, fontSize: font.sm }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
        <span>Powered by</span>
        <span style={{ fontWeight: weight.semibold, color: color.text }}>P2P.me</span>
      </div>
    </footer>
  );
}

// ─── Styles ────────────────────────────────────────────────────

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
    maxWidth: 640,
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
    maxWidth: 520,
    width: "100%",
    margin: "0 auto",
    padding: "32px 24px",
    boxSizing: "border-box",
  },
};

const stepperStyles: Record<string, React.CSSProperties> = {
  row: {
    display: "flex",
    alignItems: "center",
    gap: 0,
    padding: "16px 20px",
    background: color.surface,
    border: `1px solid ${color.border}`,
    borderRadius: radius.lg,
  },
};
