# Testing Plan

## 1. Unit Tests (Automated — this repo)

Already implemented in `test/checkout-flow.test.ts`. Run with:

```bash
npx hardhat test
```

### 1.1 Happy Path
| # | Test | Status |
|---|---|---|
| 1 | Full checkout flow: place → complete → NFT minted to user | PASS |
| 2 | USDC ends up at client contract | PASS |
| 3 | Session marked as fulfilled | PASS |

### 1.2 Daily Limit (50 USDC)
| # | Test | Status |
|---|---|---|
| 4 | 5 orders of 10 USDC (= 50) accepted | PASS |
| 5 | 6th order rejected (exceeds 50 USDC) | PASS |
| 6 | Limits tracked per-user independently | PASS |

### 1.3 Client Registration
| # | Test | Status |
|---|---|---|
| 7 | Unregistered client rejected | PASS |
| 8 | Non-existent product rejected | PASS |
| 9 | Only owner can register/remove clients | PASS |

### 1.4 Access Control
| # | Test | Status |
|---|---|---|
| 10 | validateOrder rejects non-Diamond caller | PASS |
| 11 | onOrderComplete rejects non-Diamond caller | PASS |

### 1.5 ERC721 Client
| # | Test | Status |
|---|---|---|
| 15 | Rejects mint from non-integrator | PASS |
| 16 | Owner can withdraw USDC | PASS |
| 17 | Non-owner cannot withdraw | PASS |
| 18 | Token IDs increment correctly across multiple mints | PASS |

---

## 2. Unit Tests Still Needed (contracts-v4)

These test the B2BGatewayFacet on the actual Diamond. Write in `contracts-v4/test/`.

### 2.1 Integrator Registration
| # | Test |
|---|---|
| 1 | `registerIntegrator` — happy path, emits IntegratorRegistered |
| 2 | `registerIntegrator` — rejects non-superAdmin |
| 3 | `registerIntegrator` — rejects address(0) |
| 4 | `registerIntegrator` — rejects EIP-1967 proxy contract |
| 5 | `deactivateIntegrator` — happy path, emits IntegratorDeactivated |
| 6 | `deactivateIntegrator` — rejects non-superAdmin |

### 2.2 Order Placement (placeB2BOrder)
| # | Test |
|---|---|
| 7 | Happy path — order created, events emitted, merchants assigned |
| 8 | Rejects inactive integrator |
| 9 | Rejects when integrator.validateOrder returns false |
| 10 | Rejects when exchange is not operational |
| 11 | Rejects zero amount |
| 12 | Rejects zero user address |
| 13 | Rejects invalid circle (rejected status, wrong currency) |
| 14 | Slippage protection — reverts when fiatAmount > fiatAmountLimit |
| 15 | **order.user = user param (NOT msg.sender/integrator)** |
| 16 | Small order fee applied correctly |
| 17 | Merchants assigned from correct circle with rotation |
| 18 | nextOrderId incremented |
| 19 | Integrator activeOrderCount and totalVolume updated |

### 2.3 Cross-Contract Interaction
| # | Test |
|---|---|
| 20 | End-user can call `paidBuyOrder` directly (order.user = them) |
| 21 | End-user can call `cancelOrder` directly |
| 22 | Integrator CANNOT call paidBuyOrder (not order.user) |
| 23 | Merchant accepts B2B order same as consumer order |

### 2.4 Order Completion (onB2BOrderComplete)
| # | Test |
|---|---|
| 24 | USDC routed to integrator when usdcThroughIntegrator=true |
| 25 | USDC routed to recipientAddr when usdcThroughIntegrator=false |
| 26 | integrator.onOrderComplete callback fires |
| 27 | activeOrderCount decremented |
| 28 | Rejects caller that is not address(this) |

### 2.5 View Functions
| # | Test |
|---|---|
| 38 | `isActiveIntegrator` returns correct state |
| 39 | `getIntegratorConfig` returns full config |
| 40 | `getOrderIntegrator` returns address(0) for consumer orders |
| 41 | `getOrderIntegrator` returns integrator for B2B orders |

---

## 3. Integration Test (Manual on Testnet)

Full end-to-end on Base Sepolia with real contracts.

### 3.1 Setup
- [ ] All contracts deployed per DEPLOYMENT.md
- [ ] At least 1 merchant staked in a circle with INR currency
- [ ] Merchant bot or manual merchant acceptance available
- [ ] Test user wallet with Privy smart wallet on business site

### 3.2 Happy Path
| Step | Action | Verify |
|---|---|---|
| 1 | Open `checkout.p2p.me/checkout?integrator=X&client=Y&productId=1` | Page loads, wallet auto-connects via Privy cross-app |
| 2 | Verify product price shown | Reads 10 USDC from client contract |
| 3 | Verify daily limit shown | Reads remaining from integrator |
| 4 | Click "Pay with P2P" | TX sent to integrator.userPlaceOrder, orderId returned |
| 5 | Order page shows "Finding merchant..." | Status = PLACED, polling active |
| 6 | Merchant accepts order | Status changes to ACCEPTED, payment details shown |
| 7 | QR code / UPI displayed | Merchant's payment address visible |
| 8 | User pays fiat to merchant (manually) | Fiat sent outside the system |
| 9 | User clicks "I've Paid" | TX sent to Diamond.paidBuyOrder(orderId) |
| 10 | Page shows "Verifying payment..." | Status = PAID |
| 11 | Merchant calls completeOrder | Status = COMPLETED |
| 12 | Success screen shown | NFT minted to user's wallet |
| 13 | Check user's wallet | ERC721 token present with correct productId |
| 14 | Check client contract | USDC balance = 10 USDC |
| 15 | Check integrator session | fulfilled = true |

### 3.3 Daily Limit
| Step | Action | Verify |
|---|---|---|
| 1 | Place 5 orders of 10 USDC each | All succeed |
| 2 | Place 6th order | Reverts — daily limit exceeded |
| 3 | Wait 24 hours (or time-travel on testnet) | Limit resets, order succeeds |

### 3.4 Cancellation
| Step | Action | Verify |
|---|---|---|
| 1 | Place order, wait for merchant acceptance | Status = ACCEPTED |
| 2 | User clicks "Cancel Order" | TX to Diamond.cancelOrder(orderId) |
| 3 | Verify order cancelled | Status = CANCELLED, no USDC moved, no NFT minted |

### 3.5 Privy Cross-App Wallet
| Step | Action | Verify |
|---|---|---|
| 1 | Log in on business site with Privy | Embedded wallet created (0xUser) |
| 2 | Click "Pay with P2P" → redirected to checkout | Wallet auto-connects |
| 3 | Verify address on checkout page | Same 0xUser address as business site |
| 4 | Sign transaction | Uses same wallet, no re-authentication |

### 3.6 Edge Cases
| # | Scenario | Expected |
|---|---|---|
| 1 | Invalid URL params (missing integrator) | Error page shown |
| 2 | Unregistered client in URL | Revert with ClientNotRegistered |
| 3 | Product ID 0 (no price set) | Revert with ProductNotFound |
| 4 | Order expires before merchant accepts | Order auto-cancels per protocol expiry |
| 5 | Merchant goes offline after accepting | Dispute flow (existing P2P mechanism) |
| 6 | User disconnects wallet mid-flow | Reconnect shows same order on return |
| 7 | Two users checkout same product simultaneously | Both get separate orders, both get NFTs |
| 8 | Integrator deactivated while order in progress | Existing order completes normally, no new orders |

---

## 4. Security Checklist

### Smart Contracts
- [ ] No reentrancy in integrator callbacks (Diamond holds the lock)
- [ ] onlyDiamond on all IP2PIntegrator callbacks
- [ ] onlyIntegrator on client's onCheckoutPayment
- [ ] No proxy patterns in integrator (EIP-1967 check on registration)
- [ ] No selfdestruct in integrator or client
- [ ] Daily limit cannot be bypassed by calling validateOrder directly (onlyDiamond)
- [ ] order.user set to actual user (not integrator) — verified in test #15

### Frontend
- [ ] URL params validated before contract calls
- [ ] No private keys or sensitive data in frontend code
- [ ] VITE_PRIVY_APP_ID is not a secret (public client ID)
- [ ] Contract addresses match deployment
- [ ] Chain ID enforced — reject if user on wrong chain
