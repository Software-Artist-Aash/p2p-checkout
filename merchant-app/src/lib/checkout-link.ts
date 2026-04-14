/**
 * Checkout session payload — encoded as base64 in a single URL param.
 *
 * Merchant builds this payload, base64-encodes it, and redirects to:
 *   <CHECKOUT_URL>/checkout?session=<base64-payload>
 *
 * The checkout app decodes it on entry and uses the data to place the order.
 * The redirectUrl is called on successful payment (with ?orderId=X appended).
 */
export interface CheckoutSessionPayload {
  /** Integrator contract address */
  integrator: `0x${string}`;
  /** Client contract address (e.g., the ERC721 NFT contract) */
  client: `0x${string}`;
  /** Product ID to purchase */
  productId: number;
  /** How many units of the product to purchase (default 1) */
  quantity?: number;
  /** URL to redirect back to on success — orderId will be appended as ?orderId=X */
  redirectUrl: string;
  /** Optional default currency (e.g., "INR") */
  currency?: string;
  /** Optional metadata passed through to the success page */
  metadata?: Record<string, string>;
}

/**
 * Encode a payload as a URL-safe base64 string.
 */
export function encodeCheckoutPayload(payload: CheckoutSessionPayload): string {
  const json = JSON.stringify(payload);
  // base64url (replace +/ with -_, strip padding)
  const b64 = btoa(json)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return b64;
}

/**
 * Decode a base64 payload back into a CheckoutSessionPayload.
 */
export function decodeCheckoutPayload(token: string): CheckoutSessionPayload | null {
  try {
    // base64url → base64
    let b64 = token.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const json = atob(b64);
    return JSON.parse(json) as CheckoutSessionPayload;
  } catch {
    return null;
  }
}

/**
 * Build the full checkout URL from a payload.
 */
export function buildCheckoutUrl(
  checkoutBaseUrl: string,
  payload: CheckoutSessionPayload
): string {
  const session = encodeCheckoutPayload(payload);
  return `${checkoutBaseUrl}/checkout?session=${session}`;
}
