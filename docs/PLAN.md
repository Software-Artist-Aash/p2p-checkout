# Megapot Checkout — Implementation Plan

**Date:** 2026-04-13
**Based on:** B2B Integration Gateway Design Spec (2026-04-08, Approved)

---

## Overview

Enable businesses to use P2P.me as their fiat-to-crypto checkout. A business embeds a "Pay with P2P" button that redirects users to a checkout UI. Behind the scenes, a **B2BGatewayFacet** on the P2P Diamond dispatches orders that bypass RP limits, and a **MegapotCheckoutIntegrator** contract (implementing `IP2PIntegrator`) enforces its own per-user daily limits, receives USDC on completion, and forwards it to the business's product contract (e.g., an ERC721 that mints on payment).

---

## Architecture

```
Business Site                   Checkout UI                     On-Chain
─────────────                 ──────────────                 ──────────────

[Buy NFT] ──redirect──→  /checkout?integrator=0x..          MegapotCheckoutIntegrator
                          &product=42&amount=10                (IP2PIntegrator)
                                │                                    │
                         1. Connect wallet               2. userPlaceOrder(amount, ...)
                         2. Show summary                       │
                                                         3. validateOrder() ← Diamond callback
                                                               │ checks 50 USD/day limit
                                                         4. placeB2BOrder() → creates order
                                                               │ order.user = end-user
                                                               │ recipientAddr = integrator
                                                               │ skips RP limits
                                                               ▼
                         5. Poll order status             Standard P2P lifecycle:
                         6. Merchant accepts              ─ acceptOrder() by merchant
                         7. Show QR / payment info        ─ paidBuyOrder() by end-user (*)
                         8. User pays fiat                  (direct on Diamond, order.user = them)
                         9. User marks "Paid"             ─ completeOrder() by merchant
                                                               │
                                                         10. onB2BOrderComplete():
                                                               │ USDC → integrator
                                                               │ integrator.onOrderComplete()
                                                               │   → USDC → ERC721Client
                                                               │   → mint NFT to user
                                                               ▼
                         11. Show success + NFT           All in one tx (step 10)

(*) paidBuyOrder works because placeB2BOrder sets order.user = actual end-user address,
    so the user passes the msg.sender == order.user check on the Diamond directly.
```

---

## Phase 1: Protocol Layer (contracts-v4)

These go in the existing P2P Diamond repo. Minimal changes to existing code.

### 1.1 `IP2PIntegrator.sol` (new interface)

```
contracts/interfaces/IP2PIntegrator.sol
```

Exactly as spec defines:
- `validateOrder(address user, uint256 amount, bytes32 currency) → bool`
- `onOrderComplete(uint256 orderId, address user, uint256 amount, address recipientAddr)`

### 1.2 `IB2BGateway.sol` (new interface)

```
contracts/interfaces/IB2BGateway.sol
```

External interface for the facet:
- `placeB2BOrder(address user, uint256 amount, bytes32 currency, address recipientAddr, string pubKey, uint256 circleId, uint256 preferredPaymentChannelConfigId)`
- `onB2BOrderComplete(uint256 orderId)` — internal-facing, called from `completeOrder`
- `registerIntegrator(address, bool)` — owner only
- `deactivateIntegrator(address)` — owner only

### 1.3 `B2BGatewayStorage.sol` (new storage)

```
contracts/storages/B2BGatewayStorage.sol
```

As per spec:
- `IntegratorConfig { isActive, usdcThroughIntegrator, totalVolume, activeOrderCount }`
- `Layout { mapping(address => IntegratorConfig) integrators, mapping(uint256 => address) orderIntegrator }`

### 1.4 `B2BGatewayFacet.sol` (new facet)

```
contracts/facets/B2BGatewayFacet.sol
```

Key functions:

| Function | Access | What it does |
|---|---|---|
| `registerIntegrator` | Owner | Whitelist integrator, EIP-1967 proxy check |
| `deactivateIntegrator` | Owner | Deactivate, existing orders complete normally |
| `placeB2BOrder` | Active integrators only | Validate via `integrator.validateOrder()`, create order with `order.user = user` param (NOT msg.sender), `recipientAddr` per config, skip RP/limit checks, standard merchant assignment |
| `onB2BOrderComplete` | Internal (from completeOrder) | Route USDC per config, call `integrator.onOrderComplete()` |

**Critical detail for `placeB2BOrder`:**
- Must set `order.user = user` (the param), NOT `msg.sender` (which is the integrator)
- This allows end-users to call `paidBuyOrder` and `cancelOrder` directly on the Diamond
- The order uses the same `Order` struct, same storage, same merchant pool
- Must increment `nextOrderId`, assign merchants via same algorithm
- Must skip: RP validation, `txnAmountValid` modifier, daily/monthly user limits (the integrator handles its own limits in `validateOrder`)

### 1.5 Modify `OrderFlowHelper.completeOrder()` (~5 lines)

At `OrderFlowHelper.sol:329-331`, replace:

```solidity
// BEFORE (current):
if (_order.orderType == OrderProcessorStorage.OrderType.BUY) {
    l.usdt.safeTransfer(_order.recipientAddr, _order.amount);
}

// AFTER:
if (_order.orderType == OrderProcessorStorage.OrderType.BUY) {
    B2BGatewayStorage.Layout storage b2bLayout = B2BGatewayStorage.layout();
    if (b2bLayout.orderIntegrator[_orderId] != address(0)) {
        IB2BGateway(address(this)).onB2BOrderComplete(_orderId);
    } else {
        l.usdt.safeTransfer(_order.recipientAddr, _order.amount);
    }
}
```

No other existing facet changes required.

### 1.6 New Events

```solidity
event IntegratorRegistered(address indexed integrator, bool usdcThroughIntegrator);
event IntegratorDeactivated(address indexed integrator);
event B2BOrderPlaced(uint256 indexed orderId, address indexed integrator, address indexed user, uint256 amount);
event B2BOrderCompleted(uint256 indexed orderId, address indexed integrator, uint256 amount);
```

---

## Phase 2: Integrator + Client Contracts (this repo)

### 2.1 `MegapotCheckoutIntegrator.sol`

Implements `IP2PIntegrator`. Non-upgradeable. Deployed per the spec's requirements.

**State:**
```solidity
address public immutable diamond;      // P2P Diamond address
address public immutable usdc;         // USDC token
address public immutable owner;        // Business admin

uint256 public constant DAILY_LIMIT = 50e6;  // 50 USDC (6 decimals)

mapping(address => ClientConfig) public clients;         // client contract → config
mapping(uint256 => CheckoutSession) public sessions;     // orderId → session
mapping(address => mapping(uint256 => uint256)) public userDailyVolume;  // user → day → volume
```

**CheckoutSession struct:**
```solidity
struct CheckoutSession {
    address user;           // end-user who placed
    address client;         // business client contract
    uint256 productId;      // product being purchased
    uint256 usdcAmount;     // amount paid
    bool fulfilled;         // product delivered?
}
```

**Key functions:**

| Function | Caller | Logic |
|---|---|---|
| `userPlaceOrder(client, productId, amount, currency, circleId, pubKey, pcConfigId)` | End-user | Verify client registered, amount matches product price, call `diamond.placeB2BOrder(msg.sender, amount, currency, address(this), ...)`, store CheckoutSession |
| `validateOrder(user, amount, currency)` | Diamond (callback) | Check `userDailyVolume[user][today] + amount <= DAILY_LIMIT`, return true/false |
| `onOrderComplete(orderId, user, amount, recipientAddr)` | Diamond (callback) | Look up session, transfer USDC to client, call `client.onCheckoutPayment(user, amount, productId)`, mark fulfilled |
| `registerClient(clientAddr, ...)` | Owner | Register a business client contract |
| `removeClient(clientAddr)` | Owner | Deregister client |

**Constructor:**
- Sets `diamond`, `usdc`, `owner` as immutable

### 2.2 `ICheckoutClient.sol` (interface)

```solidity
interface ICheckoutClient {
    function onCheckoutPayment(
        address user,
        uint256 usdcAmount,
        uint256 productId
    ) external;

    function getProductPrice(uint256 productId) external view returns (uint256);
}
```

### 2.3 `SimpleERC721Client.sol` (example/test client)

A minimal ERC721 that mints tokens when users pay USDC through the checkout.

**State:**
```solidity
address public immutable integrator;   // MegapotCheckoutIntegrator
address public immutable usdc;
uint256 public nextTokenId;

mapping(uint256 => uint256) public productPrices;   // productId → USDC price
mapping(uint256 => uint256) public tokenProduct;    // tokenId → productId
```

**Key functions:**
- `onCheckoutPayment(user, usdcAmount, productId)` — only callable by integrator, verifies payment >= price, mints ERC721 to user
- `setProductPrice(productId, price)` — owner only
- `getProductPrice(productId)` — view, used by integrator for validation

---

## Phase 3: Frontend Checkout UI

### 3.1 Approach

New standalone React app in this repo (`/app`). Reason: businesses embed/redirect to this, it should be independently deployable and not coupled to the full user-app-spa. Can share packages (wagmi, viem, etc.) but has its own build.

### 3.2 Wallet: Privy Cross-App Wallet Connection

The business site uses **Privy** for wallet management. Our checkout UI connects to the **same Privy wallet** so the user doesn't need to connect a separate wallet or sign in again.

**How it works:**

Privy supports [cross-app smart wallets](https://docs.privy.io/guide/react/wallets/cross-app). When a business creates their Privy app, they whitelist our checkout app's Privy App ID. Our checkout app then accesses the user's existing smart wallet created by the business app — same address, same signer, no second login.

**Setup:**
- Business registers their Privy App ID with us (stored in integrator config or passed as URL param)
- Our checkout app is configured as a Privy cross-app consumer
- On load, we initialize `PrivyProvider` with our app ID and connect to the user's existing smart wallet

**Config in the checkout app:**
```tsx
// app/src/providers/privy-provider.tsx
import { PrivyProvider } from '@privy-io/react-auth';

<PrivyProvider
  appId={CHECKOUT_PRIVY_APP_ID}
  config={{
    smartWallets: {
      createOnLogin: 'off',        // don't create new wallet, connect to existing
    },
    // Cross-app: user's wallet from the business app is accessible here
  }}
>
  {children}
</PrivyProvider>
```

**Integration with wagmi/viem for contract calls:**
```tsx
// Use Privy's wagmi connector to get the signer
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { useWalletClient } from 'wagmi';

// The connected wallet is the same one from the business site
// All contract calls (userPlaceOrder, paidBuyOrder) use this wallet
```

**Redirect flow with wallet continuity:**
1. User is on business site, logged in with Privy → has smart wallet `0xUser...`
2. Clicks "Pay with P2P" → redirected to checkout UI
3. Checkout UI initializes Privy with cross-app config → automatically connects to `0xUser...`
4. User sees their wallet already connected — no login/connect step needed
5. All tx signed with the same wallet → `msg.sender` = `0xUser...` = `order.user` on the Diamond

**URL params from business redirect:**
```
https://checkout.p2p.me/checkout
  ?integrator=0xABC
  &client=0xDEF
  &productId=42
  &privyAppId=clx...     # business's Privy App ID (for cross-app resolution)
```

### 3.3 Routes

| Route | Component | Purpose |
|---|---|---|
| `/checkout` | `CheckoutPage` | Entry from business redirect. Params: `integrator`, `client`, `productId`. Shows product info, price, connects wallet. |
| `/checkout/order/:orderId` | `CheckoutOrderPage` | Order tracking. Reuses the same status flow: placed → accepted (show QR) → paid → completed. |

### 3.4 Entry Flow (`/checkout`)

1. Parse URL params: `integrator`, `client`, `productId`, `privyAppId`
2. Initialize Privy cross-app connection → wallet auto-connects (no user action needed)
3. Read product price from client contract: `client.getProductPrice(productId)`
4. Read user's remaining daily limit from integrator: `DAILY_LIMIT - userDailyVolume[user][today]`
5. Show: product name/image (from client metadata or param), price in USDC + fiat equivalent, daily limit remaining, connected wallet address
6. On "Pay" → call `integrator.userPlaceOrder(client, productId, amount, currency, circleId, pubKey, pcConfigId)` — signed by Privy smart wallet
7. Extract `orderId` from `B2BOrderPlaced` event in tx receipt
8. Navigate to `/checkout/order/:orderId`

### 3.5 Order Tracking (`/checkout/order/:orderId`)

Same lifecycle as user-app-spa's buy order pages, adapted for checkout context:

| Status | What user sees | User action |
|---|---|---|
| `PLACED` | "Finding a merchant..." spinner | Wait |
| `ACCEPTED` | QR code + payment details (merchant's UPI/account) | Pay fiat, then tap "I've Paid" → calls `paidBuyOrder(orderId)` directly on Diamond |
| `PAID` | "Verifying payment..." spinner | Wait |
| `COMPLETED` | Success screen + NFT/product confirmation | Done (product was delivered in `onOrderComplete`) |

**Key difference from user-app-spa:** `paidBuyOrder` is called directly on the Diamond (not through integrator), because `order.user = end-user's address`.

### 3.6 Business Integration Snippet

Businesses embed something like:
```html
<a href="https://checkout.p2p.me/checkout?integrator=0xABC&client=0xDEF&productId=42&privyAppId=clx...">
  Pay with P2P
</a>
```

**Business-side Privy prerequisite:** The business must whitelist our checkout Privy App ID in their Privy dashboard under "Cross-app wallets → Allowed apps". This is a one-time setup during onboarding.

Or a JS SDK that opens a popup/iframe (future enhancement, not MVP).

---

## Phase 4: Subgraph Updates (contracts-v4 subgraph)

New entities:
- **Integrator** — address, isActive, usdcThroughIntegrator, totalVolume, activeOrderCount
- **B2BOrder** — orderId, integrator, user, amount, currency, status, timestamps

Mapped from: `IntegratorRegistered`, `IntegratorDeactivated`, `B2BOrderPlaced`, `B2BOrderCompleted`.

---

## Phase 5: Testing

### 5.1 Contract Tests (Hardhat/Foundry)

**B2BGatewayFacet tests:**
- Register/deactivate integrator (happy + unauthorized)
- Proxy detection rejects EIP-1967 proxy
- `placeB2BOrder` — happy path, inactive integrator reverts, `validateOrder` returning false reverts
- `placeB2BOrder` — verify `order.user` is set to `user` param, not `msg.sender`
- End-user can call `paidBuyOrder` directly for B2B orders
- End-user can call `cancelOrder` directly for B2B orders
- `onB2BOrderComplete` — USDC routing (through integrator vs direct)

**MegapotCheckoutIntegrator tests:**
- `userPlaceOrder` — happy path end-to-end (place → accept → pay → complete → NFT minted)
- `validateOrder` — daily limit enforcement (50 USD), day rollover reset
- `onOrderComplete` — USDC forwarded to client, NFT minted to user
- Only Diamond can call callbacks
- Only registered clients accepted

**SimpleERC721Client tests:**
- Mints on valid payment
- Rejects underpayment
- Only integrator can call `onCheckoutPayment`

### 5.2 Integration Test (full flow)

```
1. Deploy Diamond with B2BGatewayFacet
2. Deploy MegapotCheckoutIntegrator
3. Deploy SimpleERC721Client (product price = 10 USDC)
4. Register integrator on Diamond
5. Register client on integrator
6. Set up merchant with stake
7. End-user calls integrator.userPlaceOrder(client, productId=1, 10 USDC, INR, ...)
8. Merchant accepts order on Diamond
9. End-user calls paidBuyOrder on Diamond
10. Merchant calls completeOrder on Diamond
11. Assert: NFT minted to end-user, integrator USDC balance = 0, session.fulfilled = true
```

---

## Phase 6: Deployment Sequence

1. Deploy `IP2PIntegrator` interface (just for ABI, no deployment needed)
2. Deploy `B2BGatewayFacet` and cut it into the Diamond via `diamondCut`
3. Modify `OrderFlowHelper` with B2B hook, redeploy facet, cut into Diamond
4. Deploy `MegapotCheckoutIntegrator` (immutable, pointing to Diamond + USDC)
5. Register integrator on Diamond: `registerIntegrator(integratorAddr, true)` (usdcThroughIntegrator=true)
6. Deploy `SimpleERC721Client` (pointing to integrator + USDC)
7. Register client on integrator: `registerClient(clientAddr)`
8. Deploy checkout frontend
9. Business adds redirect link

---

## File Structure (this repo)

```
megapot-checkout/
├── contracts/
│   ├── interfaces/
│   │   ├── ICheckoutClient.sol
│   │   └── IP2PIntegrator.sol          # copied from spec for reference
│   ├── MegapotCheckoutIntegrator.sol
│   └── SimpleERC721Client.sol
├── test/
│   ├── MegapotCheckoutIntegrator.test.ts
│   ├── SimpleERC721Client.test.ts
│   └── integration/
│       └── full-checkout-flow.test.ts
├── scripts/
│   ├── deploy-integrator.ts
│   └── deploy-client.ts
├── app/                                 # checkout frontend
│   ├── src/
│   │   ├── providers/
│   │   │   └── privy-provider.tsx       # Privy cross-app wallet config
│   │   ├── pages/
│   │   │   ├── checkout.tsx
│   │   │   └── checkout-order.tsx
│   │   ├── hooks/
│   │   │   ├── use-checkout-order.ts
│   │   │   └── use-checkout-wallet.ts   # Privy wallet + wagmi signer
│   │   ├── lib/
│   │   │   └── contracts.ts             # ABI + addresses
│   │   └── main.tsx
│   ├── package.json                     # @privy-io/react-auth, wagmi, viem
│   └── vite.config.ts
├── hardhat.config.ts
├── package.json
├── PLAN.md
└── README.md
```

---

## Open Decisions

| # | Question | Recommendation |
|---|---|---|
| 1 | Should the B2BGatewayFacet + storage live in contracts-v4 or this repo? | **contracts-v4** — it's a Diamond facet, belongs with the protocol. This repo holds only the integrator + client + frontend. |
| 2 | Daily limit: 50 USDC or 50 USD worth of fiat? | **50 USDC** — simpler, no oracle dependency. The integrator can be redeployed with a different limit later. |
| 3 | Should the checkout frontend be a new app or added to user-app-spa? | **New standalone app** in this repo — independently deployable, businesses point to it, decoupled from consumer app. |
| 4 | Multi-client from day 1? | **Yes** — minimal extra complexity (just a mapping), avoids redeployment when adding second client. Integrator is non-upgradeable per spec. |
| 5 | Fiat amount / slippage for B2B orders? | `placeB2BOrder` should accept `fiatAmountLimit` for slippage protection, same as consumer `placeOrder`. |

---

## Execution Order

1. **Protocol (contracts-v4):** Interfaces → Storage → B2BGatewayFacet → OrderFlowHelper mod → Tests
2. **Integrator (this repo):** MegapotCheckoutIntegrator → SimpleERC721Client → Tests → Integration test
3. **Frontend (this repo):** Checkout page → Order tracking → Wire to contracts
4. **Deploy:** Facet → Integrator → Client → Frontend → Business integration
