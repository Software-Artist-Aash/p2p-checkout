/**
 * Environment configuration for the checkout app.
 */

// Privy
export const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID ?? "";

// Chain
export const CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? "8453");

// Contract addresses
export const DIAMOND_ADDRESS = (import.meta.env.VITE_DIAMOND_ADDRESS ?? "") as `0x${string}`;
export const USDC_ADDRESS = (import.meta.env.VITE_USDC_ADDRESS ?? "") as `0x${string}`;

// Subgraph
export const SUBGRAPH_URL = import.meta.env.VITE_SUBGRAPH_URL ?? "";

// USDC decimals
export const USDC_DECIMALS = 6;

// Supported currencies with display metadata
// circleId identifies the merchant circle on the Diamond for a currency.
// The Diamond reverts with CurrencyMismatch() if circleId doesn't match
// a circle staked for the given currency.
export const CURRENCIES = [
  { symbol: "INR", name: "Indian Rupee", flag: "🇮🇳", paymentMethod: "UPI", hasQR: true, circleId: 1 },
  { symbol: "IDR", name: "Indonesian Rupiah", flag: "🇮🇩", paymentMethod: "QRIS", hasQR: false, circleId: 1 },
  { symbol: "BRL", name: "Brazilian Real", flag: "🇧🇷", paymentMethod: "PIX", hasQR: false, circleId: 1 },
  { symbol: "ARS", name: "Argentine Peso", flag: "🇦🇷", paymentMethod: "Alias", hasQR: false, circleId: 1 },
  { symbol: "MEX", name: "Mexican Peso", flag: "🇲🇽", paymentMethod: "SPEI", hasQR: false, circleId: 1 },
  { symbol: "VEN", name: "Venezuelan Bolivar", flag: "🇻🇪", paymentMethod: "Pago Movil", hasQR: false, circleId: 1,
    compoundFields: ["Phone", "RIF", "Bank"] },
  { symbol: "NGN", name: "Nigerian Naira", flag: "🇳🇬", paymentMethod: "NIP", hasQR: false, circleId: 1,
    compoundFields: ["Account Number", "Bank Name"] },
] as const;

export type CurrencyConfig = (typeof CURRENCIES)[number];
