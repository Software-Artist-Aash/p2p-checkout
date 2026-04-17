/**
 * Register a new merchant on the P2P Diamond for the demo flow.
 *
 * Usage:
 *   tsx scripts/register-merchant.ts \
 *     --key      0xMERCHANT_SIGNER_PRIVKEY \
 *     --currency INR \
 *     --circle   1 \
 *     --telegram demo_bot \
 *     --account  9876543210 \
 *     --stake    1000 \      # USDC units (human, default 1000)
 *     --fiat     1000000     # fiat credit (smallest currency unit, default 1,000,000)
 *     [--channel 0]          # paymentChannelConfigId; auto-detected via subgraph if omitted
 *
 * What it does, in order:
 *  1. Derives the ERC-4337 smart account address for the merchant signer (matches merchant-app-spa).
 *  2. Admin EOA sends `stake` USDC + a tiny ETH top-up to the smart account if needed.
 *  3. Smart account approves USDC to the Diamond (sponsored gas via thirdweb).
 *  4. Smart account calls `register(circleId, stake, telegramId, currency)`.
 *  5. Smart account calls `addMerchantPaymentChannel(configId, accountNo, label, false)`.
 *  6. Admin calls `updateFiatAmount(smartAccount, accountNo, +fiat)` to seed fiat capacity.
 */
import { parseArgs } from "node:util";
import {
  encodeFunctionData,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import {
  createThirdwebClient,
  defineChain,
  estimateGas,
  eth_maxPriorityFeePerGas,
  getRpcClient,
  prepareTransaction,
  sendAndConfirmTransaction,
} from "thirdweb";
import {
  baseSepolia as baseSepoliaTW,
  base as baseTW,
} from "thirdweb/chains";
import {
  smartWallet,
  privateKeyToAccount as twPrivateKeyToAccount,
} from "thirdweb/wallets";
import { DIAMOND_ABI, ERC20_ABI } from "../src/abis.js";
import {
  currencyToBytes32,
  errMsg,
  fetchActivePaymentChannels,
  loadScriptEnv,
  makeAdminClients,
  signerToViemAccount,
} from "./common.js";

async function main() {
  const { values } = parseArgs({
    options: {
      key: { type: "string" },
      currency: { type: "string" },
      circle: { type: "string" },
      telegram: { type: "string" },
      account: { type: "string" },
      stake: { type: "string", default: "1000" },
      fiat: { type: "string", default: "1000000" },
      channel: { type: "string" },
    },
  });

  if (!values.key || !values.currency || !values.circle || !values.telegram || !values.account) {
    throw new Error("Missing required args: --key --currency --circle --telegram --account");
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(values.key)) {
    throw new Error("--key must be 0x + 64 hex chars");
  }

  const env = loadScriptEnv();
  const privateKey = values.key as Hex;
  const currency = values.currency;
  const circleId = BigInt(values.circle);
  const telegramId = values.telegram;
  const accountNo = BigInt(values.account);
  const stakeUsdc = parseUnits(values.stake!, 6);
  const fiatDelta = BigInt(values.fiat!);

  // Resolve payment-channel config for this currency.
  let channelId: bigint;
  if (values.channel) {
    channelId = BigInt(values.channel);
  } else {
    const channels = await fetchActivePaymentChannels(env, currency);
    if (channels.length === 0) {
      throw new Error(`No active payment-channel configs found for ${currency}. Pass --channel explicitly.`);
    }
    if (channels.length > 1) {
      console.log(`Multiple channels for ${currency}:`);
      for (const c of channels) console.log(`  id=${c.paymentChannelId} name=${c.name}`);
      throw new Error("Multiple channels — pass --channel <id> to pick one");
    }
    channelId = BigInt(channels[0]!.paymentChannelId);
    console.log(`Resolved paymentChannelConfigId=${channelId} (${channels[0]!.name}) for ${currency}`);
  }

  // Admin side (EOA, viem).
  const admin = makeAdminClients(env);
  console.log(`admin: ${admin.account.address}`);

  // Merchant smart account (thirdweb).
  const twClient = createThirdwebClient({ clientId: env.thirdwebClientId });
  const twBase = env.chainId === 8453 ? baseTW : baseSepoliaTW;
  const twChain = defineChain({
    id: twBase.id,
    rpc: env.rpcUrl,
    nativeCurrency: twBase.nativeCurrency,
    testnet: twBase.testnet,
    blockExplorers: twBase.blockExplorers,
  });
  const personalAccount = twPrivateKeyToAccount({ client: twClient, privateKey });
  const wallet = smartWallet({
    chain: twChain,
    sponsorGas: true,
    factoryAddress: env.aaFactoryAddress,
  });
  const smartAccount = await wallet.connect({ client: twClient, personalAccount });
  const merchantAddress = smartAccount.address as Address;
  console.log(`merchant signer EOA: ${signerToViemAccount(privateKey).address}`);
  console.log(`merchant smart account: ${merchantAddress}`);

  // Early exit if already registered.
  const details = (await admin.publicClient.readContract({
    address: env.diamondAddress,
    abi: DIAMOND_ABI,
    functionName: "getMerchantDetails",
    args: [merchantAddress],
  })) as { isRegistered: boolean; stake: bigint; circleId: bigint };
  if (details.isRegistered) {
    console.log(
      `already registered (stake=${details.stake}, circle=${details.circleId}) — skipping register/channel steps.`,
    );
    return;
  }

  // Step 1: fund smart account with USDC for stake.
  const smartUsdcBal = (await admin.publicClient.readContract({
    address: env.usdcAddress,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [merchantAddress],
  })) as bigint;
  const needUsdc = stakeUsdc > smartUsdcBal ? stakeUsdc - smartUsdcBal : 0n;
  if (needUsdc > 0n) {
    console.log(`funding smart account with ${needUsdc} USDC (raw)`);
    const hash = await admin.walletClient.writeContract({
      address: env.usdcAddress,
      abi: ERC20_ABI,
      functionName: "transfer",
      args: [merchantAddress, needUsdc],
    });
    const r = await admin.publicClient.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`USDC transfer reverted: ${hash}`);
    console.log(`  USDC sent: ${hash}`);
  } else {
    console.log("smart account already has enough USDC");
  }

  // Step 2: smart account approves USDC to Diamond (sponsored).
  const currentAllowance = (await admin.publicClient.readContract({
    address: env.usdcAddress,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [merchantAddress, env.diamondAddress],
  })) as bigint;
  if (currentAllowance < stakeUsdc) {
    console.log(`approving ${stakeUsdc} USDC to Diamond`);
    const data = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "approve",
      args: [env.diamondAddress, stakeUsdc],
    });
    const r = await sendSponsored(twClient, twChain, smartAccount, env.usdcAddress, data);
    console.log(`  approve tx: ${r.transactionHash}`);
  } else {
    console.log("allowance already sufficient");
  }

  // Step 3: smart account calls register.
  console.log(`registering (circle=${circleId}, stake=${stakeUsdc}, currency=${currency})`);
  const registerData = encodeFunctionData({
    abi: DIAMOND_ABI,
    functionName: "register",
    args: [circleId, stakeUsdc, telegramId, currencyToBytes32(currency)],
  });
  const regR = await sendSponsored(
    twClient,
    twChain,
    smartAccount,
    env.diamondAddress,
    registerData,
  );
  console.log(`  register tx: ${regR.transactionHash}`);

  // Step 4: smart account adds payment channel.
  console.log(`adding payment channel (configId=${channelId}, accountNo=${accountNo})`);
  const addChannelData = encodeFunctionData({
    abi: DIAMOND_ABI,
    functionName: "addMerchantPaymentChannel",
    args: [channelId, accountNo, `demo-${currency}`, false],
  });
  const chR = await sendSponsored(
    twClient,
    twChain,
    smartAccount,
    env.diamondAddress,
    addChannelData,
  );
  console.log(`  addMerchantPaymentChannel tx: ${chR.transactionHash}`);

  // Step 5: admin credits fiat amount.
  if (fiatDelta > 0n) {
    console.log(`crediting fiat (+${fiatDelta}) to merchant/account`);
    const hash = await admin.walletClient.writeContract({
      address: env.diamondAddress,
      abi: DIAMOND_ABI,
      functionName: "updateFiatAmount",
      args: [merchantAddress, accountNo, fiatDelta],
    });
    const r = await admin.publicClient.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`updateFiatAmount reverted: ${hash}`);
    console.log(`  updateFiatAmount tx: ${hash}`);
  }

  console.log("\nMerchant registered successfully.");
  console.log(`  signer EOA      : ${signerToViemAccount(privateKey).address}`);
  console.log(`  smart account   : ${merchantAddress}`);
  console.log(`  circleId        : ${circleId}`);
  console.log(`  paymentChannel  : ${channelId}`);
  console.log(`  accountNo       : ${accountNo}`);
  console.log(`\nAdd to demo-merchant-bot/.env MERCHANT_KEYS:`);
  console.log(`  ${currency}:${privateKey}`);
}

async function sendSponsored(
  client: ReturnType<typeof createThirdwebClient>,
  chain: ReturnType<typeof defineChain>,
  account: Awaited<ReturnType<ReturnType<typeof smartWallet>["connect"]>>,
  to: Address,
  data: Hex,
) {
  const base = { to, chain, client, data };
  const baseTx = prepareTransaction(base);
  const [estimatedGas, maxPriorityFeePerGas] = await Promise.all([
    estimateGas({ transaction: baseTx, from: account.address as Address }),
    eth_maxPriorityFeePerGas(getRpcClient({ client, chain })),
  ]);
  const transaction = prepareTransaction({
    ...base,
    extraGas: estimatedGas * 2n,
    maxFeePerGas: 400_000_000n,
    maxPriorityFeePerGas,
  });
  return sendAndConfirmTransaction({ account, transaction });
}

main().catch((err) => {
  console.error("fatal:", errMsg(err));
  process.exit(1);
});
