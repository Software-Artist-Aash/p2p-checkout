export interface CheckoutSigner {
  address: `0x${string}`;
  sendTransaction: (tx: {
    to: `0x${string}`;
    data: `0x${string}`;
    gasLimit?: number;
  }) => Promise<{ hash: `0x${string}` }>;
}

export interface PlaceOrderResult {
  orderId: string;
  txHash: string;
}

export interface P2PCheckoutProps {
  // --- Order source (pick one) ---
  // A: tracking only — client already placed the order
  orderId?: string;
  // B: client provides a callback; widget shows "Pay now" and runs it
  placeOrder?: () => Promise<PlaceOrderResult>;

  // Display hints (used in mode B's pre-order screen)
  amount?: string;
  productName?: string;

  // Required for paidBuyOrder + cancelOrder on Diamond
  signer: CheckoutSigner;

  // Optional
  chainId?: number;
  diamondAddress?: `0x${string}`;
  rpcUrl?: string;
  currency?: string;

  // UI
  mode?: "inline" | "modal";
  open?: boolean;
  demo?: boolean;

  // Events
  onOrderPlaced?: (orderId: string, txHash: string) => void;
  onComplete?: (orderId: string) => void;
  onError?: (error: Error) => void;
  onCancel?: (orderId: string) => void;
  onClose?: () => void;
}

export enum OrderStatus {
  PLACED = 0,
  ACCEPTED = 1,
  PAID = 2,
  COMPLETED = 3,
  CANCELLED = 4,
}

export type CheckoutPhase =
  | "checkout"
  | "placing"
  | "placed"
  | "accepted"
  | "paid"
  | "completed"
  | "cancelled"
  | "error";
