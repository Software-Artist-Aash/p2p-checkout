/**
 * Shared payload format with the merchant app.
 * Keep in sync with merchant-app/src/lib/checkout-link.ts
 */
export interface CheckoutSessionPayload {
  integrator: `0x${string}`;
  client: `0x${string}`;
  productId: number;
  quantity?: number;
  redirectUrl: string;
  currency?: string;
  metadata?: Record<string, string>;
}

export function decodeCheckoutPayload(token: string): CheckoutSessionPayload | null {
  try {
    let b64 = token.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const json = atob(b64);
    return JSON.parse(json) as CheckoutSessionPayload;
  } catch {
    return null;
  }
}

const STORAGE_KEY = "@P2P_CHECKOUT:ORDER_REDIRECTS";

export function saveOrderRedirect(orderId: string, redirectUrl: string): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const map: Record<string, string> = raw ? JSON.parse(raw) : {};
    map[orderId] = redirectUrl;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {}
}

export function getOrderRedirect(orderId: string): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const map: Record<string, string> = JSON.parse(raw);
    return map[orderId] ?? null;
  } catch {
    return null;
  }
}

export function buildRedirectBackUrl(redirectUrl: string, orderId: string, productId?: number): string {
  const url = new URL(redirectUrl);
  url.searchParams.set("orderId", orderId);
  if (productId !== undefined) url.searchParams.set("productId", productId.toString());
  return url.toString();
}
