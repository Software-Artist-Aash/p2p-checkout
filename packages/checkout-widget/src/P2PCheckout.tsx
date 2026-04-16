import React, { useState, useEffect, useCallback } from "react";
import { formatUnits } from "viem";
import type { P2PCheckoutProps } from "./types";
import { OrderStatus } from "./types";
import { useOrderMachine } from "./core/order-machine";
import { CURRENCIES, type CurrencyConfig } from "./core/config";
import { USDC_DECIMALS } from "./core/contracts";
import { DEFAULT_DIAMOND_ADDRESS } from "./core/contracts";
import { color, radius, font, weight, S } from "./ui/theme";
import { Modal } from "./ui/Modal";
import {
  Spinner, PulseDot, CenterStatus, SuccessIcon, XIcon,
  CopyRow, Stepper, LockFooter, injectKeyframes,
} from "./ui/components";

export function P2PCheckout(props: P2PCheckoutProps) {
  const {
    integratorAddress, clientAddress, productId, signer,
    quantity = 1,
    currency: defaultCurrency = "INR",
    chainId = 84532,
    diamondAddress = DEFAULT_DIAMOND_ADDRESS,
    rpcUrl,
    mode = "modal",
    open = true,
    demo = false,
    onClose,
    ...callbacks
  } = props;

  useEffect(injectKeyframes, []);

  const [selectedCurrency, setSelectedCurrency] = useState<CurrencyConfig>(
    CURRENCIES.find((c) => c.symbol === defaultCurrency) ?? CURRENCIES[0]
  );
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [isMarkingPaid, setIsMarkingPaid] = useState(false);

  const { state, placeOrder, markPaid, cancelOrder, totalPrice } = useOrderMachine({
    integratorAddress, clientAddress, productId, quantity,
    currency: selectedCurrency, signer, chainId, diamondAddress, rpcUrl, demo,
    ...callbacks,
  });

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1400);
  };

  const handleMarkPaid = async () => {
    setIsMarkingPaid(true);
    await markPaid();
    setIsMarkingPaid(false);
  };

  const usdcDisplay = totalPrice ? formatUnits(totalPrice, USDC_DECIMALS) : "—";
  const fiatDisplay = state.fiatAmount ? (Number(state.fiatAmount) / 1e6).toFixed(2) : "—";

  const stepIndex = (() => {
    if (state.phase === "completed") return 3;
    if (state.phase === "paid") return 2;
    if (state.phase === "accepted") return 1;
    if (state.phase === "placed" || state.phase === "placing") return 0;
    return 0;
  })();

  const content = (
    <div style={{ fontFamily: "Inter, system-ui, sans-serif", color: color.text }}>
      {/* Header */}
      <div style={{
        padding: "16px 24px", borderBottom: `1px solid ${color.border}`,
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 8, background: color.accent,
            color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: weight.bold, fontSize: 14,
          }}>P</div>
          <span style={{ fontWeight: weight.semibold, fontSize: font.lg }}>P2P Checkout</span>
          {demo && <span style={{
            padding: "2px 8px", borderRadius: radius.pill,
            background: color.accentSoft, color: color.accent,
            fontSize: font.xs, fontWeight: weight.semibold,
          }}>DEMO</span>}
        </div>
        {mode === "modal" && onClose && (
          <button onClick={onClose} style={{
            width: 28, height: 28, borderRadius: radius.sm, border: "none",
            background: "transparent", cursor: "pointer", fontSize: 18, color: color.textMuted,
          }}>×</button>
        )}
      </div>

      <div style={{ padding: "24px" }}>
        {/* CHECKOUT phase */}
        {state.phase === "checkout" && (
          <div>
            <p style={S.label}>Order Summary</p>
            <h1 style={{ ...S.h1, marginTop: 4, fontSize: font.display }}>
              <span style={S.num}>{usdcDisplay}</span>{" "}
              <span style={{ fontSize: font.lg, color: color.textMuted, fontWeight: weight.medium }}>USDC</span>
            </h1>

            <div style={{ marginTop: 20, display: "flex", alignItems: "center", gap: 16 }}>
              <div style={{
                width: 48, height: 48, background: color.accentSoft, borderRadius: radius.md,
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28,
              }}>🎟️</div>
              <div style={{ flex: 1 }}>
                <p style={{ ...S.body, fontWeight: weight.medium, margin: 0 }}>Product #{productId}</p>
                <p style={{ ...S.faint, margin: "2px 0 0" }}>Qty {quantity} · Delivered as NFT{quantity > 1 ? "s" : ""}</p>
              </div>
              <span style={{ ...S.body, fontWeight: weight.semibold, ...S.num }}>{usdcDisplay}</span>
            </div>

            <div style={S.divider} />

            {/* Currency picker */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ ...S.label, display: "block", marginBottom: 6 }}>Currency</label>
              <button style={{
                width: "100%", height: 44, padding: "0 14px", display: "flex", alignItems: "center", justifyContent: "space-between",
                background: color.surface, border: `1px solid ${color.border}`, borderRadius: radius.md,
                fontSize: font.base, color: color.text, cursor: "pointer",
              }} onClick={() => setShowCurrencyPicker(!showCurrencyPicker)}>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 18 }}>{selectedCurrency.flag}</span>
                  <span style={{ fontWeight: weight.semibold }}>{selectedCurrency.symbol}</span>
                  <span style={S.faint}>· {selectedCurrency.paymentMethod}</span>
                </span>
                <span style={{ color: color.textMuted, fontSize: 12 }}>{showCurrencyPicker ? "▲" : "▼"}</span>
              </button>
              {showCurrencyPicker && (
                <div style={{
                  marginTop: 4, border: `1px solid ${color.border}`, borderRadius: radius.md,
                  background: color.surface, boxShadow: "0 4px 16px rgba(0,0,0,0.08)", overflow: "hidden",
                }}>
                  {CURRENCIES.map((c) => (
                    <button key={c.symbol} style={{
                      width: "100%", padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center",
                      background: c.symbol === selectedCurrency.symbol ? color.accentSoft : "transparent",
                      border: "none", borderBottom: `1px solid ${color.border}`,
                      fontSize: font.md, color: color.text, cursor: "pointer",
                    }} onClick={() => { setSelectedCurrency(c); setShowCurrencyPicker(false); }}>
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

            {state.error && (
              <div style={{ marginBottom: 12, padding: "10px 12px", background: color.dangerSoft, border: `1px solid ${color.danger}22`, borderRadius: radius.md }}>
                <span style={{ color: color.danger, fontSize: font.md }}>{state.error}</span>
              </div>
            )}

            <button style={{ ...S.primaryBtn, opacity: !totalPrice ? 0.5 : 1 }}
              onClick={placeOrder} disabled={!totalPrice}>
              Pay now
            </button>
            <p style={{ ...S.faint, textAlign: "center", marginTop: 12 }}>
              You'll pay {selectedCurrency.symbol} via {selectedCurrency.paymentMethod} to a verified merchant.
            </p>
          </div>
        )}

        {/* PLACING */}
        {state.phase === "placing" && (
          <CenterStatus icon={<Spinner />} title="Placing order…" subtitle="Waiting for your transaction to confirm." />
        )}

        {/* PLACED / ACCEPTED / PAID / COMPLETED / CANCELLED / ERROR — order tracking */}
        {(state.phase === "placed" || state.phase === "accepted" || state.phase === "paid" ||
          state.phase === "completed" || state.phase === "cancelled" || (state.phase === "error" && state.orderId)) && (
          <div>
            <Stepper stepIndex={stepIndex} />
            <div style={{ ...S.card, padding: "32px", marginTop: 16 }}>

              {state.phase === "placed" && (
                <CenterStatus icon={<PulseDot />} title="Finding a merchant"
                  subtitle={`Order #${state.orderId}. A merchant will accept your order shortly.`} />
              )}

              {state.phase === "accepted" && (
                <div>
                  <div style={{ textAlign: "center", marginBottom: 24 }}>
                    <p style={S.label}>Pay exactly</p>
                    <h1 style={{ ...S.h1, fontSize: font.hero, marginTop: 6, ...S.num }}>
                      {selectedCurrency.symbol} {fiatDisplay}
                    </h1>
                    <p style={{ ...S.muted, marginTop: 4 }}>to receive {usdcDisplay} USDC</p>
                  </div>

                  <div style={{ ...S.cardFlat, padding: "20px", background: color.surfaceAlt }}>
                    <div style={S.rowBetween}>
                      <span style={S.label}>{selectedCurrency.paymentMethod}</span>
                      <span style={S.faint}>Order #{state.orderId}</span>
                    </div>
                    <div style={{ marginTop: 12 }}>
                      {state.decryptedUpi ? (
                        <CopyRow value={state.decryptedUpi} copied={copied === "upi"}
                          onCopy={() => copy(state.decryptedUpi!, "upi")} />
                      ) : (
                        <p style={S.muted}>Decrypting payment details…</p>
                      )}
                    </div>

                    {state.decryptedUpi && selectedCurrency.hasQR && selectedCurrency.symbol === "INR" && (
                      <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}>
                        <div style={{ padding: 12, background: "#fff", borderRadius: radius.md, border: `1px solid ${color.border}` }}>
                          <img
                            src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=0&data=${encodeURIComponent(
                              `upi://pay?pa=${state.decryptedUpi}&am=${fiatDisplay}&cu=INR&tr=${state.orderId}`
                            )}`}
                            alt="Payment QR" style={{ width: 180, height: 180, display: "block" }}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {state.error && (
                    <div style={{ marginTop: 12, padding: "10px 12px", background: color.dangerSoft, borderRadius: radius.md, color: color.danger, fontSize: font.md }}>
                      {state.error}
                    </div>
                  )}

                  <button style={{ ...S.primaryBtn, marginTop: 20, opacity: isMarkingPaid ? 0.5 : 1 }}
                    onClick={handleMarkPaid} disabled={isMarkingPaid}>
                    {isMarkingPaid ? "Confirming…" : "I've paid"}
                  </button>

                  {!showCancelConfirm ? (
                    <button style={{ ...S.ghostBtn, width: "100%", marginTop: 8, height: 40 }}
                      onClick={() => setShowCancelConfirm(true)}>Cancel order</button>
                  ) : (
                    <div style={{ marginTop: 12, padding: 14, borderRadius: radius.md, background: color.dangerSoft, border: `1px solid ${color.danger}22` }}>
                      <p style={{ fontSize: font.md, color: color.danger, marginTop: 0 }}>Cancel this order? This cannot be undone.</p>
                      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                        <button style={{ ...S.secondaryBtn, flex: 1, height: 38, borderColor: color.danger, color: color.danger }}
                          onClick={cancelOrder}>Yes, cancel</button>
                        <button style={{ ...S.secondaryBtn, flex: 1, height: 38 }}
                          onClick={() => setShowCancelConfirm(false)}>Keep order</button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {state.phase === "paid" && (
                <CenterStatus icon={<Spinner />} title="Verifying your payment"
                  subtitle="The merchant is confirming your payment. This usually takes under a minute." />
              )}

              {state.phase === "completed" && (
                <div style={{ textAlign: "center" }}>
                  <SuccessIcon />
                  <h1 style={{ ...S.h1, fontSize: font.xxl }}>Payment complete</h1>
                  <p style={{ ...S.muted, marginTop: 8 }}>{usdcDisplay} USDC delivered.</p>
                  {onClose && (
                    <button style={{ ...S.primaryBtn, marginTop: 20 }} onClick={onClose}>Done</button>
                  )}
                </div>
              )}

              {state.phase === "cancelled" && (
                <CenterStatus icon={<XIcon />} title="Order cancelled"
                  subtitle="This order was cancelled. You were not charged." variant="danger" />
              )}
            </div>
          </div>
        )}

        {/* ERROR without orderId */}
        {state.phase === "error" && !state.orderId && (
          <div style={{ textAlign: "center", padding: "24px 0" }}>
            <div style={{ color: color.danger, marginBottom: 16 }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            </div>
            <h2 style={S.h2}>{state.error}</h2>
            <button style={{ ...S.primaryBtn, marginTop: 20 }} onClick={placeOrder}>Try again</button>
          </div>
        )}
      </div>

      <LockFooter />
    </div>
  );

  if (mode === "modal") {
    return <Modal open={open} onClose={onClose}>{content}</Modal>;
  }
  return <div style={{ ...S.card, overflow: "hidden" }}>{content}</div>;
}
