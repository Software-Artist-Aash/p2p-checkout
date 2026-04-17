import "dotenv/config";
import type { Hex, Address } from "viem";

export interface MerchantConfig {
  label: string;
  privateKey: Hex;
}

export interface BotConfig {
  rpcUrl: string;
  chainId: number;
  diamondAddress: Address;
  thirdwebClientId: string;
  aaFactoryAddress: Address;
  merchants: MerchantConfig[];
  demoPaymentAddresses: Record<string, string>;
  pollAssignedMs: number;
  pollAcceptedMs: number;
  acceptDelayMs: number;
  completeDelayMs: number;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") throw new Error(`Missing env var: ${name}`);
  return v.trim();
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Invalid number for ${name}: ${v}`);
  return n;
}

function parseDemoPaymentAddresses(raw: string | undefined): Record<string, string> {
  if (!raw || !raw.trim()) {
    return { INR: "p2pdemo@upi" };
  }
  const entries = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const out: Record<string, string> = {};
  for (const entry of entries) {
    const idx = entry.indexOf(":");
    if (idx === -1) {
      throw new Error(`Invalid DEMO_PAYMENT_ADDRESSES entry "${entry}" — expected CURRENCY:ADDRESS`);
    }
    const label = entry.slice(0, idx).trim();
    const addr = entry.slice(idx + 1).trim();
    if (!label || !addr) {
      throw new Error(`Invalid DEMO_PAYMENT_ADDRESSES entry "${entry}" — empty label or address`);
    }
    out[label] = addr;
  }
  return out;
}

function parseMerchantKeys(raw: string): MerchantConfig[] {
  const entries = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (entries.length === 0) throw new Error("MERCHANT_KEYS is empty");

  return entries.map((entry) => {
    const idx = entry.indexOf(":");
    if (idx === -1) {
      throw new Error(`Invalid MERCHANT_KEYS entry "${entry}" — expected CURRENCY:0xKEY`);
    }
    const label = entry.slice(0, idx).trim();
    const key = entry.slice(idx + 1).trim();
    if (!label) throw new Error(`Empty currency label in MERCHANT_KEYS entry "${entry}"`);
    if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
      throw new Error(`Invalid private key for "${label}" — must be 0x + 64 hex chars`);
    }
    return { label, privateKey: key as Hex };
  });
}

export function loadConfig(): BotConfig {
  const rpcUrl = required("RPC_URL");
  const chainId = num("CHAIN_ID", 84532);
  const diamondAddress = required("DIAMOND_ADDRESS") as Address;
  const thirdwebClientId = required("THIRDWEB_CLIENT_ID");
  const aaFactoryAddress = required("AA_FACTORY_ADDRESS") as Address;
  const merchants = parseMerchantKeys(required("MERCHANT_KEYS"));
  const demoPaymentAddresses = parseDemoPaymentAddresses(process.env.DEMO_PAYMENT_ADDRESSES);

  return {
    rpcUrl,
    chainId,
    diamondAddress,
    thirdwebClientId,
    aaFactoryAddress,
    merchants,
    demoPaymentAddresses,
    pollAssignedMs: num("POLL_ASSIGNED_MS", 4000),
    pollAcceptedMs: num("POLL_ACCEPTED_MS", 6000),
    acceptDelayMs: num("ACCEPT_DELAY_MS", 2000),
    completeDelayMs: num("COMPLETE_DELAY_MS", 3000),
  };
}
