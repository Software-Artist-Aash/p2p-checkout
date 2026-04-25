# Integrator Admin UI — Plan

**Status:** Planned

---

## Overview

A dashboard for the business (integrator owner) to manage their checkout integration: view orders, manage clients/pricing, monitor stats, and handle user RP/limits. Accessible at `/admin` in the checkout app, protected by wallet-based auth (only the integrator owner address can access).

---

## Multi-Integrator Implications

Integrators are **non-upgradeable** per the B2B spec. A business may deploy multiple integrators over their lifetime (to change logic, limits, etc.). This means:

**Data continuity:**
- Old orders are linked to the old integrator address in the subgraph's `B2BOrder.integrator` field
- The `Integrator` entity tracks each address separately (volume, active orders)
- Old integrator's on-chain state (sessions, daily volumes) remains readable forever
- The `Orders` entity has full order data regardless of which integrator placed it

**Admin UI must support:**
- Configuring multiple integrator addresses (current + historical)
- Aggregating stats across all integrator versions
- Showing which integrator version each order went through
- Managing only the CURRENT integrator (register clients, set prices, set RP)

**No subgraph changes needed** — `B2BOrder` already links to `Integrator` by address, and the collection query `b2Borders(where: { integrator: "0x..." })` works for any address. To query across multiple integrators, run parallel queries or use `integrator_in: [...]` filter.

---

## Two-Layer Limit System

The integrator enforces **two independent limits** on every order:

### 1. Per-Transaction USDC Limit (RP-based, per-currency)

Controls the max USDC amount in a single order.

```
if userRP[user] == 0:
    txLimit = baseTxLimit                             // fallback for new users
else:
    txLimit = userRP[user] * rpToUsdc[currency]       // RP-only, no base added

capped at maxTxLimit[currency]
```

### 2. Daily Transaction Count Limit (global)

Controls the max number of orders per user per day (count, not USDC volume).

```
dailyTxCountLimit = e.g., 10 orders/day
```

### Examples (baseTxLimit = 50 USDC, dailyTxCountLimit = 10)

| User RP | Currency | Rate (USDC/RP) | Per-TX Limit | Daily Count Limit |
|---------|----------|----------------|--------------|-------------------|
| 0       | any      | any            | 50 USDC      | 10 orders |
| 10      | INR      | 1              | 10 USDC      | 10 orders |
| 10      | BRL      | 2              | 20 USDC      | 10 orders |
| 50      | INR      | 1              | 50 USDC      | 10 orders |
| 100     | BRL      | 2              | 200 USDC     | 10 orders |

Both checks must pass for an order to be accepted.

**Requires new integrator deployment** (V2) — see Contract Changes section below.

---

## Data Sources

| Data | Source | Method |
|---|---|---|
| Integrator stats (volume, active orders) | Subgraph `Integrator` entity | GraphQL query |
| Order list with status | Subgraph `B2BOrder` → join with `Orders` | GraphQL query |
| Order details (amounts, timestamps, UPI) | Subgraph `Orders` entity | GraphQL query by orderId |
| Product prices | On-chain `SimpleERC721Client.getProductPrice()` | Contract read |
| Registered clients | On-chain `MegapotCheckoutIntegrator.clients()` | Contract read |
| User RP balances | On-chain `integrator.userRP(address)` | Contract read |
| User daily order count | On-chain `integrator.userDailyCount(address, dayIndex)` | Contract read |
| RP-to-USDC rates | On-chain `integrator.rpToUsdc(currency)` | Contract read |
| Per-tx base limit (0 RP) | On-chain `integrator.baseTxLimit()` | Contract read |
| Per-tx cap per currency | On-chain `integrator.maxTxLimit(currency)` | Contract read |
| Daily tx count limit | On-chain `integrator.dailyTxCountLimit()` | Contract read |
| User per-tx limit (effective) | On-chain `integrator.getUserTxLimit(user, currency)` | Contract read |
| User orders today | On-chain `integrator.getTodayCount(user)` | Contract read |
| Session data | On-chain `integrator.sessions(orderId)` | Contract read |

---

## Pages

### 1. Dashboard (`/admin`)

**Auth:** Connect wallet → check `integrator.owner() == connectedAddress`

**Stats cards (aggregated across all integrator versions):**
- Total volume (USDC)
- Total orders (completed / cancelled / active)
- Active integrator address + status

**Recent orders table** (last 20):
- Order ID, User, Amount, Currency, Status, Placed At
- Click → order detail

**Quick actions:**
- Link to client management
- Link to RP/limits config
- Link to order list

### 2. Orders (`/admin/orders`)

**Subgraph query:** `b2Borders` filtered by integrator address(es), joined with `orders_collection` for full details.

**Table columns:**
- Order ID
- Integrator version (short address)
- User address
- USDC amount
- Fiat amount
- Currency
- Status (badge)
- Placed / Completed timestamps

**Filters:**
- Status (Placed, Accepted, Paid, Completed, Cancelled)
- Date range
- Integrator version (if multiple)

**Click on row → Order detail:**
- Full order data
- Checkout session (client, productId, fulfilled)
- Timeline: placed → accepted → paid → completed
- Dispute info if any

### 3. Clients & Products (`/admin/clients`)

**For each registered client contract:**
- Client address
- Contract name/symbol (read from ERC721)
- Registered status
- Products with prices

**Actions (on-chain writes via owner wallet):**
- Register new client: `integrator.registerClient(address)`
- Remove client: `integrator.removeClient(address)`
- Set product price: `client.setProductPrice(productId, price)`
- Add new product: `client.setProductPrice(newId, price)`

### 4. Limits & RP (`/admin/limits`)

**Global Config:**

| Setting | Value | Action |
|---|---|---|
| Per-TX Base Limit (0 RP fallback) | 50 USDC | Edit → `setBaseTxLimit(limit)` |
| Daily TX Count Limit | 10 orders | Edit → `setDailyTxCountLimit(count)` |

**Per-Currency Rates (applies to RP > 0 users):**

| Currency | USDC per RP | Max Per-TX Cap | Actions |
|---|---|---|---|
| INR | 1.0 | 500 USDC | Edit rate, Edit cap |
| BRL | 2.0 | 1000 USDC | Edit rate, Edit cap |

- Edit rate → `setRpToUsdc(currency, usdcPerRp)`
- Edit cap → `setMaxTxLimit(currency, cap)`

**User Lookup:**

| Field | Value |
|---|---|
| RP | from `userRP(address)` |
| Orders today | from `getTodayCount(address)` |
| Effective per-tx limit (selected currency) | from `getUserTxLimit(address, currency)` |

- Set RP → `setUserRP(user, rp)`
- Batch set → `batchSetUserRP(users[], rps[])`

### 5. Integrator Versions (`/admin/integrators`)

**List of all integrator addresses the business has used:**
- Address
- Active status on Diamond
- Total volume
- Active orders
- Deployed date (from first transaction)

**Actions:**
- Set which address is "current" (used for admin writes)
- View-only for historical integrators

---

## Contract Changes (Integrator V2)

The current `MegapotCheckoutIntegrator` has a flat `DAILY_LIMIT = 50e6` constant. The V2 integrator replaces this with the RP system.

### State

```solidity
uint256 public baseTxLimit;                     // default 50e6, per-tx fallback for 0 RP
uint256 public dailyTxCountLimit;               // default 10, max orders per user per day
mapping(address => uint256) public userRP;
mapping(bytes32 => uint256) public rpToUsdc;    // USDC per RP (6 decimals)
mapping(bytes32 => uint256) public maxTxLimit;  // per-tx cap per currency (0 = no cap)
mapping(address => mapping(uint256 => uint256)) public userDailyCount; // user → day → count
```

### Admin Functions

```solidity
function setBaseTxLimit(uint256 limit) external onlyOwner;
function setDailyTxCountLimit(uint256 count) external onlyOwner;
function setRpToUsdc(bytes32 currency, uint256 usdcPerRp) external onlyOwner;
function setMaxTxLimit(bytes32 currency, uint256 cap) external onlyOwner;
function setUserRP(address user, uint256 rp) external onlyOwner;
function batchSetUserRP(address[] calldata users, uint256[] calldata rps) external onlyOwner;
```

### validateOrder

```solidity
function validateOrder(address user, uint256 amount, bytes32 currency)
    external onlyDiamond returns (bool)
{
    // 1. Per-transaction USDC limit
    if (amount > getUserTxLimit(user, currency)) return false;

    // 2. Daily transaction count limit
    uint256 dayIndex = block.timestamp / 1 days;
    uint256 count = userDailyCount[user][dayIndex];
    if (count + 1 > dailyTxCountLimit) return false;

    userDailyCount[user][dayIndex] = count + 1;
    return true;
}

function getUserTxLimit(address user, bytes32 currency) public view returns (uint256) {
    uint256 rp = userRP[user];
    if (rp == 0) return baseTxLimit;
    uint256 rate = rpToUsdc[currency];
    if (rate == 0) rate = 1e6;
    uint256 limit = rp * rate;
    uint256 cap = maxTxLimit[currency];
    if (cap > 0 && limit > cap) return cap;
    return limit;
}
```

### Events

```solidity
event UserRPUpdated(address indexed user, uint256 rp);
event RpRateUpdated(bytes32 indexed currency, uint256 usdcPerRp);
event BaseTxLimitUpdated(uint256 limit);
event MaxTxLimitUpdated(bytes32 indexed currency, uint256 cap);
event DailyTxCountLimitUpdated(uint256 count);
```

### Subgraph Additions for RP Events

```graphql
type UserRP @entity {
  id: Bytes!          # integrator-user
  user: Bytes!
  rp: BigInt!
  integrator: Integrator!
  blockTimestamp: BigInt!
}

type RpRateConfig @entity {
  id: Bytes!          # integrator-currency
  integrator: Integrator!
  currency: Bytes!
  usdcPerRp: BigInt!
  blockTimestamp: BigInt!
}
```

### Deployment

1. Deploy `MegapotCheckoutIntegratorV2` with RP system
2. Register on Diamond: `registerIntegrator(v2Addr, true)`
3. Re-register clients on V2
4. Configure rates: `setRpToUsdc("INR", 1e6)`, `setRpToUsdc("BRL", 2e6)`, etc.
5. Set caps if needed: `setMaxDailyLimit("INR", 500e6)`
6. Migrate user RPs: `batchSetUserRP([...], [...])`
7. Update frontend env to V2 address
8. Deactivate V1: `deactivateIntegrator(v1Addr)` — old orders complete normally

---

## Subgraph Queries

### Dashboard stats
```graphql
query IntegratorStats($addresses: [Bytes!]!) {
  integrators(where: { id_in: $addresses }) {
    address
    isActive
    totalVolume
    activeOrderCount
  }
}
```

### Orders list
```graphql
query IntegratorOrders($integrator: Bytes!, $skip: Int, $first: Int) {
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
```

### Order detail (by orderId from B2BOrder)
```graphql
query OrderDetail($orderId: BigInt!) {
  orders_collection(where: { orderId: $orderId }) {
    orderId status type usdcAmount fiatAmount
    actualUsdcAmount actualFiatAmount currency
    userAddress placedAt acceptedAt paidAt completedAt cancelledAt
    acceptedMerchantAddress disputeStatus disputeFaultType
  }
}
```

---

## Auth Model

- Wallet-based: user connects via Privy, admin page checks `integrator.owner() == connectedAddress`
- No separate auth system needed
- Multi-integrator: if owner address is the same across versions (deployed from same wallet), a single login gives access to all
- If different deployer wallets were used, admin would need to connect with each

---

## Implementation Location

Add to the existing checkout app (`/app`):
- New routes: `/admin`, `/admin/orders`, `/admin/clients`, `/admin/limits`, `/admin/integrators`
- New directory: `src/pages/admin/`
- Shared lib: reuse `subgraph.ts` (add new queries), `config.ts`, Privy wallet
