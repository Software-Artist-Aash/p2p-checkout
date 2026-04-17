import { loadConfig } from "./config.js";
import { loadOrCreateRelayIdentity } from "./encrypt.js";
import { MerchantWorker } from "./merchant.js";
import { createSetup, connectSmartAccount } from "./thirdweb.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const relay = loadOrCreateRelayIdentity();
  const setup = createSetup(config);

  console.log("demo-merchant-bot starting");
  console.log(`  chainId:  ${config.chainId}`);
  console.log(`  diamond:  ${config.diamondAddress}`);
  console.log(`  factory:  ${config.aaFactoryAddress}`);
  console.log(`  demo addresses:`);
  for (const [cur, addr] of Object.entries(config.demoPaymentAddresses)) {
    console.log(`    - ${cur.padEnd(8)} ${addr}`);
  }
  console.log(`  relay:    ${relay.address}`);
  console.log(`  merchants (${config.merchants.length}):`);

  for (const merchant of config.merchants) {
    const account = await connectSmartAccount(setup, config, merchant.privateKey);
    console.log(`    - ${merchant.label.padEnd(8)} smart ${account.address}`);
    new MerchantWorker(merchant, config, relay, setup, account).start();
  }
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
