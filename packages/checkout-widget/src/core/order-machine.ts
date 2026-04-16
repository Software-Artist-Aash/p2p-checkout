import { useReducer, useCallback, useEffect, useRef } from "react";
import { createPublicClient, http, formatUnits, encodeFunctionData, decodeEventLog, stringToHex, fromHex } from "viem";
import { baseSepolia, base } from "viem/chains";
import { getRelayIdentity } from "@p2pdotme/sdk/payload";
import { decryptPaymentAddress } from "@p2pdotme/sdk/payload";
import type { CheckoutSigner, CheckoutPhase } from "../types";
import { OrderStatus } from "../types";
import {
  INTEGRATOR_ABI, CLIENT_ABI, DIAMOND_ABI,
  CHECKOUT_ORDER_CREATED_EVENT, B2B_ORDER_PLACED_EVENT,
  DEFAULT_DIAMOND_ADDRESS, USDC_DECIMALS,
} from "./contracts";
import type { CurrencyConfig } from "./config";
import { DEMO_FIAT_RATE } from "./config";

interface OrderState {
  phase: CheckoutPhase;
  orderId: string | null;
  txHash: string | null;
  productPrice: bigint | null;
  fiatAmount: bigint | null;
  usdcAmount: bigint | null;
  decryptedUpi: string | null;
  orderCurrency: string;
  acceptedMerchant: string | null;
  error: string | null;
}

type OrderAction =
  | { type: "SET_PRICE"; price: bigint }
  | { type: "PLACING" }
  | { type: "PLACED"; orderId: string; txHash: string }
  | { type: "ACCEPTED"; fiatAmount: bigint; usdcAmount: bigint; merchant: string }
  | { type: "DECRYPTED_UPI"; upi: string }
  | { type: "PAID" }
  | { type: "COMPLETED" }
  | { type: "CANCELLED" }
  | { type: "ERROR"; message: string }
  | { type: "RESET" };

function reducer(state: OrderState, action: OrderAction): OrderState {
  switch (action.type) {
    case "SET_PRICE": return { ...state, productPrice: action.price };
    case "PLACING": return { ...state, phase: "placing", error: null };
    case "PLACED": return { ...state, phase: "placed", orderId: action.orderId, txHash: action.txHash };
    case "ACCEPTED": return { ...state, phase: "accepted", fiatAmount: action.fiatAmount, usdcAmount: action.usdcAmount, acceptedMerchant: action.merchant };
    case "DECRYPTED_UPI": return { ...state, decryptedUpi: action.upi };
    case "PAID": return { ...state, phase: "paid" };
    case "COMPLETED": return { ...state, phase: "completed" };
    case "CANCELLED": return { ...state, phase: "cancelled" };
    case "ERROR": return { ...state, phase: "error", error: action.message };
    case "RESET": return initialState(state.orderCurrency);
    default: return state;
  }
}

function initialState(currency: string): OrderState {
  return {
    phase: "checkout",
    orderId: null,
    txHash: null,
    productPrice: null,
    fiatAmount: null,
    usdcAmount: null,
    decryptedUpi: null,
    orderCurrency: currency,
    acceptedMerchant: null,
    error: null,
  };
}

export interface UseOrderMachineOpts {
  integratorAddress: `0x${string}`;
  clientAddress: `0x${string}`;
  productId: number;
  quantity: number;
  currency: CurrencyConfig;
  signer: CheckoutSigner;
  chainId: number;
  diamondAddress: `0x${string}`;
  rpcUrl?: string;
  demo?: boolean;
  onOrderPlaced?: (orderId: string, txHash: string) => void;
  onStatusChange?: (orderId: string, status: OrderStatus) => void;
  onComplete?: (orderId: string) => void;
  onError?: (error: Error) => void;
  onCancel?: (orderId: string) => void;
}

export function useOrderMachine(opts: UseOrderMachineOpts) {
  const [state, dispatch] = useReducer(reducer, initialState(opts.currency.symbol));
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const chain = opts.chainId === 84532 ? baseSepolia : base;
  const publicClient = createPublicClient({ chain, transport: http(opts.rpcUrl) });

  // Fetch product price
  useEffect(() => {
    publicClient.readContract({
      address: opts.clientAddress,
      abi: CLIENT_ABI,
      functionName: "getProductPrice",
      args: [BigInt(opts.productId)],
    }).then((p) => dispatch({ type: "SET_PRICE", price: p })).catch(() => {});
  }, [opts.clientAddress, opts.productId]);

  // Poll order status
  const fetchOrderStatus = useCallback(async () => {
    if (!state.orderId) return;
    try {
      const [rawOrder, details] = await Promise.all([
        publicClient.readContract({ address: opts.diamondAddress, abi: DIAMOND_ABI, functionName: "getOrdersById", args: [BigInt(state.orderId)] }),
        publicClient.readContract({ address: opts.diamondAddress, abi: DIAMOND_ABI, functionName: "getAdditionalOrderDetails", args: [BigInt(state.orderId)] }),
      ]);
      const o = rawOrder as any;
      const d = details as any;
      const status = Number(o.status) as OrderStatus;

      if (status === OrderStatus.ACCEPTED && state.phase === "placed") {
        const actualFiat = d.actualFiatAmount > 0n ? d.actualFiatAmount : o.fiatAmount;
        dispatch({ type: "ACCEPTED", fiatAmount: actualFiat, usdcAmount: o.amount, merchant: o.acceptedMerchant });
        opts.onStatusChange?.(state.orderId, status);
        // Decrypt UPI
        const result = await decryptPaymentAddress(o.encUpi);
        if (result.isOk()) dispatch({ type: "DECRYPTED_UPI", upi: result.value });
        else dispatch({ type: "DECRYPTED_UPI", upi: "Session changed" });
      } else if (status === OrderStatus.COMPLETED && state.phase === "paid") {
        dispatch({ type: "COMPLETED" });
        opts.onStatusChange?.(state.orderId, status);
        opts.onComplete?.(state.orderId);
      } else if (status === OrderStatus.CANCELLED) {
        dispatch({ type: "CANCELLED" });
        opts.onCancel?.(state.orderId);
      }
    } catch {}
  }, [state.orderId, state.phase, opts.diamondAddress]);

  useEffect(() => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    if (!state.orderId) return;
    let interval: number | null = null;
    if (state.phase === "placed") interval = 3000;
    else if (state.phase === "paid") interval = 10000;
    if (interval) pollingRef.current = setInterval(fetchOrderStatus, interval);
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [state.phase, state.orderId, fetchOrderStatus]);

  // Place order
  const placeOrder = useCallback(async () => {
    if (!state.productPrice) return;
    dispatch({ type: "PLACING" });

    if (opts.demo) {
      const fakeId = `demo${Date.now()}`;
      dispatch({ type: "PLACED", orderId: fakeId, txHash: "0xdemo" });
      opts.onOrderPlaced?.(fakeId, "0xdemo");
      setTimeout(() => {
        const rate = DEMO_FIAT_RATE[opts.currency.symbol] ?? 1;
        const totalUsdc = state.productPrice! * BigInt(opts.quantity);
        const fiat = BigInt(Math.round(Number(totalUsdc) * rate));
        dispatch({ type: "ACCEPTED", fiatAmount: fiat, usdcAmount: totalUsdc, merchant: "0xDEMO" });
        dispatch({ type: "DECRYPTED_UPI", upi: "p2pdemo@upi" });
      }, 5000);
      return;
    }

    try {
      const relayResult = getRelayIdentity();
      if (relayResult.isErr()) throw new Error(relayResult.error.message);
      const pubKey = relayResult.value.publicKey;
      const currencyHex = stringToHex(opts.currency.symbol, { size: 32 });

      const data = encodeFunctionData({
        abi: INTEGRATOR_ABI,
        functionName: "userPlaceOrder",
        args: [
          opts.clientAddress, BigInt(opts.productId), BigInt(opts.quantity),
          currencyHex, BigInt(opts.currency.circleId), pubKey, 0n, 0n,
        ],
      });

      let gasLimit = 2_000_000n;
      try {
        const est = await publicClient.estimateGas({ account: opts.signer.address, to: opts.integratorAddress, data });
        gasLimit = (est * 3n) / 2n;
      } catch {}

      const { hash } = await opts.signer.sendTransaction({
        to: opts.integratorAddress,
        data,
        gasLimit: Number(gasLimit),
      });
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
        dispatch({ type: "PLACED", orderId, txHash: hash });
        opts.onOrderPlaced?.(orderId, hash);
      } else {
        dispatch({ type: "ERROR", message: "Order placed but could not parse order ID." });
      }
    } catch (err: any) {
      const msg = err?.shortMessage || err?.message || "Failed to place order";
      dispatch({ type: "ERROR", message: msg });
      opts.onError?.(err);
    }
  }, [state.productPrice, opts]);

  // Mark paid
  const markPaid = useCallback(async () => {
    if (!state.orderId) return;

    if (opts.demo) {
      dispatch({ type: "PAID" });
      setTimeout(() => {
        dispatch({ type: "COMPLETED" });
        opts.onComplete?.(state.orderId!);
      }, 10000);
      return;
    }

    try {
      const data = encodeFunctionData({ abi: DIAMOND_ABI, functionName: "paidBuyOrder", args: [BigInt(state.orderId)] });
      const { hash } = await opts.signer.sendTransaction({ to: opts.diamondAddress, data, gasLimit: 300000 });
      await publicClient.waitForTransactionReceipt({ hash });
      dispatch({ type: "PAID" });
    } catch (err: any) {
      dispatch({ type: "ERROR", message: err?.shortMessage || err?.message || "Failed to mark paid" });
    }
  }, [state.orderId, opts]);

  // Cancel
  const cancelOrder = useCallback(async () => {
    if (!state.orderId || opts.demo) {
      dispatch({ type: "CANCELLED" });
      opts.onCancel?.(state.orderId ?? "");
      return;
    }
    try {
      const data = encodeFunctionData({
        abi: [{ name: "cancelOrder", type: "function", stateMutability: "nonpayable",
          inputs: [{ name: "_orderId", type: "uint256" }], outputs: [] }],
        functionName: "cancelOrder", args: [BigInt(state.orderId)],
      });
      const { hash } = await opts.signer.sendTransaction({ to: opts.diamondAddress, data, gasLimit: 300000 });
      await publicClient.waitForTransactionReceipt({ hash });
      dispatch({ type: "CANCELLED" });
      opts.onCancel?.(state.orderId);
    } catch (err: any) {
      dispatch({ type: "ERROR", message: err?.shortMessage || err?.message || "Failed to cancel" });
    }
  }, [state.orderId, opts]);

  return {
    state,
    placeOrder,
    markPaid,
    cancelOrder,
    totalPrice: state.productPrice ? state.productPrice * BigInt(opts.quantity) : null,
  };
}
