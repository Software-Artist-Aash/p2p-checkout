import "dotenv/config";
import {
  createPublicClient,
  createWalletClient,
  http,
  stringToHex,
  type Address,
  type Hex,
} from "viem";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { baseSepolia, base } from "viem/chains";

export interface ScriptEnv {
  rpcUrl: string;
  chainId: number;
  diamondAddress: Address;
  usdcAddress: Address;
  thirdwebClientId: string;
  aaFactoryAddress: Address;
  subgraphUrl: string;
  adminMnemonic: string;
}

function req(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") throw new Error(`Missing env var: ${name}`);
  return v.trim();
}

export function loadScriptEnv(): ScriptEnv {
  return {
    rpcUrl: req("RPC_URL"),
    chainId: Number(process.env.CHAIN_ID ?? 84532),
    diamondAddress: req("DIAMOND_ADDRESS") as Address,
    usdcAddress: req("USDC_ADDRESS") as Address,
    thirdwebClientId: req("THIRDWEB_CLIENT_ID"),
    aaFactoryAddress: req("AA_FACTORY_ADDRESS") as Address,
    subgraphUrl: req("SUBGRAPH_URL"),
    adminMnemonic: req("ADMIN_MNEMONIC"),
  };
}

export function viemChain(env: ScriptEnv) {
  return env.chainId === 8453 ? base : baseSepolia;
}

export function makeAdminClients(env: ScriptEnv) {
  const chain = viemChain(env);
  const account = mnemonicToAccount(env.adminMnemonic);
  const publicClient = createPublicClient({ chain, transport: http(env.rpcUrl) });
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(env.rpcUrl),
  });
  return { account, publicClient, walletClient };
}

export function signerToViemAccount(privateKey: Hex) {
  return privateKeyToAccount(privateKey);
}

export function currencyToBytes32(currency: string): `0x${string}` {
  return stringToHex(currency, { size: 32 });
}

export interface PaymentChannelConfigRow {
  paymentChannelId: string;
  name: string;
  currency: `0x${string}`;
  dailyVolumeLimit: string;
}

export async function fetchActivePaymentChannels(
  env: ScriptEnv,
  currency: string,
): Promise<PaymentChannelConfigRow[]> {
  const currencyHex = currencyToBytes32(currency);
  const query = `
    query ($currency: Bytes!) {
      paymentChannelConfigs(where: { isActive: true, currency: $currency }) {
        paymentChannelId
        name
        currency
        dailyVolumeLimit
      }
    }
  `;
  const res = await fetch(env.subgraphUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { currency: currencyHex } }),
  });
  const json = (await res.json()) as {
    data?: { paymentChannelConfigs: PaymentChannelConfigRow[] };
    errors?: unknown;
  };
  if (json.errors) throw new Error(`Subgraph error: ${JSON.stringify(json.errors)}`);
  return json.data?.paymentChannelConfigs ?? [];
}

export function errMsg(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { shortMessage?: string; message?: string };
    return e.shortMessage || e.message || String(err);
  }
  return String(err);
}
