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

// User-selected currency for a checkout session. Present in PlaceOrderContext
// only when the caller passed the `currencies` prop and the widget rendered
// the currency picker.
export interface CurrencyOption {
  symbol: string;
  flag: string;
  paymentMethod: string;
  circleId: bigint;
}

export interface PlaceOrderContext {
  currency?: CurrencyOption;
}

export interface P2PCheckoutProps {
  // --- Order source (pick one) ---
  // A: tracking only — client already placed the order
  orderId?: string;
  // B: client provides a callback; widget shows "Pay now" and runs it.
  // If `currencies` is also provided, `ctx.currency` holds the user's pick.
  placeOrder?: (ctx: PlaceOrderContext) => Promise<PlaceOrderResult>;

  // Enables an in-widget currency picker on the pre-order screen.
  // Caller is responsible for only passing currencies that map to a
  // registered merchant on the Diamond (circleId must match).
  currencies?: CurrencyOption[];

  // Display hints (used in mode B's pre-order screen)
  amount?: string;
  productName?: string;

  // Optional notice rendered above the "Pay now" button on the pre-order
  // screen. Use for caller-specific context such as "wallet will be charged
  // for gas" vs. "gas sponsored".
  paymentNotice?: React.ReactNode;

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
