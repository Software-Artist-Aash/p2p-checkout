/**
 * Launch a new currency on the Diamond (super-admin only).
 *
 * Sets every per-currency config the protocol needs: prices, min stake, limits,
 * fees, merchant assignment count, etc. Uses the same defaults as the protocol
 * test suite so the demo behaves the same as INR.
 *
 * Usage:
 *   tsx scripts/launch-currency.ts --currency BRL
 *
 * Idempotent: if the currency is already supported, prints a note and exits 0.
 */
import { parseArgs } from "node:util";
import { DIAMOND_ABI } from "../src/abis.js";
import {
  currencyToBytes32,
  errMsg,
  loadScriptEnv,
  makeAdminClients,
} from "./common.js";

async function main() {
  const { values } = parseArgs({
    options: { currency: { type: "string" } },
  });
  if (!values.currency) throw new Error("Missing required arg: --currency");

  const env = loadScriptEnv();
  const admin = makeAdminClients(env);
  const currencyHex = currencyToBytes32(values.currency);

  const supported = (await admin.publicClient.readContract({
    address: env.diamondAddress,
    abi: DIAMOND_ABI,
    functionName: "isCurrencySupported",
    args: [currencyHex],
  })) as boolean;

  if (supported) {
    console.log(`${values.currency} is already active — skipping launchCurrency.`);
  } else {
    await launchCurrencyOnChain(env, admin, values.currency, currencyHex);
  }

  await ensureStakeConfig(env, admin, values.currency, currencyHex);
}

async function launchCurrencyOnChain(
  env: ReturnType<typeof loadScriptEnv>,
  admin: ReturnType<typeof makeAdminClients>,
  currencyName: string,
  currencyHex: `0x${string}`,
) {
  console.log(`launching ${currencyName} (admin ${admin.account.address})`);
  const hash = await admin.walletClient.writeContract({
    address: env.diamondAddress,
    abi: DIAMOND_ABI,
    functionName: "launchCurrency",
    args: [
      currencyHex,
      {
        buyPrice: 1000n * 10n ** 6n,
        sellPrice: 990n * 10n ** 6n,
        buyPriceOffset: 0n,
        baseSpread: 15n * 10n ** 5n,
      },
      2n * 10n ** 6n,
      admin.account.address,
      250_000_000n,
      100_000n * 10n ** 6n,
      1000n,
      25n,
      20_000n * 10n ** 6n,
      1n,
      1n,
      400n * 10n ** 6n,
      400n * 10n ** 6n,
      4n,
      10n * 10n ** 6n,
      125_000n,
      90n,
    ],
  });
  const r = await admin.publicClient.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`launchCurrency reverted: ${hash}`);
  console.log(`launched — tx ${hash}`);
}

/**
 * `launchCurrency` does NOT touch `ProtocolConfigStorage.stakeConfigByCurrency`.
 * Without a non-zero `maxMerchantsPerCircle`, merchant registration reverts
 * with `CircleFull` (see libCircleCommon.sol:106). So we always ensure a sane
 * stake config is in place — the Diamond initializer seeds INR/IDR/etc. with
 * the same values at deploy time.
 */
async function ensureStakeConfig(
  env: ReturnType<typeof loadScriptEnv>,
  admin: ReturnType<typeof makeAdminClients>,
  currencyName: string,
  currencyHex: `0x${string}`,
) {
  const existing = (await admin.publicClient.readContract({
    address: env.diamondAddress,
    abi: DIAMOND_ABI,
    functionName: "getStakeConfig",
    args: [currencyHex],
  })) as { maxMerchantsPerCircle: bigint; minMerchantUSDCStake: bigint };

  if (existing.maxMerchantsPerCircle > 0n) {
    console.log(
      `stake config for ${currencyName} already set (max=${existing.maxMerchantsPerCircle}, minStake=${existing.minMerchantUSDCStake}) — skipping.`,
    );
    return;
  }

  console.log(`setting stake config for ${currencyName}`);
  const hash = await admin.walletClient.writeContract({
    address: env.diamondAddress,
    abi: DIAMOND_ABI,
    functionName: "setStakeConfig",
    args: [
      currencyHex,
      {
        minCircleAdminP2PStake: 0n,
        minMerchantUSDCStake: 1000n * 10n ** 6n,
        maxMerchantUSDCStake: (1n << 256n) - 1n,
        maxMerchantsPerCircle: 100_000n,
        circleStakeToDelegationNumerator: 0n,
        circleStakeToDelegationDenominator: 0n,
        merchantSelfStakeDelegationNumerator: 0n,
        merchantSelfStakeDelegationDenominator: 0n,
      },
    ],
  });
  const r = await admin.publicClient.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`setStakeConfig reverted: ${hash}`);
  console.log(`  setStakeConfig tx ${hash}`);
}

main().catch((err) => {
  console.error("fatal:", errMsg(err));
  process.exit(1);
});
