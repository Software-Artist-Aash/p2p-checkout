export interface CheckoutSigner {
  address: `0x${string}`;
  sendTransaction: (tx: {
    to: `0x${string}`;
    data: `0x${string}`;
    gasLimit?: number;
  }) => Promise<{ hash: `0x${string}` }>;
}

export interface P2PCheckoutProps {
  integratorAddress: `0x${string}`;
  clientAddress: `0x${string}`;
  productId: number;
  signer: CheckoutSigner;

  quantity?: number;
  currency?: string;
  chainId?: number;
  diamondAddress?: `0x${string}`;
  rpcUrl?: string;

  mode?: "inline" | "modal";
  open?: boolean;
  demo?: boolean;

  onOrderPlaced?: (orderId: string, txHash: string) => void;
  onStatusChange?: (orderId: string, status: OrderStatus) => void;
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
