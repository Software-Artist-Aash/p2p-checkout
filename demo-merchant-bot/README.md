# demo-merchant-bot

Auto-accepts and auto-completes orders on behalf of demo merchants so the checkout flow can be demoed end-to-end without a human on the other side. Everything stays on-chain (real txs, real NFT mint at the end) — only the merchant clicks are automated.

The bot does **not** auto-click "I've paid" on the user side. The user still clicks that in the checkout UI.

## How it works

For each merchant key in `MERCHANT_KEYS`, the bot runs two loops:

1. **Accept loop** — polls `fetchMerchantAssignedOrders(merchant)` every `POLL_ASSIGNED_MS`. For each order in `PLACED`, it looks up the order's currency in `DEMO_PAYMENT_ADDRESSES`, encrypts that address with the order's `userPubKey` and calls `acceptOrder(orderId, userEncUpi, relayPubKey)`. Orders whose currency has no entry are skipped.
2. **Complete loop** — polls `fetchMerchantAcceptedOrders(merchant)` every `POLL_ACCEPTED_MS`. For each order in `PAID`, it calls `completeOrder(orderId, "")` after `COMPLETE_DELAY_MS`.

A persistent relay identity is generated on first run and saved to `relay-identity.json` (gitignored). Its public key is passed as the `_pubKey` arg to `acceptOrder` — used by the protocol for SELL-direction encryption, irrelevant for the BUY flow the checkout uses.

## Setup

```bash
cd demo-merchant-bot
npm install
cp .env.example .env
# fill in MERCHANT_KEYS with your test-only private keys
npm run dev
```

## Prerequisites

Each merchant wallet must already be:
- registered as a merchant on the Diamond,
- joined to the circle the checkout's integrator targets (currently `circleId: 1` in `merchant-app/src/pages/store.tsx`),
- staked and have `freeFiatAmount` set for the currency it handles,
- funded with ETH (gas) on the target chain.

## Env

See `.env.example`. Only `MERCHANT_KEYS` is required to change; the rest defaults to Base Sepolia + the deployed Diamond.

## Setup scripts

The bot uses ERC-4337 smart accounts (thirdweb + the same AA factory as `merchant-app-spa`),
so the merchant address the Diamond sees is the smart account, not the signer EOA.

### Create a circle for a new currency

The Diamond allows one circle per admin address, so the script generates a fresh
EOA for each circle's admin (its private key is printed — save it if you need to
manage the circle later, otherwise it's disposable for demos).

```bash
npm run create-circle -- --currency PIX --name "Demo PIX"
```

### Register a new merchant in an existing circle

```bash
npm run register-merchant -- \
  --key 0xMERCHANT_SIGNER_PRIVKEY \
  --currency INR \
  --circle 1 \
  --telegram demo_bot \
  --account 9876543210
```

Defaults: `--stake 1000` (USDC), `--fiat 1000000` (currency smallest unit),
`--channel` auto-resolved from the subgraph for the given currency.

The script:
1. Derives the merchant's smart-account address.
2. Transfers stake USDC from the admin mnemonic to the smart account.
3. Smart account approves USDC to Diamond (sponsored gas).
4. Smart account calls `register(...)` and `addMerchantPaymentChannel(...)`.
5. Admin calls `updateFiatAmount(...)` to seed fiat capacity.

Copy the printed `CURRENCY:0xKEY` line into `MERCHANT_KEYS` in `.env` so the bot
picks it up on the next restart.
