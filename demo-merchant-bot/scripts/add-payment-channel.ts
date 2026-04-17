/**
 * Add a new payment-channel config (super-admin only).
 *
 * The Diamond tracks one append-only registry of payment-channel configs
 * across all currencies — each has an id (assigned sequentially), a name,
 * a daily volume limit, a currency, and an active flag.
 *
 * Usage:
 *   tsx scripts/add-payment-channel.ts \
 *     --currency BRL \
 *     --name     PIX \
 *     [--daily-limit 1000]   # USDC units (human, default 1000)
 *     [--id      2]          # override (must equal current next id for append)
 */
import { parseArgs } from "node:util";
import { parseUnits } from "viem";
import { DIAMOND_ABI } from "../src/abis.js";
import {
  currencyToBytes32,
  errMsg,
  loadScriptEnv,
  makeAdminClients,
} from "./common.js";

async function main() {
  const { values } = parseArgs({
    options: {
      currency: { type: "string" },
      name: { type: "string" },
      "daily-limit": { type: "string", default: "1000" },
      id: { type: "string" },
    },
  });
  if (!values.currency || !values.name) {
    throw new Error("Missing required args: --currency --name");
  }

  const env = loadScriptEnv();
  const admin = makeAdminClients(env);

  const nextId = (await admin.publicClient.readContract({
    address: env.diamondAddress,
    abi: DIAMOND_ABI,
    functionName: "getCurrentPaymentChannelId",
    args: [],
  })) as bigint;
  const paymentChannelId = values.id ? BigInt(values.id) : nextId;
  const dailyVolumeLimit = parseUnits(values["daily-limit"]!, 6);

  console.log(
    `adding payment channel id=${paymentChannelId} name=${values.name} currency=${values.currency} (next=${nextId})`,
  );
  const hash = await admin.walletClient.writeContract({
    address: env.diamondAddress,
    abi: DIAMOND_ABI,
    functionName: "addOrUpdatePaymentChannelConfig",
    args: [
      {
        paymentChannelId,
        name: values.name,
        dailyVolumeLimit,
        currency: currencyToBytes32(values.currency),
        isActive: true,
      },
    ],
  });
  const r = await admin.publicClient.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`addOrUpdatePaymentChannelConfig reverted: ${hash}`);
  console.log(`added — tx ${hash}`);
  console.log(`paymentChannelConfigId to use when registering merchants: ${paymentChannelId}`);
}

main().catch((err) => {
  console.error("fatal:", errMsg(err));
  process.exit(1);
});
