# Alchemy Webhook Integration — TradeStars

Guide for wiring an Alchemy webhook to the `CheckoutFulfilled` event on the
TradeStars checkout integrator. Produced for the TradeStars backend team.

---

## What fires the event

When a user completes a fiat-to-USDC checkout through the TradeStars integrator
on Base, the integrator emits `CheckoutFulfilled` as the final step of the order
lifecycle. An Alchemy webhook watching that event delivers a signed HTTP POST
to the TradeStars backend, which drives the Solana-side mint.

```
User pays fiat → merchant releases USDC → Diamond calls onOrderComplete →
integrator marks session fulfilled → emits CheckoutFulfilled → Alchemy picks
up log → webhook POST to backend → backend relays to Solana program
```

---

## Contract + event (Base Sepolia)

| | |
|---|---|
| Integrator address | `0xfB5C4951A8e1a24bbE00E3c36a1cFE764e5aacFF` |
| Network | Base Sepolia |
| Chain ID | `84532` |
| Event signature | `CheckoutFulfilled(uint256 indexed orderId, bytes32 indexed user, uint256 amount)` |
| Topic hash (`topics[0]`) | `0xade21582543f1de342f22f39a885a07a65eb946aa0569900068be9fe7643e9ee` |

Event fields:
- `orderId` (`uint256`, indexed) — the Diamond-side order ID. Monotonic.
- `user` (`bytes32`, indexed) — **Solana pubkey** passed into `userPlaceOrder`.
  32 bytes, NOT an EVM address. This is the mint recipient on Solana.
- `amount` (`uint256`) — USDC amount with 6 decimals (`10_000_000` = 10 USDC).

When the contract is deployed on Base Mainnet, the address will change but the
event signature and topic hash stay the same.

---

## Sample real event on-chain

Use this for end-to-end testing of the webhook pipeline.

| | |
|---|---|
| tx hash | `0xd13fd8f71fefd7a2170d74d0a2e778e02d19f8b2c505b38afcebb09e6698d12d` |
| block | `40632426` |
| log index | `193` |
| explorer | [BaseScan](https://sepolia.basescan.org/tx/0xd13fd8f71fefd7a2170d74d0a2e778e02d19f8b2c505b38afcebb09e6698d12d) |

Raw log fields:

| Field | Value |
|---|---|
| `topics[0]` | `0xade21582543f1de342f22f39a885a07a65eb946aa0569900068be9fe7643e9ee` (event sig) |
| `topics[1]` | `0x0000000000000000000000000000000000000000000000000000000000000040` (orderId = 64) |
| `topics[2]` | `0x1111111111111111111111111111111111111111111111111111111111111111` (Solana recipient — test value) |
| `data` | `0x0000000000000000000000000000000000000000000000000000000000989680` (amount = 10,000,000 = 10 USDC) |

More real events can be triggered on demand during integration testing — ask
the P2P team.

---

## Alchemy webhook setup

### Recommended type: GraphQL Custom Webhook

Alchemy has two relevant products:

- **Custom Webhook (GraphQL)** — filter to exactly this contract + topic. The
  backend receives a narrow, pre-structured payload. **Recommended.**
- **Address Activity Webhook** — fires on any activity at the address; broader
  payload; the backend must filter logs itself. Avoid.

### Create the webhook

Alchemy dashboard → **Notify** → **Create Webhook** → **Custom Webhook**.

- **Chain**: Base (select Sepolia for test, Mainnet for prod — **two separate
  webhooks**)
- **Webhook URL**: TradeStars backend endpoint
- **GraphQL query**:

```graphql
{
  block {
    logs(
      filter: {
        addresses: ["0xfB5C4951A8e1a24bbE00E3c36a1cFE764e5aacFF"]
        topics: ["0xade21582543f1de342f22f39a885a07a65eb946aa0569900068be9fe7643e9ee"]
      }
    ) {
      transaction { hash }
      topics
      data
      index
    }
  }
}
```

Alchemy only POSTs when a block contains a matching log.

After creation, note the **signing key** from the dashboard — it's the shared
HMAC secret used to authenticate webhook POSTs.

---

## Webhook payload format

Each matching block triggers a POST with:

### Headers

```
X-Alchemy-Signature: <hex-encoded HMAC-SHA256 of raw body>
Content-Type: application/json
```

### Body (example)

```json
{
  "webhookId": "wh_xxxxxxxx",
  "id": "whevt_xxxxxxxx",
  "createdAt": "2026-04-24T12:19:02Z",
  "type": "GRAPHQL",
  "event": {
    "data": {
      "block": {
        "logs": [
          {
            "transaction": { "hash": "0xd13fd8f7..." },
            "topics": [
              "0xade21582543f1de342f22f39a885a07a65eb946aa0569900068be9fe7643e9ee",
              "0x0000000000000000000000000000000000000000000000000000000000000040",
              "0x1111111111111111111111111111111111111111111111111111111111111111"
            ],
            "data": "0x0000000000000000000000000000000000000000000000000000000000989680",
            "index": 193
          }
        ]
      }
    }
  }
}
```

### Decoding

- `orderId` = `parseInt(topics[1], 16)` — or treat as uint256 if orders can
  exceed `Number.MAX_SAFE_INTEGER`.
- `solanaPubkey` = `topics[2]` — take the 32 bytes directly as the Solana
  Ed25519 pubkey. Feed raw to Solana SDK; do not base58-encode before passing
  on-chain.
- `amount` = `BigInt(data)` — USDC, 6 decimals.

---

## Verifying the webhook on the backend

The backend MUST verify `X-Alchemy-Signature` on every request. Unauthenticated
POSTs to a mint endpoint would be a critical vulnerability.

Docs reference: [Alchemy signature + auth token](https://www.alchemy.com/support/what-is-alchemy-signature-and-where-to-find-the-auth-token).

### Flow

1. Read `X-Alchemy-Signature` header.
2. Read the **raw** request body (must be raw bytes, not re-parsed JSON — any
   re-serialization will break the signature).
3. Compute `HMAC_SHA256(signing_key, raw_body)`, hex-encoded.
4. Constant-time compare with the header value.
5. Reject the request on any mismatch.

### Node.js example

```ts
import crypto from "crypto";

function verifyAlchemyWebhook(
  rawBody: Buffer,
  signatureHeader: string,
  signingKey: string
): boolean {
  const computed = crypto
    .createHmac("sha256", signingKey)
    .update(rawBody)
    .digest("hex");
  const a = Buffer.from(computed, "hex");
  const b = Buffer.from(signatureHeader, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
```

Raw-body requirement: in Express, mount a raw body parser on the webhook route
specifically, before `express.json()`:

```ts
app.post(
  "/webhooks/alchemy",
  express.raw({ type: "application/json" }),
  (req, res) => {
    if (!verifyAlchemyWebhook(req.body, req.header("x-alchemy-signature") ?? "", SIGNING_KEY)) {
      return res.status(401).end();
    }
    const payload = JSON.parse(req.body.toString("utf8"));
    // handle payload.event.data.block.logs
    res.status(200).end();
  }
);
```

---

## ⚠️ Important: Solana-side verification

The design handed to us described the Solana program verifying "against
Alchemy's public key." **The Alchemy signature above is HMAC-SHA256 — symmetric.**
A Solana program cannot verify HMAC without putting the shared secret on-chain,
which makes the secret public and defeats the security. Alchemy does not publish
a public key for asymmetric webhook signing (AFAIK — confirm with their support
before building the verifier if this is still the plan).

### Recommended pattern: backend re-signs

The backend already holds the Solana mint authority key. Use it like this:

1. Webhook arrives at backend. Backend verifies Alchemy HMAC (authenticates
   origin of the webhook).
2. Backend constructs the mint attestation (order id, Solana recipient, amount,
   Base tx hash).
3. Backend **signs the attestation with its Ed25519 key**.
4. Backend sends the mint transaction to Solana. The attestation + signature
   travel with it.
5. Solana program verifies the signature **against the backend's published
   Ed25519 public key** (baked into the program or stored in a program-owned
   account).

Same security property as the original plan, works with real-world primitives.
The backend ends up being a trusted relayer — which is already the threat model
once you trust Alchemy's webhook at all.

### Alternative: trust-minimized verification (heavier)

A light-client or Merkle proof of the Base log verified on Solana would remove
the trusted relayer. This is substantially more engineering and typically
overkill for a custody-controlled flow; mention only if the trust model requires
it.

---

## Pre-production checklist

- [ ] Separate webhooks for Base Sepolia and Base Mainnet (different URLs OK,
      but keep signing keys distinct so test traffic never reaches prod).
- [ ] Signing key stored as a secret on the backend, not committed.
- [ ] Raw-body middleware on the webhook route; `express.json()` (or equivalent)
      mounted only on other routes.
- [ ] Constant-time signature comparison.
- [ ] Idempotent handler — dedupe by `(chainId, txHash, logIndex)` in case
      Alchemy retries.
- [ ] Reorg handling — if a matching block is later reorged out, Alchemy sends a
      removed event; the backend should unwind any not-yet-finalized actions.
      For Base (L2), finality is typically fast but treat the first few blocks
      as provisional.
- [ ] Solana-side verification decision made (see section above); backend keys
      documented and rotatable.

---

## Contacts

- Integrator contract, driver scripts, real event generation: P2P team
- Webhook setup / signing keys / backend: TradeStars team
