/**
 * Create a new merchant circle for a currency.
 *
 * The Diamond enforces "1 circle per admin address" (CircleFacet.sol), so for
 * each new circle we generate a fresh random EOA to act as that circle's admin
 * — keeps the main admin mnemonic reusable for future currencies.
 *
 * Usage:
 *   tsx scripts/create-circle.ts \
 *     --currency PIX \
 *     --name "Demo PIX" \
 *     [--community   https://t.me/demo-pix] \
 *     [--admin-community https://t.me/demo-pix-admin] \
 *     [--auto-approve true]
 *
 * Prints the new circleId + generated circle-admin private key/address.
 */
import { parseArgs } from "node:util";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { decodeEventLog, parseAbi } from "viem";
import { DIAMOND_ABI } from "../src/abis.js";
import {
  currencyToBytes32,
  errMsg,
  loadScriptEnv,
  makeAdminClients,
} from "./common.js";

const CIRCLE_CREATED_EVENT = parseAbi([
  "event CircleCreated(uint256 indexed circleId, bytes32 indexed currency, address indexed admin, string name, string communityUrl, string adminCommunityUrl, bool autoApprovePaymentChannels)",
]);

async function main() {
  const { values } = parseArgs({
    options: {
      currency: { type: "string" },
      name: { type: "string" },
      community: { type: "string" },
      "admin-community": { type: "string" },
      "auto-approve": { type: "string", default: "true" },
    },
  });

  if (!values.currency || !values.name) {
    throw new Error("Missing required args: --currency --name");
  }

  const env = loadScriptEnv();
  const currency = values.currency;
  const name = values.name;
  const communityUrl = values.community ?? `https://t.me/demo-${currency.toLowerCase()}`;
  const adminCommunityUrl =
    values["admin-community"] ?? `https://t.me/demo-${currency.toLowerCase()}-admin`;
  const autoApprove = values["auto-approve"] !== "false";

  const admin = makeAdminClients(env);

  // Generate a fresh EOA for this circle's admin so the mnemonic-owner isn't blocked
  // by the 1-circle-per-admin constraint.
  const circleAdminKey = generatePrivateKey();
  const circleAdminAccount = privateKeyToAccount(circleAdminKey);
  console.log(`circle admin (generated EOA): ${circleAdminAccount.address}`);

  console.log(`creating circle (currency=${currency}, name="${name}", autoApprove=${autoApprove})`);
  const hash = await admin.walletClient.writeContract({
    address: env.diamondAddress,
    abi: DIAMOND_ABI,
    functionName: "createCircle",
    args: [
      currencyToBytes32(currency),
      circleAdminAccount.address,
      name,
      communityUrl,
      adminCommunityUrl,
      autoApprove,
    ],
  });
  const r = await admin.publicClient.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`createCircle reverted: ${hash}`);

  let circleId: bigint | undefined;
  for (const log of r.logs) {
    try {
      const decoded = decodeEventLog({
        abi: CIRCLE_CREATED_EVENT,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === "CircleCreated") {
        circleId = decoded.args.circleId;
        break;
      }
    } catch {}
  }

  console.log("\nCircle created.");
  console.log(`  tx              : ${hash}`);
  console.log(`  circleId        : ${circleId ?? "(not decoded — check tx)"}`);
  console.log(`  currency        : ${currency}`);
  console.log(`  circle admin EOA: ${circleAdminAccount.address}`);
  console.log(`  admin privkey   : ${circleAdminKey}`);
  console.log(
    `\nSave the admin private key above somewhere safe — you'll need it if you later\nwant to modify circle settings from this admin. For demo purposes it's disposable.`,
  );
}

main().catch((err) => {
  console.error("fatal:", errMsg(err));
  process.exit(1);
});
