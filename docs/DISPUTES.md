# Dispute Flow — Implementation Plan

**Status:** Planned (not yet implemented)

---

## How Disputes Work in P2P

### Who Can Raise
Only the order user (`order.user == msg.sender`).

### When (BUY Orders)
- Order status must be **CANCELLED** (merchant cancelled after user paid)
- Must have `paidTimestamp > 0` (user actually marked as paid before cancellation)
- Time window: **15 minutes to 24 hours** after order placement
- Dispute not already raised (`disputeInfo.status == DEFAULT`)

### What User Provides
Last 4 digits of the fiat transaction ID (as evidence of payment).

### Contract Call
```solidity
function raiseDispute(uint256 _orderId, uint256 redactTransId) public
// On OrderProcessorFacet (Diamond)
// Only callable by order.user
```

### What Happens After
1. Merchant gets flagged as "disputed" — can't accept new orders
2. Circle admin reviews and calls `adminSettleDispute(orderId, faultType)`
   - **User at fault** → RP penalty applied to user
   - **Merchant at fault** → order gets completed (USDC released to user), merchant penalized, circle dispute counter incremented
3. If circle dispute counter exceeds threshold → circle gets rejected

### Dispute Time Constants
```solidity
DISPUTE_WINDOW_BUY_START = 15 minutes
DISPUTE_WINDOW_BUY_END = 24 hours
DISPUTE_WINDOW_SELL_START = 30 minutes
DISPUTE_WINDOW_SELL_END = 7 days
```

---

## Plan for Checkout App

### Where It Appears

On the **CANCELLED** order status screen in `checkout-order.tsx`, show a dispute section if eligible.

### Eligibility Check
```typescript
const canDispute =
  order.status === OrderStatus.CANCELLED &&
  paidTimestamp > 0 &&
  order.disputeStatus === 0 && // DEFAULT
  now >= order.placedTimestamp + 15 * 60 && // 15 min passed
  now <= order.placedTimestamp + 24 * 60 * 60; // within 24 hours
```

### UI Flow (3-step inline)

**Step 1 — Button:**
- "Raise Dispute" button on CANCELLED screen
- Shows time remaining in dispute window
- Disabled if outside window or dispute already raised
- If dispute already raised: show "Dispute Raised — Under Review" badge

**Step 2 — Warning (on click):**
- "Only raise if you actually made payment"
- "Admin will review the dispute"
- "False disputes lead to RP penalty"
- [Confirm] [Cancel] buttons

**Step 3 — Form (on confirm):**
- Input: "Last 4 digits of your transaction ID" (numeric, 4 chars)
- [Submit Dispute] [Cancel] buttons
- Submit calls `raiseDispute(orderId, BigInt(digits))` on Diamond via Privy `sendTransaction`

### ABI Addition
```typescript
// Add to DIAMOND_ABI in contracts.ts
{
  name: "raiseDispute",
  type: "function",
  stateMutability: "nonpayable",
  inputs: [
    { name: "_orderId", type: "uint256" },
    { name: "redactTransId", type: "uint256" }
  ],
  outputs: [],
}
```

### Data Needed (already fetched)
- `order.status` — from `getOrdersById`
- `order.placedTimestamp` — from `getOrdersById`
- `order.disputeInfo.status` — from `getOrdersById` (need to add to OrderData interface)
- `paidTimestamp` — from `getAdditionalOrderDetails` (already fetched)

### No Contract Changes
`raiseDispute` is on `OrderProcessorFacet`, already deployed on the Diamond. User calls it directly since `order.user` is their address.

---

## Reference: How user-app-spa Does It

**Files:**
- `pages/order/help-drawer/index.tsx` — drawer container
- `pages/order/help-drawer/help-list-view.tsx` — dispute button with time remaining
- `pages/order/help-drawer/dispute-confirmation-view.tsx` — warning page
- `pages/order/help-drawer/dispute-form-view.tsx` — transaction ID input
- `pages/order/help-drawer/utils.ts` — `canRaiseDispute()` and `getDisputeTimeRemaining()`
- `hooks/use-raise-dispute.ts` — React Query mutation
- `core/adapters/thirdweb/actions/order.ts` — `raiseDispute()` contract call
