# Deployment Plan

## Prerequisites

- [ ] `.env` populated with all values from `.env.example`
- [ ] Deployer wallet funded with ETH for gas
- [ ] P2P Diamond already deployed and operational on target chain
- [ ] USDC address confirmed on target chain
- [ ] At least one merchant staked and online in a circle

---

## Step 1: Deploy B2BGatewayFacet (contracts-v4)

**Repo:** `contracts-v4`
**Who:** P2P protocol team

```bash
# 1a. Compile
npx hardhat compile

# 1b. Deploy B2BGatewayFacet and cut it into the Diamond (single script)
#     Deploys the contract, gets selectors, runs diamondCut(Add), verifies.
DIAMOND_ADDRESS=0x... npx hardhat run scripts/deployB2BGateway.ts --network baseSepolia

# 1c. Upgrade OrderFlowHelper with the B2B hook in completeOrder
#     Removes old facet selectors, deploys updated OrderFlowHelper, cuts in.
DIAMOND_ADDRESS=0x... OLD_ORDER_FLOW_HELPER_ADDRESS=0x... \
  npx hardhat run scripts/upgradeOrderFlowHelperB2B.ts --network baseSepolia
```

**Scripts:** `contracts-v4/scripts/deployB2BGateway.ts`, `contracts-v4/scripts/upgradeOrderFlowHelperB2B.ts`

**Verify:**
```bash
# Check facet is registered
cast call $DIAMOND "isActiveIntegrator(address)" 0x0000000000000000000000000000000000000000
# Should return false (no integrators yet)
```

---

## Step 2: Deploy MegapotCheckoutIntegrator

**Repo:** `megapot-checkout`

```bash
DIAMOND_ADDRESS=0x... USDC_ADDRESS=0x... \
  npx hardhat run scripts/deploy-integrator.ts --network baseSepolia
# Deployer becomes owner
# Contract auto-approves Diamond for max USDC (for clawbacks)
# Script prints next steps after deployment
```

**Script:** `megapot-checkout/scripts/deploy-integrator.ts`

**Save output:** `INTEGRATOR_ADDRESS=0x...`

---

## Step 3: Register Integrator on Diamond

**Repo:** `contracts-v4` (or via cast/multisig)

```bash
# Option A: Via hardhat script (recommended)
DIAMOND_ADDRESS=0x... INTEGRATOR_ADDRESS=0x... \
  npx hardhat run scripts/registerIntegrator.ts --network baseSepolia

# Option B: Via cast (if using multisig or separate admin wallet)
cast send $DIAMOND \
  "registerIntegrator(address,bool)" \
  $INTEGRATOR_ADDRESS \
  true \
  --private-key $SUPER_ADMIN_KEY
```

**Script:** `contracts-v4/scripts/registerIntegrator.ts`

- `true` = USDC routes through integrator (it forwards to client)
- The call runs EIP-1967 proxy detection — will revert if integrator is a proxy

**Verify:**
```bash
cast call $DIAMOND "isActiveIntegrator(address)" $INTEGRATOR_ADDRESS
# Should return true
```

---

## Step 4: Deploy SimpleERC721Client

**Repo:** `megapot-checkout`

```bash
INTEGRATOR_ADDRESS=0x... USDC_ADDRESS=0x... \
  npx hardhat run scripts/deploy-client.ts --network baseSepolia
# Optional: NFT_NAME="MyNFT" NFT_SYMBOL="MN" (defaults to MegapotNFT / MNFT)
# Script prints next steps after deployment
```

**Script:** `megapot-checkout/scripts/deploy-client.ts`

**Save output:** `ERC721_CLIENT_ADDRESS=0x...`

---

## Step 5: Register Client on Integrator

```bash
cast send $INTEGRATOR_ADDRESS \
  "registerClient(address)" \
  $ERC721_CLIENT_ADDRESS \
  --private-key $DEPLOYER_PRIVATE_KEY
```

---

## Step 6: Set Product Prices

```bash
# Product ID 1, price = 10 USDC (10_000_000 in 6 decimals)
cast send $ERC721_CLIENT_ADDRESS \
  "setProductPrice(uint256,uint256)" \
  1 \
  10000000 \
  --private-key $DEPLOYER_PRIVATE_KEY

# Product ID 2, price = 25 USDC
cast send $ERC721_CLIENT_ADDRESS \
  "setProductPrice(uint256,uint256)" \
  2 \
  25000000 \
  --private-key $DEPLOYER_PRIVATE_KEY
```

**Verify:**
```bash
cast call $ERC721_CLIENT_ADDRESS "getProductPrice(uint256)" 1
# Should return 10000000
```

---

## Step 7: Deploy Frontend

```bash
cd app

# 7a. Create .env
cat > .env <<EOF
VITE_PRIVY_APP_ID=clx_your_privy_app_id
VITE_CHAIN_ID=84532
VITE_DIAMOND_ADDRESS=$DIAMOND_ADDRESS
VITE_DEFAULT_INTEGRATOR_ADDRESS=$INTEGRATOR_ADDRESS
EOF

# 7b. Install and build
npm install
npm run build

# 7c. Deploy to hosting (Vercel, Cloudflare Pages, etc.)
# The app serves at: https://checkout.p2p.me
```

---

## Step 8: Business Onboarding

For each business that integrates:

1. Business creates a Privy app (or uses existing one)
2. Business whitelists our Privy App ID in their dashboard:
   `Settings → Cross-app wallets → Allowed apps → Add`
3. Business gives us their Privy App ID
4. Business adds redirect button on their site:

```html
<a href="https://checkout.p2p.me/checkout?integrator=0xINTEGRATOR&client=0xCLIENT&productId=1&privyAppId=clx_BUSINESS_APP_ID">
  Pay with P2P
</a>
```

---

## Post-Deployment Checklist

- [ ] B2BGatewayFacet cut into Diamond
- [ ] OrderFlowHelper updated with B2B hook
- [ ] Integrator deployed and registered on Diamond
- [ ] ERC721 client deployed and registered on integrator
- [ ] Product prices set
- [ ] Frontend deployed with correct env vars
- [ ] End-to-end test: place order → merchant accepts → user pays → complete → NFT minted
- [ ] Clawback test: admin triggers clawback on a completed order
- [ ] Daily limit test: verify 6th order (>50 USDC) is rejected

---

## Rollback

If something goes wrong:

1. **Deactivate integrator:** `cast send $DIAMOND "deactivateIntegrator(address)" $INTEGRATOR_ADDRESS`
   - Existing orders complete normally, no new orders accepted
2. **Remove B2B hook:** Redeploy original OrderFlowHelper without the B2B check, cut into Diamond
3. **Remove facet:** diamondCut with `FacetCutAction.Remove` for B2BGatewayFacet selectors
