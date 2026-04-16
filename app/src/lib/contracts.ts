/**
 * Contract ABIs used by the admin dashboard.
 */

export const CLIENT_ABI = [
  {
    name: "getProductPrice",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "productId", type: "uint256" }],
    outputs: [{ name: "price", type: "uint256" }],
  },
] as const;

export enum OrderStatus {
  PLACED = 0,
  ACCEPTED = 1,
  PAID = 2,
  COMPLETED = 3,
  CANCELLED = 4,
}
