# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

P2P Checkout: a B2B checkout system where businesses accept local fiat payments (UPI, PIX, SPEI, etc.) and receive USDC on Base. Three components in one repo: Solidity contracts (Hardhat), a checkout frontend (`app/`), and a demo merchant store (`merchant-app/`).

## Commands

```bash
# Contracts
npx hardhat compile          # compile all Solidity
npx hardhat test             # run all contract tests (23 tests, ~500ms)
npx hardhat test test/integrator-v2.test.ts   # single test file

# Checkout app (app/)
cd app && npm run dev        # Vite dev server on :3000
cd app && npm run build      # tsc -b && vite build → dist/

# Merchant demo (merchant-app/)
cd merchant-app && npm run dev    # Vite dev server on :3001
cd merchant-app && npm run build  # tsc -b && vite build → dist/

# Deploy to Base Sepolia
npx hardhat run scripts/deploy-integrator-v2.ts --network baseSepolia
npx hardhat run scripts/deploy-client.ts --network baseSepolia
npx hardhat run scripts/setup-checkout.ts --network baseSepolia  # register + set prices
```

## Architecture

### Contract layer

`CheckoutIntegratorV2` is the core: a non-upgradeable integrator that sits between end-users and the P2P Diamond protocol. It enforces per-tx limits (RP-based, per-currency), daily tx count limits, and supports quantity-based orders.

Flow: user calls `integrator.userPlaceOrder(client, productId, quantity, currency, circleId, pubKey, …)` → integrator calls `diamond.placeB2BOrder(…)` → Diamond assigns merchants → on completion Diamond calls `integrator.onOrderComplete()` → integrator calls `client.onCheckoutPayment(user, amount, productId, quantity)`.

Business clients implement `ICheckoutClient` (see `SimpleERC721Client` for a reference that mints NFTs). `IB2BGateway` is the Diamond-side interface. `IP2PIntegrator` is the callback interface the Diamond calls on the integrator.

Test mocks (`contracts/test/MockDiamond.sol`, `MockUSDC.sol`) simulate the Diamond locally so tests don't need a network.

### Checkout app (`app/`)

React + Vite + Privy for wallet auth. Two main pages:
- `/checkout` — order summary, currency picker, "Pay now" button. Reads product price from on-chain client contract. Places order via `userPlaceOrder`.
- `/checkout/order/:orderId` — status tracking (PLACED → ACCEPTED → PAID → COMPLETED). Shows merchant UPI/QR when accepted, "I've paid" button, auto-redirect on completion.

Key files:
- `src/hooks/use-checkout-wallet.ts` — abstracts Privy auth across standalone and cross-app modes. Returns unified `address`, `login`, `isCrossApp`, `sendCrossAppTransaction`.
- `src/lib/config.ts` — env-driven config. `CURRENCIES` array has per-currency `circleId` (Diamond merchant circle) and payment method metadata.
- `src/lib/contracts.ts` — ABI definitions for integrator, client, and Diamond. `OrderStatus` enum (PLACED=0, ACCEPTED=1, PAID=2, COMPLETED=3, CANCELLED=4).
- `src/lib/checkout-link.ts` — base64url encode/decode of `CheckoutSessionPayload` (integrator, client, productId, quantity, currency, redirectUrl). Must stay in sync with `merchant-app/src/lib/checkout-link.ts`.

### Merchant app (`merchant-app/`)

Demo store showing product cards with quantity selectors. "Buy now" encodes a `CheckoutSessionPayload` and redirects to `VITE_CHECKOUT_URL/checkout?session=<base64>`. Products are hardcoded in `src/lib/config.ts` (IDs 1/2/3 at 5/10/25 USDC).

### Demo mode (demo branch)

`DEMO_MODE = true` in `checkout.tsx` short-circuits `handlePay` — skips the on-chain tx, navigates to a demo order page. `DemoCheckoutOrderPage` in `checkout-order.tsx` runs a local state machine: PLACED → 5s → ACCEPTED (shows sample UPI `p2pdemo@upi` + QR) → user clicks "I've paid" → PAID → 10s → COMPLETED → auto-redirect. No merchant or Diamond interaction needed.

### Cross-app login

When `VITE_PROVIDER_APP_ID` is set, `use-checkout-wallet.ts` uses Privy's `useCrossAppAccounts` so the checkout reuses the merchant app's wallet. The merchant Privy app is the "provider" (requires httpOnly cookies + custom domain for production); the checkout app is the "requester". When unset, standard standalone Privy login is used. See `docs/CROSS-APP-LOGIN.md` for dashboard setup.

## Key integration points

- **circleId**: each currency maps to a Diamond merchant circle. Passing wrong circleId causes `CurrencyMismatch()` revert. Currently all currencies use `circleId: 1` (configurable per-currency in `CURRENCIES` array).
- **Gas estimation**: `handlePay` estimates gas via `publicClient.estimateGas` + 1.5× buffer, fallback 2M. The Diamond's `_assignMerchantsForB2BOrder` loops over merchants so gas scales with circle size (~1M+ on current Base Sepolia).
- **checkout-link payload**: `CheckoutSessionPayload` is the contract between merchant and checkout apps. Both apps have their own copy of the type + encode/decode functions — keep them in sync.

## Environment variables

Root `.env`: `MNEMONIC_KEY`, `DIAMOND_ADDRESS`, `USDC_ADDRESS`, `INTEGRATOR_ADDRESS`, `ERC721_CLIENT_ADDRESS` (used by Hardhat scripts).

`app/.env`: `VITE_PRIVY_APP_ID`, `VITE_CHAIN_ID`, `VITE_DIAMOND_ADDRESS`, `VITE_USDC_ADDRESS`, `VITE_DEFAULT_INTEGRATOR_ADDRESS`, `VITE_SUBGRAPH_URL`, `VITE_PROVIDER_APP_ID` (optional, enables cross-app login).

`merchant-app/.env`: `VITE_PRIVY_APP_ID`, `VITE_CHAIN_ID`, `VITE_CHECKOUT_URL`, `VITE_INTEGRATOR_ADDRESS`, `VITE_CLIENT_ADDRESS`.

## Branches

- `main` — production-ready code, real on-chain flow
- `demo` — `DEMO_MODE = true`, simulated merchant-finding + payment verification, Netlify deployment configs (`app/netlify.toml`, `merchant-app/netlify.toml`)
