import { useCallback, useEffect, useState } from "react";
import { OrderStatus } from "../lib/contracts";

interface OrderState {
  orderId: bigint | null;
  status: OrderStatus;
  amount: bigint;
  fiatAmount: bigint;
  acceptedMerchant: string;
  encUpi: string;
  error: string | null;
  loading: boolean;
}

const INITIAL_STATE: OrderState = {
  orderId: null,
  status: OrderStatus.PLACED,
  amount: 0n,
  fiatAmount: 0n,
  acceptedMerchant: "",
  encUpi: "",
  error: null,
  loading: false,
};

/**
 * Hook to track a checkout order's lifecycle.
 * Polls the Diamond contract for order status changes.
 */
export function useCheckoutOrder(orderId: bigint | null) {
  const [state, setState] = useState<OrderState>(INITIAL_STATE);

  // Poll for order status
  useEffect(() => {
    if (!orderId) return;

    setState((s) => ({ ...s, orderId, loading: true }));

    // In a real implementation, this would use wagmi's useContractRead
    // with a refetchInterval to poll the Diamond's orders(orderId) function.
    // The polling interval varies by status:
    //   PLACED: every 3s (waiting for merchant)
    //   ACCEPTED: manual (user marks paid)
    //   PAID: every 10s (waiting for merchant verification)
    //   COMPLETED: stop polling

    const interval = setInterval(() => {
      // Placeholder: in real implementation, read from Diamond contract
      // const order = await readContract({ address: DIAMOND_ADDRESS, abi: DIAMOND_ABI, functionName: 'orders', args: [orderId] });
      // setState(s => ({ ...s, status: order.status, ... }));
    }, 5000);

    return () => clearInterval(interval);
  }, [orderId]);

  const setError = useCallback((error: string | null) => {
    setState((s) => ({ ...s, error }));
  }, []);

  const setStatus = useCallback((status: OrderStatus) => {
    setState((s) => ({ ...s, status }));
  }, []);

  return {
    ...state,
    setError,
    setStatus,
  };
}
