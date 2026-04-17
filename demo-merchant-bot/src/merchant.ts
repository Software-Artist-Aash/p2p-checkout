import { createPublicClient, http, encodeFunctionData, fromHex, type Address } from "viem";
import { baseSepolia, base } from "viem/chains";
import {
  estimateGas,
  getRpcClient,
  eth_maxPriorityFeePerGas,
  prepareTransaction,
  sendAndConfirmTransaction,
  type Hex,
} from "thirdweb";
import type { Account } from "thirdweb/wallets";
import { DIAMOND_ABI, OrderStatus } from "./abis.js";
import { encryptForUser, type RelayIdentity } from "./encrypt.js";
import type { BotConfig, MerchantConfig } from "./config.js";
import type { ThirdwebSetup } from "./thirdweb.js";

type OrderTuple = {
  id: bigint;
  status: number;
  user: Address;
  pubkey: string;
  userPubKey: string;
  currency: `0x${string}`;
  amount: bigint;
  orderType: number;
};

function makePublicClient(config: BotConfig) {
  const chain = config.chainId === 8453 ? base : baseSepolia;
  return createPublicClient({ chain, transport: http(config.rpcUrl) });
}

export class MerchantWorker {
  private readonly publicClient: ReturnType<typeof makePublicClient>;
  private readonly merchantAddress: Address;
  private readonly processing = new Set<string>();

  constructor(
    private readonly merchant: MerchantConfig,
    private readonly config: BotConfig,
    private readonly relay: RelayIdentity,
    private readonly setup: ThirdwebSetup,
    private readonly account: Account,
  ) {
    this.publicClient = makePublicClient(config);
    this.merchantAddress = account.address as Address;
  }

  start(): void {
    this.log(`started — smart account ${this.merchantAddress}`);
    this.loopAccept();
    this.loopComplete();
  }

  private loopAccept(): void {
    const tick = async () => {
      try {
        await this.scanAssigned();
      } catch (err) {
        this.log(`scanAssigned error: ${errMsg(err)}`);
      } finally {
        setTimeout(tick, this.config.pollAssignedMs);
      }
    };
    setTimeout(tick, 0);
  }

  private loopComplete(): void {
    const tick = async () => {
      try {
        await this.scanAccepted();
      } catch (err) {
        this.log(`scanAccepted error: ${errMsg(err)}`);
      } finally {
        setTimeout(tick, this.config.pollAcceptedMs);
      }
    };
    setTimeout(tick, 0);
  }

  private async scanAssigned(): Promise<void> {
    const orders = await this.publicClient.readContract({
      address: this.config.diamondAddress,
      abi: DIAMOND_ABI,
      functionName: "fetchMerchantAssignedOrders",
      args: [this.merchantAddress],
    });

    for (const o of orders as unknown as OrderTuple[]) {
      const orderId = o.id.toString();
      if (o.status !== OrderStatus.PLACED) continue;
      if (this.processing.has(orderId)) continue;
      this.processing.add(orderId);
      void this.handleAccept(o).finally(() => this.processing.delete(orderId));
    }
  }

  private async handleAccept(order: OrderTuple): Promise<void> {
    const orderId = order.id.toString();
    const currency = decodeCurrency(order.currency);
    this.log(`order ${orderId} PLACED — currency=${currency} amount=${order.amount} user=${order.user}`);

    if (this.config.acceptDelayMs > 0) {
      await sleep(this.config.acceptDelayMs);
    }

    const userPubKey = order.orderType === 0 ? order.pubkey : order.userPubKey;
    if (!userPubKey) {
      this.log(`order ${orderId} has no user pubkey (orderType=${order.orderType}) — skipping`);
      return;
    }

    const paymentAddress = this.config.demoPaymentAddresses[currency];
    if (!paymentAddress) {
      this.log(`order ${orderId} no DEMO_PAYMENT_ADDRESSES entry for currency=${currency} — skipping`);
      return;
    }
    const userEncUpi = await encryptForUser(userPubKey, paymentAddress);
    const data = encodeFunctionData({
      abi: DIAMOND_ABI,
      functionName: "acceptOrder",
      args: [order.id, userEncUpi, this.relay.publicKey],
    });

    try {
      const receipt = await this.sendSponsored(data);
      if (receipt.status !== "success") {
        this.log(`order ${orderId} acceptOrder REVERTED ${receipt.transactionHash}`);
        return;
      }
      this.log(`order ${orderId} ACCEPTED — tx ${receipt.transactionHash}`);
    } catch (err) {
      this.log(`order ${orderId} acceptOrder failed: ${errMsg(err)}`);
    }
  }

  private async scanAccepted(): Promise<void> {
    const orders = await this.publicClient.readContract({
      address: this.config.diamondAddress,
      abi: DIAMOND_ABI,
      functionName: "fetchMerchantAcceptedOrders",
      args: [this.merchantAddress],
    });

    for (const o of orders as unknown as OrderTuple[]) {
      const orderId = o.id.toString();
      if (o.status !== OrderStatus.PAID) continue;
      if (this.processing.has(orderId)) continue;
      this.processing.add(orderId);
      void this.handleComplete(o).finally(() => this.processing.delete(orderId));
    }
  }

  private async handleComplete(order: OrderTuple): Promise<void> {
    const orderId = order.id.toString();
    this.log(`order ${orderId} PAID — waiting ${this.config.completeDelayMs}ms before complete`);
    if (this.config.completeDelayMs > 0) await sleep(this.config.completeDelayMs);

    const data = encodeFunctionData({
      abi: DIAMOND_ABI,
      functionName: "completeOrder",
      args: [order.id, ""],
    });

    try {
      const receipt = await this.sendSponsored(data);
      if (receipt.status !== "success") {
        this.log(`order ${orderId} completeOrder REVERTED ${receipt.transactionHash}`);
        return;
      }
      this.log(`order ${orderId} COMPLETED — tx ${receipt.transactionHash}`);
    } catch (err) {
      this.log(`order ${orderId} completeOrder failed: ${errMsg(err)}`);
    }
  }

  private async sendSponsored(data: Hex) {
    const { client, chain } = this.setup;
    const base = { to: this.config.diamondAddress, chain, client, data };
    const baseTx = prepareTransaction(base);
    const [estimatedGas, maxPriorityFeePerGas] = await Promise.all([
      estimateGas({ transaction: baseTx, from: this.merchantAddress }),
      eth_maxPriorityFeePerGas(getRpcClient({ client, chain })),
    ]);
    const transaction = prepareTransaction({
      ...base,
      extraGas: estimatedGas * 2n,
      maxFeePerGas: 400_000_000n,
      maxPriorityFeePerGas,
    });
    return sendAndConfirmTransaction({ account: this.account, transaction });
  }

  private log(msg: string): void {
    const ts = new Date().toISOString();
    console.log(`[${ts}] [${this.merchant.label}] ${msg}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function decodeCurrency(hex: `0x${string}`): string {
  try {
    return fromHex(hex, "string").replace(/\0/g, "") || "?";
  } catch {
    return "?";
  }
}

function errMsg(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { shortMessage?: string; message?: string };
    return e.shortMessage || e.message || String(err);
  }
  return String(err);
}
