# How To Test — Step by Step

## Overview

There are two levels of testing:
1. **Local unit tests** — run now, no setup needed (already passing)
2. **Base Sepolia integration test** — full end-to-end with real contracts + Privy

---

## 1. Local Unit Tests (Run Right Now)

```bash
cd megapot-checkout
npx hardhat test
```

This runs 16 tests using MockDiamond — no network needed. Already passing.

---

## 2. Base Sepolia Integration Test

### What You Need Before Starting

| Item | Where to get it |
|---|---|
| Base Sepolia ETH | https://faucet.base.org (select Base Sepolia) |
| A deployer wallet mnemonic | Your existing contracts-v4 `.env` MNEMONIC_KEY |
| Privy account | https://dashboard.privy.io (free) |

### Step-by-Step

#### A. Deploy the Diamond with B2BGatewayFacet

B2BGatewayFacet is already added to the `deployContracts.ts` facet list. Run the full deployment:

```bash
cd contracts-v4

# Make sure .env has:
#   BASE_SEPOLIA_RPC=https://sepolia.base.org
#   MNEMONIC_KEY=test test test ...

npx hardhat run scripts/deployContracts.ts --network baseSepolia
```

This deploys everything: Diamond, all facets (including B2BGatewayFacet), USDC mock, ReputationManager. Save the output addresses.

The script writes `contract-addresses.json` with:
```json
{
  "usdtAddress": "0x...",
  "diamondAddress": "0x...",
  "reputationManagerAddress": "0x..."
}
```

#### B. Deploy the Integrator + Client

```bash
cd megapot-checkout

# Set env vars from the addresses above
export DIAMOND_ADDRESS=0x...   # from contract-addresses.json
export USDC_ADDRESS=0x...      # usdtAddress from contract-addresses.json

# Deploy integrator
npx hardhat run scripts/deploy-integrator.ts --network baseSepolia
# Save: INTEGRATOR_ADDRESS=0x...

# Deploy ERC721 client
export INTEGRATOR_ADDRESS=0x...
npx hardhat run scripts/deploy-client.ts --network baseSepolia
# Save: ERC721_CLIENT_ADDRESS=0x...
```

Note: add `baseSepolia` network to megapot-checkout's hardhat config first:

```ts
// hardhat.config.ts — add inside networks:
baseSepolia: {
  url: "https://sepolia.base.org",
  accounts: { mnemonic: process.env.MNEMONIC_KEY },
},
```

#### C. Wire Everything Together + Verify

One script does all 3 setup steps and verifies everything:

1. Registers integrator on Diamond
2. Registers client on integrator
3. Sets product price (10 USDC)
4. Runs all verification checks

```bash
# Make sure .env has all 3 addresses:
#   DIAMOND_ADDRESS=0x...
#   INTEGRATOR_ADDRESS=0x...
#   ERC721_CLIENT_ADDRESS=0x...

npx hardhat run scripts/setup-checkout.ts --network baseSepolia
```

Expected output ends with:
```
=== Verification ===
Integrator active on Diamond: YES
  usdcThroughIntegrator: true
Client registered on integrator: YES
Daily limit: 50.0 USDC
Product 1 price: 10.0 USDC
NFT: MegapotNFT (MNFT)

All checks passed. Ready to test checkout flow.
```

The script is idempotent — skips steps already done.

#### E. Set Up Privy (For Frontend Testing)

**Yes, Privy supports Base Sepolia** (chain ID 84532). Cross-app wallets are chain-agnostic.

1. **Create a Privy app** at https://dashboard.privy.io
   - Click "Create App"
   - Name it "Megapot Checkout Test"
   - Copy the **App ID** (starts with `clx...` or similar)

2. **Enable smart wallets:**
   - Go to your app → Settings → Smart wallets
   - Toggle ON "Enable smart wallets"

3. **For cross-app testing** (simulating the business site):
   - Create a SECOND Privy app (this simulates the business)
   - In the business app: Settings → Ecosystem → Toggle "Make my wallet accessible to other apps"
   - In the business app: Add your checkout app's App ID to the allowed list
   - In the checkout app: Settings → Ecosystem → Toggle "Use wallets from other apps"
   - Add the business app's App ID to the allowed providers

4. **If you just want to test without cross-app** (simpler):
   - Use a single Privy app
   - Set `createOnLogin: "users-without-wallets"` in the Privy config
   - Users login with email/social and get a smart wallet directly

#### F. Run the Frontend

```bash
cd megapot-checkout/app

# Create .env
cat > .env <<EOF
VITE_PRIVY_APP_ID=clx_your_app_id_here
VITE_CHAIN_ID=84532
VITE_DIAMOND_ADDRESS=0x_your_diamond_address
VITE_DEFAULT_INTEGRATOR_ADDRESS=0x_your_integrator_address
EOF

npm install
npm run dev
# Opens at http://localhost:3000
```

Open the checkout URL:
```
http://localhost:3000/checkout?integrator=0x175dCF36dbC7bfFA48211b2538c57B47985a43B1&client=0xfE457E4d5513495359CA47056828b7e79dD0c6D1&productId=1
```

#### G. Test the Full Flow

Since the frontend has TODO placeholders for contract reads/writes, the full on-chain flow is tested via scripts. Here's how to do the complete B2B order flow manually:

```bash
# Use a test user wallet (account index 2 from mnemonic)
# The user calls integrator.userPlaceOrder

cast send $INTEGRATOR_ADDRESS \
  "userPlaceOrder(address,uint256,bytes32,uint256,string,uint256,uint256)" \
  $ERC721_CLIENT_ADDRESS \
  1 \
  $(cast --format-bytes32-string "INR") \
  1 \
  "" \
  0 \
  0 \
  --mnemonic "test test test ..." \
  --mnemonic-index 2 \
  --rpc-url https://sepolia.base.org
```

Then follow the same flow as `testOrderFlow.ts`:
1. Query order ID from events
2. Merchant accepts: `acceptOrder(orderId, encUpi, pubKey)`
3. User marks paid: `paidBuyOrder(orderId)` — called directly on Diamond by the user
4. Merchant completes: `completeOrder(orderId, "")` — triggers B2B hook → USDC → integrator → client → NFT mint

```bash
# Check NFT was minted to user
cast call $ERC721_CLIENT_ADDRESS "balanceOf(address)" $USER_ADDRESS \
  --rpc-url https://sepolia.base.org
# Expected: 1

# Check session fulfilled
cast call $INTEGRATOR_ADDRESS "getSession(uint256)" $ORDER_ID \
  --rpc-url https://sepolia.base.org
# fulfilled should be true
```

---

## Quick Reference: What Gets Tested Where

| What | Local Tests | Base Sepolia |
|---|---|---|
| Integrator validates 50 USD/day limit | Yes | Yes |
| Client mints NFT on payment | Yes | Yes |
| Access control (onlyDiamond, onlyIntegrator, onlyOwner) | Yes | - |
| Diamond merchant assignment | - | Yes |
| B2B hook in completeOrder | - | Yes |
| order.user = actual user (paidBuyOrder works) | - | Yes |
| Privy wallet connection | - | Yes |
| Cross-app wallet continuity | - | Yes |
| Full order lifecycle (place → accept → pay → complete) | - | Yes |

---

## Troubleshooting

**"Not active integrator" revert:**
- Run `cast call $DIAMOND "isActiveIntegrator(address)" $INTEGRATOR` to check
- If false, you missed step C.1 (registerIntegrator)

**"Proxy contracts not allowed" on registerIntegrator:**
- The integrator address is a proxy. Deploy the non-upgradeable MegapotCheckoutIntegrator, not behind a proxy.

**"Validation failed" on placeB2BOrder:**
- User exceeded 50 USDC daily limit
- Check: `cast call $INTEGRATOR "getRemainingDailyLimit(address)" $USER`

**"ProductNotFound" on userPlaceOrder:**
- Product price not set. Run step C.3 (setProductPrice).

**"NotEnoughEligibleMerchants":**
- No merchant is staked/online in the circle. Register and stake a merchant first using the existing P2P setup scripts.

**Privy "Invalid app ID":**
- Double-check `VITE_PRIVY_APP_ID` in `app/.env`. It must match your Privy dashboard exactly.

**Privy wallet not connecting (cross-app):**
- Both apps must have ecosystem settings configured (step E.3)
- The business app must whitelist the checkout app's ID, and vice versa
- For simpler testing, skip cross-app and use single-app mode (step E.4)
