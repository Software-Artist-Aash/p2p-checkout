/**
 * Contract ABIs and addresses for the checkout flow.
 */

// Full Order struct matching OrderProcessorStorage.Order
const ORDER_TUPLE = {
  name: "",
  type: "tuple",
  components: [
    { name: "amount", type: "uint256" },
    { name: "fiatAmount", type: "uint256" },
    { name: "placedTimestamp", type: "uint256" },
    { name: "completedTimestamp", type: "uint256" },
    { name: "userCompletedTimestamp", type: "uint256" },
    { name: "acceptedMerchant", type: "address" },
    { name: "user", type: "address" },
    { name: "recipientAddr", type: "address" },
    { name: "pubkey", type: "string" },
    { name: "encUpi", type: "string" },
    { name: "userCompleted", type: "bool" },
    { name: "status", type: "uint8" },
    { name: "orderType", type: "uint8" },
    {
      name: "disputeInfo",
      type: "tuple",
      components: [
        { name: "raisedBy", type: "uint8" },
        { name: "status", type: "uint8" },
        { name: "redactTransId", type: "uint256" },
        { name: "accountNumber", type: "uint256" },
      ],
    },
    { name: "id", type: "uint256" },
    { name: "userPubKey", type: "string" },
    { name: "encMerchantUpi", type: "string" },
    { name: "acceptedAccountNo", type: "uint256" },
    { name: "assignedAccountNos", type: "uint256[]" },
    { name: "currency", type: "bytes32" },
    { name: "preferredPaymentChannelConfigId", type: "uint256" },
    { name: "circleId", type: "uint256" },
  ],
} as const;

// Integrator ABI
export const INTEGRATOR_ABI = [
  {
    name: "userPlaceOrder",
    type: "function",
    stateMutability: "nonpayable",
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
  {
    name: "getRemainingDailyLimit",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getSession",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "orderId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "user", type: "address" },
          { name: "client", type: "address" },
          { name: "productId", type: "uint256" },
          { name: "usdcAmount", type: "uint256" },
          { name: "fulfilled", type: "bool" },
        ],
      },
    ],
  },
] as const;

// Client ABI
export const CLIENT_ABI = [
  {
    name: "getProductPrice",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "productId", type: "uint256" }],
    outputs: [{ name: "price", type: "uint256" }],
  },
] as const;

// Diamond ABI — functions the end-user calls + reads
export const DIAMOND_ABI = [
  {
    name: "paidBuyOrder",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "_orderId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "getOrdersById",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "orderId", type: "uint256" }],
    outputs: [ORDER_TUPLE],
  },
  {
    name: "getAdditionalOrderDetails",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "orderId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "fixedFeePaid", type: "uint64" },
          { name: "tipsPaid", type: "uint64" },
          { name: "acceptedTimestamp", type: "uint128" },
          { name: "paidTimestamp", type: "uint128" },
          { name: "reserved2", type: "uint128" },
          { name: "actualUsdtAmount", type: "uint256" },
          { name: "actualFiatAmount", type: "uint256" },
        ],
      },
    ],
  },
] as const;

// Order status enum
export enum OrderStatus {
  PLACED = 0,
  ACCEPTED = 1,
  PAID = 2,
  COMPLETED = 3,
  CANCELLED = 4,
}
