import { SUBGRAPH_URL } from "./config";

export interface SubgraphOrder {
  orderId: string;
  status: number;
  type: number;
  usdcAmount: string;
  fiatAmount: string;
  actualUsdcAmount: string;
  actualFiatAmount: string;
  currency: string;
  circleId: string;
  userAddress: string;
  placedAt: string;
  acceptedAt: string;
  paidAt: string;
  completedAt: string;
  cancelledAt: string;
  fixedFeePaid: string;
}

const USER_ORDERS_QUERY = `
  query GetUserOrders($userAddress: Bytes!) {
    orders_collection(
      where: { userAddress: $userAddress }
      orderBy: placedAt
      orderDirection: desc
      first: 50
    ) {
      orderId
      status
      type
      usdcAmount
      fiatAmount
      actualUsdcAmount
      actualFiatAmount
      currency
      circleId
      userAddress
      placedAt
      acceptedAt
      paidAt
      completedAt
      cancelledAt
      fixedFeePaid
    }
  }
`;

/**
 * Fetch all orders for a user from the subgraph.
 */
export async function fetchUserOrders(
  userAddress: string
): Promise<SubgraphOrder[]> {
  if (!SUBGRAPH_URL) {
    console.warn("VITE_SUBGRAPH_URL not set");
    return [];
  }

  const response = await fetch(SUBGRAPH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: USER_ORDERS_QUERY,
      variables: { userAddress: userAddress.toLowerCase() },
    }),
  });

  if (!response.ok) {
    throw new Error(`Subgraph query failed: ${response.status}`);
  }

  const json = await response.json();

  if (json.errors) {
    console.error("Subgraph errors:", json.errors);
    throw new Error(json.errors[0]?.message ?? "Subgraph query error");
  }

  return (json.data?.orders_collection ?? []) as SubgraphOrder[];
}

// ─── Admin Queries ────────────────────────────────────────────────

export interface SubgraphIntegrator {
  address: string;
  isActive: boolean;
  totalVolume: string;
  activeOrderCount: string;
  outstandingDebt: string;
}

export interface SubgraphB2BOrder {
  orderId: string;
  user: string;
  amount: string;
  blockTimestamp: string;
  transactionHash: string;
}

const INTEGRATOR_STATS_QUERY = `
  query IntegratorStats($id: ID!) {
    integrator(id: $id) {
      address
      isActive
      totalVolume
      activeOrderCount
      outstandingDebt
    }
  }
`;

const B2B_ORDER_COUNT_QUERY = `
  query B2BOrderCount($integrator: String!) {
    b2Borders(where: { integrator: $integrator }, first: 1000) {
      orderId
    }
  }
`;

const B2B_ORDERS_QUERY = `
  query B2BOrders($integrator: String!, $skip: Int, $first: Int) {
    b2Borders(
      where: { integrator: $integrator }
      orderBy: blockTimestamp
      orderDirection: desc
      skip: $skip
      first: $first
    ) {
      orderId
      user
      amount
      blockTimestamp
      transactionHash
    }
  }
`;

const ORDER_DETAIL_QUERY = `
  query OrderDetail($orderId: BigInt!) {
    orders_collection(where: { orderId: $orderId }, first: 1) {
      orderId status type usdcAmount fiatAmount
      actualUsdcAmount actualFiatAmount currency
      userAddress placedAt acceptedAt paidAt completedAt cancelledAt
      acceptedMerchantAddress disputeStatus disputeFaultType
    }
  }
`;

async function querySubgraph(query: string, variables: Record<string, any>): Promise<any> {
  if (!SUBGRAPH_URL) throw new Error("VITE_SUBGRAPH_URL not set");

  const response = await fetch(SUBGRAPH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) throw new Error(`Subgraph query failed: ${response.status}`);
  const json = await response.json();
  if (json.errors) throw new Error(json.errors[0]?.message ?? "Subgraph error");
  return json.data;
}

export async function fetchIntegratorStats(
  integratorAddress: string
): Promise<SubgraphIntegrator | null> {
  const data = await querySubgraph(INTEGRATOR_STATS_QUERY, {
    id: integratorAddress.toLowerCase(),
  });
  return data?.integrator ?? null;
}

export async function fetchB2BOrderCount(
  integratorAddress: string
): Promise<number> {
  const data = await querySubgraph(B2B_ORDER_COUNT_QUERY, {
    integrator: integratorAddress.toLowerCase(),
  });
  return (data?.b2Borders ?? []).length;
}

export async function fetchB2BOrders(
  integratorAddress: string,
  skip = 0,
  first = 50
): Promise<SubgraphB2BOrder[]> {
  const data = await querySubgraph(B2B_ORDERS_QUERY, {
    integrator: integratorAddress.toLowerCase(),
    skip,
    first,
  });
  return data?.b2Borders ?? [];
}

export async function fetchOrderDetail(
  orderId: string
): Promise<SubgraphOrder | null> {
  const data = await querySubgraph(ORDER_DETAIL_QUERY, { orderId });
  return data?.orders_collection?.[0] ?? null;
}
