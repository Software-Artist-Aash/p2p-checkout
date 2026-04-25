# P2P Checkout — Integration Guide

## What this is

P2P Checkout lets your users pay in local fiat (UPI, PIX, SPEI, etc.)
while you receive USDC on Base. There is no card network, no payment
gateway, and no custody of user funds. A real peer merchant in the
user's country accepts their fiat; once confirmed, the P2P protocol
releases USDC to your smart contract, which delivers whatever you sell
(NFTs, credits, access, tokens).

You integrate by:

1. Deploying an **integrator contract** on Base (or using a provided
   one).
2. Importing the **`<P2PCheckout />`** React widget into your
   frontend.

The widget handles the entire P2P payment flow — merchant matching,
payment display, QR codes, verification, success screen. Your code
handles product selection, pricing, and the integrator contract call.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        YOUR FRONTEND                            │
│                                                                 │
│  ┌──────────────────┐     ┌──────────────────────────────────┐  │
│  │ Your store UI     │     │ <P2PCheckout />  widget          │  │
│  │                   │     │                                  │  │
│  │ • Product listing │     │ • "Finding a merchant" spinner   │  │
│  │ • Qty / currency  │     │ • Merchant UPI / QR code         │  │
│  │ • "Buy now" btn   │     │ • "I've paid" button             │  │
│  │                   │     │ • "Verifying…" spinner           │  │
│  │ On Buy:           │     │ • Success / receipt screen       │  │
│  │  placeOrder() ────┼────▶│                                  │  │
│  │  (your contract)  │     │ Calls Diamond: paidBuyOrder,     │  │
│  │                   │     │ getOrdersById, cancelOrder       │  │
│  └──────────────────┘     └──────────────────────────────────┘  │
│                                                                 │
│  Wallet: YOUR signer (Privy / wagmi / ethers / viem / any)      │
└────────────────────┬────────────────────────────────────────────┘
                     │ on-chain
          ┌──────────▼──────────┐
          │  YOUR INTEGRATOR    │  ← you deploy this
          │  (e.g. Checkout-    │
          │   IntegratorV2)     │
          │                     │
          │  userPlaceOrder()   │
          │  validateOrder()    │
          └──────────┬──────────┘
                     │
          ┌──────────▼──────────┐
          │  P2P DIAMOND        │  ← P2P protocol (not yours)
          │                     │
          │  placeB2BOrder()    │
          │  paidBuyOrder()     │
          │  completeOrder()    │
          └──────────┬──────────┘
                     │ on completion
          ┌──────────▼──────────┐
          │  YOUR CLIENT        │  ← you deploy this
          │  (e.g. SimpleERC721 │
          │   Client)           │
          │                     │
          │  onCheckoutPayment()│ ← receives USDC, delivers product
          └─────────────────────┘
```

**Your code**: store UI + integrator contract + client contract.
**Widget**: everything between "Pay now" and "Payment complete".
**Diamond**: P2P protocol — merchant matching, escrow, verification.

---

## Step 1 — Smart contracts

### Integrator contract

The integrator sits between your users and the Diamond. It enforces
your business rules (rate limits, pricing, allowed products) and
calls `diamond.placeB2BOrder()`.

A reference implementation is provided: `CheckoutIntegratorV2.sol`.
You can use it as-is or write your own — the widget doesn't care
about your integrator's ABI.

```solidity
// Your integrator must implement IP2PIntegrator (callbacks from Diamond):
interface IP2PIntegrator {
    function validateOrder(address user, uint256 amount, bytes32 currency)
        external returns (bool);
    function onOrderComplete(uint256 orderId, address user, uint256 amount, address recipient)
        external;
}
```

The provided `CheckoutIntegratorV2` adds:
- Per-tx USDC limits (RP-based, per currency)
- Daily transaction count limits
- Quantity support (`totalPrice = unitPrice × quantity`)
- Session tracking (`CheckoutSession` struct)

Deploy with:
```bash
DIAMOND_ADDRESS=0x... USDC_ADDRESS=0x... \
  npx hardhat run scripts/deploy-integrator-v2.ts --network base
```

### Client contract

The client is your product-delivery contract. It receives USDC from
the integrator on order completion and fulfills the order (mint an
NFT, grant access, credit tokens, etc.).

```solidity
interface ICheckoutClient {
    function onCheckoutPayment(
        address user,
        uint256 usdcAmount,
        uint256 productId,
        uint256 quantity
    ) external;

    function getProductPrice(uint256 productId) external view returns (uint256);
}
```

A reference implementation is provided: `SimpleERC721Client.sol`
(mints `quantity` NFTs to the user).

### Registration

After deploying both contracts:

```bash
# 1. Register integrator on the P2P Diamond
npx hardhat run scripts/setup-checkout.ts --network base

# 2. Register client on integrator
integrator.registerClient(clientAddress)

# 3. Set product prices on client
client.setProductPrice(1, 5_000_000)   // product 1 = 5 USDC
client.setProductPrice(2, 10_000_000)  // product 2 = 10 USDC
```

---

## Step 2 — Frontend integration

### Install

```bash
npm install @p2pdotme/checkout-widget
# or, if using the local package:
# "dependencies": { "@p2pdotme/checkout-widget": "file:../packages/checkout-widget" }
```

Peer dependencies: `react >=18`, `react-dom >=18`, `viem >=2`.

### The signer

The widget needs a `CheckoutSigner` to sign P2P protocol transactions
(`paidBuyOrder`, `cancelOrder`). This is a minimal interface:

```typescript
interface CheckoutSigner {
  address: `0x${string}`;
  sendTransaction: (tx: {
    to: `0x${string}`;
    data: `0x${string}`;
    gasLimit?: number;
  }) => Promise<{ hash: `0x${string}` }>;
}
```

Create one from whatever wallet library you use:

```typescript
// Privy
import { useSendTransaction, usePrivy } from "@privy-io/react-auth";
const { user } = usePrivy();
const { sendTransaction } = useSendTransaction();
const signer: CheckoutSigner = {
  address: user.wallet.address as `0x${string}`,
  sendTransaction: async (tx) => {
    const { hash } = await sendTransaction(tx);
    return { hash };
  },
};

// wagmi
import { useAccount, useSendTransaction } from "wagmi";
const { address } = useAccount();
const { sendTransactionAsync } = useSendTransaction();
const signer: CheckoutSigner = {
  address: address!,
  sendTransaction: async (tx) => {
    const hash = await sendTransactionAsync(tx);
    return { hash };
  },
};
```

### The `placeOrder` callback

This is the function you write. It contains your integrator-specific
logic. The widget calls it when the user clicks "Pay now" and handles
the loading/error states for you. You return `{ orderId, txHash }`.

```typescript
import { getRelayIdentity } from "@p2pdotme/sdk/payload";
import { encodeFunctionData, stringToHex, createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { parseOrderIdFromReceipt } from "@p2pdotme/checkout-widget";

const publicClient = createPublicClient({ chain: base, transport: http() });

async function placeOrder(): Promise<{ orderId: string; txHash: string }> {
  // 1. Get the relay pubkey (for encrypted merchant↔user communication)
  const relay = getRelayIdentity();
  if (relay.isErr()) throw new Error(relay.error.message);

  // 2. Encode YOUR integrator's function call
  const data = encodeFunctionData({
    abi: YOUR_INTEGRATOR_ABI,
    functionName: "userPlaceOrder",
    args: [
      clientAddress,                              // your client contract
      BigInt(productId),                          // product
      BigInt(quantity),                           // quantity
      stringToHex("INR", { size: 32 }),           // currency
      1n,                                         // circleId (merchant circle)
      relay.value.publicKey,                      // relay pubkey
      0n,                                         // preferredPaymentChannelConfigId
      0n,                                         // fiatAmountLimit (0 = no limit)
    ],
  });

  // 3. Estimate gas (Diamond's merchant assignment loop scales with circle size)
  let gasLimit = 2_000_000n;
  try {
    const est = await publicClient.estimateGas({
      account: signer.address,
      to: integratorAddress,
      data,
    });
    gasLimit = (est * 3n) / 2n;
  } catch {}

  // 4. Send the transaction
  const { hash } = await signer.sendTransaction({
    to: integratorAddress,
    data,
    gasLimit: Number(gasLimit),
  });

  // 5. Wait for receipt and parse orderId
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const orderId = parseOrderIdFromReceipt(receipt);
  if (!orderId) throw new Error("Could not parse order ID from receipt");

  return { orderId, txHash: hash };
}
```

`parseOrderIdFromReceipt` is a helper exported by the widget — it
looks for `CheckoutOrderCreated` or `B2BOrderPlaced` events in the
tx receipt. If your integrator emits different events, parse the
orderId yourself and return it.

### Render the widget

```tsx
import { P2PCheckout } from "@p2pdotme/checkout-widget";

function MyStore() {
  const [showCheckout, setShowCheckout] = useState(false);

  return (
    <>
      <button onClick={() => setShowCheckout(true)}>Buy now</button>

      {showCheckout && (
        <P2PCheckout
          placeOrder={placeOrder}
          amount="10 USDC"
          productName="Rare NFT × 2"
          signer={signer}
          mode="modal"
          open={true}
          onClose={() => setShowCheckout(false)}
          onComplete={(orderId) => {
            setShowCheckout(false);
            router.push(`/success?order=${orderId}`);
          }}
          onError={(err) => console.error(err)}
        />
      )}
    </>
  );
}
```

That's it. The widget takes over from "Pay now" through "Payment
complete".

---

## What happens after "Pay now"

The widget manages this entire lifecycle automatically:

```
User clicks "Pay now"
        │
        ▼
┌───────────────────┐
│ PLACING            │  Your placeOrder() runs. Widget shows spinner.
│                    │  If it throws, widget shows error + retry.
└────────┬──────────┘
         │ returns { orderId }
         ▼
┌───────────────────┐
│ PLACED             │  Widget polls Diamond every 3s.
│ "Finding a         │  Waiting for a P2P merchant to accept.
│  merchant…"        │
└────────┬──────────┘
         │ merchant accepts → Diamond status = ACCEPTED
         ▼
┌───────────────────┐
│ ACCEPTED           │  Widget decrypts merchant's payment address.
│                    │  Shows UPI ID / bank details / QR code.
│ "Pay ₹830 via UPI" │  User pays fiat from their banking app.
│ [I've paid]        │
└────────┬──────────┘
         │ user clicks "I've paid" → widget calls Diamond.paidBuyOrder()
         ▼
┌───────────────────┐
│ PAID               │  Widget polls Diamond every 10s.
│ "Verifying…"       │  Merchant confirms they received fiat.
└────────┬──────────┘
         │ merchant confirms → Diamond status = COMPLETED
         ▼
┌───────────────────┐
│ COMPLETED          │  Diamond releases USDC to integrator.
│ "Payment complete" │  Integrator calls client.onCheckoutPayment().
│ [Done]             │  Client delivers product (NFT mint, etc.).
└────────────────────┘  Widget fires onComplete(orderId).
```

At any point during ACCEPTED, the user can cancel. Widget calls
`Diamond.cancelOrder()`. No fiat moves, no USDC moves.

---

## Props reference

| Prop | Type | Required | Description |
|---|---|---|---|
| `placeOrder` | `() => Promise<{ orderId, txHash }>` | one of `placeOrder` or `orderId` | Your integrator call. Widget handles loading/error. |
| `orderId` | `string` | one of `placeOrder` or `orderId` | Skip straight to tracking an existing order. |
| `signer` | `CheckoutSigner` | yes | Wallet signer for `paidBuyOrder` / `cancelOrder`. |
| `amount` | `string` | no | Display string (e.g. `"10 USDC"`). Shown on pre-order screen. |
| `productName` | `string` | no | Display string (e.g. `"Rare NFT × 2"`). |
| `mode` | `"modal" \| "inline"` | no | Default `"modal"`. Modal renders as a portal overlay. |
| `open` | `boolean` | no | Controlled open/close for modal mode. |
| `demo` | `boolean` | no | Simulate the flow without real transactions. |
| `chainId` | `number` | no | Default `84532` (Base Sepolia). Use `8453` for Base mainnet. |
| `diamondAddress` | `` `0x${string}` `` | no | Override the Diamond contract address. |
| `rpcUrl` | `string` | no | Override the JSON-RPC endpoint. |
| `onOrderPlaced` | `(orderId, txHash) => void` | no | Fired after `placeOrder` succeeds. |
| `onComplete` | `(orderId) => void` | no | Fired when the order reaches COMPLETED. |
| `onError` | `(error) => void` | no | Fired on unrecoverable errors. |
| `onCancel` | `(orderId) => void` | no | Fired when the order is cancelled. |
| `onClose` | `() => void` | no | Fired when modal close button or backdrop is clicked. |

---

## Supported currencies

The P2P protocol supports merchants in these currencies. Pass the
currency code when calling your integrator's `userPlaceOrder`.

| Code | Country | Payment rail | QR |
|---|---|---|---|
| INR | India | UPI | Yes |
| IDR | Indonesia | QRIS | — |
| BRL | Brazil | PIX | — |
| ARS | Argentina | Bank alias | — |
| MXN | Mexico | SPEI | — |
| VES | Venezuela | Pago Móvil | — |
| NGN | Nigeria | NIP | — |

The widget automatically shows the correct payment method UI and QR
code (where applicable) based on the currency in the on-chain order.

---

## Demo mode

Pass `demo={true}` to test the full UI flow without real transactions:

- `placeOrder` is still called but can return a fake result
- Merchant-finding is simulated (5-second delay)
- A sample UPI ID and QR code are shown
- Payment verification is simulated (10-second delay)
- No on-chain calls are made for `paidBuyOrder` or `cancelOrder`

Useful for development, demos to stakeholders, and UI testing.

---

## What you own vs. what the widget owns

| Responsibility | Owner |
|---|---|
| Product catalog, prices, quantity UI | You |
| User authentication / wallet | You |
| Integrator contract + `userPlaceOrder` | You |
| Client contract + product delivery | You |
| Currency selection, circleId | You |
| Gas estimation for your integrator | You |
| `placeOrder()` callback | You |
| — | — |
| "Finding a merchant" UI | Widget |
| Payment address decryption | Widget |
| UPI / PIX / bank details display | Widget |
| QR code generation | Widget |
| "I've paid" → `paidBuyOrder` call | Widget |
| Order status polling | Widget |
| "Verifying" UI | Widget |
| Success / cancel / error screens | Widget |
| `cancelOrder` call | Widget |

---

## Example: custom integrator

If you write your own integrator with a different `placeOrder`
signature, nothing changes on the widget side. You just write a
different `placeOrder` callback:

```typescript
// Your integrator takes (buyer, sku, count, currency, pubKey)
const placeOrder = async () => {
  const data = encodeFunctionData({
    abi: MY_CUSTOM_ABI,
    functionName: "buyItem",
    args: [buyerAddr, skuId, count, currencyHex, pubKey],
  });
  const { hash } = await signer.sendTransaction({ to: myIntegrator, data });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  // Parse orderId however your contract emits it
  const orderId = parseMyCustomEvent(receipt);
  return { orderId, txHash: hash };
};

// Widget is identical — it only cares about orderId
<P2PCheckout placeOrder={placeOrder} signer={signer} ... />
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "Buffer is not defined" | Node.js polyfill missing in Vite | Add `import { Buffer } from "buffer"; window.Buffer = Buffer;` at the top of your app's entry file |
| "intrinsic gas too low" | Gas limit too low or zero | Use `estimateGas` + 1.5× buffer in your `placeOrder` callback |
| `CurrencyMismatch()` revert | Wrong `circleId` for the currency | Check which circle the P2P merchants are staked in; pass that `circleId` |
| "Could not parse order ID" | Your integrator emits different events | Parse the orderId yourself and return it from `placeOrder` |
| Widget stuck on "Finding a merchant" | No P2P merchant online for this currency | Check merchant availability; or use `demo={true}` for testing |
| Modal doesn't appear | `open={false}` or component not rendered | Ensure `open={true}` and the `P2PCheckout` element is in the JSX tree |

---

## Questions

For volume-based pricing, custom integrator support, or access to
additional currencies, reach out to the P2P team.
