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
] as const;

export const CLIENT_ABI = [
  {
    name: "getProductPrice",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "productId", type: "uint256" }],
    outputs: [{ name: "price", type: "uint256" }],
  },
] as const;

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

export const CHECKOUT_ORDER_CREATED_EVENT = {
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

export const B2B_ORDER_PLACED_EVENT = {
  type: "event" as const,
  name: "B2BOrderPlaced",
  inputs: [
    { name: "orderId", type: "uint256", indexed: true },
    { name: "integrator", type: "address", indexed: true },
    { name: "user", type: "address", indexed: true },
    { name: "amount", type: "uint256", indexed: false },
  ],
};

export const DEFAULT_DIAMOND_ADDRESS = "0xeb0BB8E3c014D915D9B2df03aBB130a1Fb44beb9" as `0x${string}`;
export const USDC_DECIMALS = 6;
