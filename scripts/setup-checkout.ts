import { ethers } from "hardhat";

/**
 * Wire everything together after deploying integrator + client.
 *
 * Steps:
 *   1. Register integrator on Diamond (registerIntegrator)
 *   2. Register client on integrator (registerClient)
 *   3. Set product price on client (setProductPrice)
 *   4. Verify all setup is correct
 *
 * Usage:
 *   npx hardhat run scripts/setup-checkout.ts --network baseSepolia
 *
 * Env vars (from .env):
 *   DIAMOND_ADDRESS, INTEGRATOR_ADDRESS, ERC721_CLIENT_ADDRESS
 */

const DIAMOND_ADDRESS = process.env.DIAMOND_ADDRESS || "";
const INTEGRATOR_ADDRESS = process.env.INTEGRATOR_ADDRESS || "";
const ERC721_CLIENT_ADDRESS = process.env.ERC721_CLIENT_ADDRESS || "";

// Prices must match merchant-app/src/lib/config.ts PRODUCTS
const PRODUCTS: Array<{ id: number; priceUsdc: string }> = [
  { id: 1, priceUsdc: "5" },
  { id: 2, priceUsdc: "10" },
  { id: 3, priceUsdc: "25" },
];

async function main() {
  if (!DIAMOND_ADDRESS || !INTEGRATOR_ADDRESS || !ERC721_CLIENT_ADDRESS) {
    throw new Error(
      "Missing env vars. Set DIAMOND_ADDRESS, INTEGRATOR_ADDRESS, ERC721_CLIENT_ADDRESS in .env"
    );
  }

  const [admin] = await ethers.getSigners();
  console.log("Admin:", await admin.getAddress());
  console.log("Diamond:", DIAMOND_ADDRESS);
  console.log("Integrator:", INTEGRATOR_ADDRESS);
  console.log("ERC721 Client:", ERC721_CLIENT_ADDRESS);
  console.log("");

  // ─── 1. Register integrator on Diamond ────────────────────────────

  console.log("1. Registering integrator on Diamond...");
  const b2bGateway = await ethers.getContractAt(
    [
      "function registerIntegrator(address integrator, bool usdcThroughIntegrator) external",
      "function isActiveIntegrator(address integrator) external view returns (bool)",
      "function getIntegratorConfig(address integrator) external view returns (tuple(bool isActive, bool usdcThroughIntegrator, uint256 totalVolume, uint256 activeOrderCount, uint256 outstandingDebt))",
    ],
    DIAMOND_ADDRESS
  );

  const alreadyActive = await b2bGateway.isActiveIntegrator(INTEGRATOR_ADDRESS);
  if (alreadyActive) {
    console.log("   Already registered, skipping.");
  } else {
    const tx1 = await b2bGateway.registerIntegrator(INTEGRATOR_ADDRESS, true);
    await tx1.wait();
    console.log("   Done. Tx:", tx1.hash);
  }

  // ─── 2. Register client on integrator ─────────────────────────────

  console.log("2. Registering client on integrator...");
  const integrator = await ethers.getContractAt(
    [
      "function registerClient(address client) external",
      "function clients(address client) external view returns (tuple(bool isRegistered))",
      "function baseTxLimit() external view returns (uint256)",
      "function dailyTxCountLimit() external view returns (uint256)",
    ],
    INTEGRATOR_ADDRESS
  );

  const clientConfig = await integrator.clients(ERC721_CLIENT_ADDRESS);
  if (clientConfig.isRegistered) {
    console.log("   Already registered, skipping.");
  } else {
    const tx2 = await integrator.registerClient(ERC721_CLIENT_ADDRESS);
    await tx2.wait();
    console.log("   Done. Tx:", tx2.hash);
  }

  // ─── 3. Set product prices ────────────────────────────────────────

  console.log(`3. Setting prices for ${PRODUCTS.length} products...`);
  const client = await ethers.getContractAt(
    [
      "function setProductPrice(uint256 productId, uint256 price) external",
      "function getProductPrice(uint256 productId) external view returns (uint256)",
      "function name() external view returns (string)",
      "function symbol() external view returns (string)",
    ],
    ERC721_CLIENT_ADDRESS
  );

  for (const p of PRODUCTS) {
    const price = ethers.parseUnits(p.priceUsdc, 6);
    const current = await client.getProductPrice(p.id);
    if (current == price) {
      console.log(`   Product ${p.id} (${p.priceUsdc} USDC): already set, skipping.`);
    } else {
      const tx = await client.setProductPrice(p.id, price);
      await tx.wait();
      console.log(`   Product ${p.id} (${p.priceUsdc} USDC): done. Tx: ${tx.hash}`);
    }
  }

  // ─── 4. Verify everything ─────────────────────────────────────────

  console.log("");
  console.log("=== Verification ===");

  const isActive = await b2bGateway.isActiveIntegrator(INTEGRATOR_ADDRESS);
  console.log(`Integrator active on Diamond: ${isActive ? "YES" : "NO"}`);
  if (!isActive) console.log("   ERROR: integrator not active!");

  const config = await b2bGateway.getIntegratorConfig(INTEGRATOR_ADDRESS);
  console.log(`  usdcThroughIntegrator: ${config.usdcThroughIntegrator}`);
  console.log(`  totalVolume: ${ethers.formatUnits(config.totalVolume, 6)} USDC`);
  console.log(`  activeOrderCount: ${config.activeOrderCount}`);
  console.log(`  outstandingDebt: ${ethers.formatUnits(config.outstandingDebt, 6)} USDC`);

  const clientCheck = await integrator.clients(ERC721_CLIENT_ADDRESS);
  console.log(`Client registered on integrator: ${clientCheck.isRegistered ? "YES" : "NO"}`);
  if (!clientCheck.isRegistered) console.log("   ERROR: client not registered!");

  const baseTxLimit = await integrator.baseTxLimit();
  const dailyTxCountLimit = await integrator.dailyTxCountLimit();
  console.log(`Base TX limit: ${ethers.formatUnits(baseTxLimit, 6)} USDC per tx`);
  console.log(`Daily TX count limit: ${dailyTxCountLimit.toString()} per day`);

  let allPricesSet = true;
  for (const p of PRODUCTS) {
    const price = await client.getProductPrice(p.id);
    console.log(`Product ${p.id} price: ${ethers.formatUnits(price, 6)} USDC`);
    if (price == 0n) { console.log("   ERROR: product price not set!"); allPricesSet = false; }
  }

  const nftName = await client.name();
  const nftSymbol = await client.symbol();
  console.log(`NFT: ${nftName} (${nftSymbol})`);

  console.log("");
  const allGood = isActive && clientCheck.isRegistered && allPricesSet;
  if (allGood) {
    console.log("All checks passed. Ready to test checkout flow.");
  } else {
    console.log("SOME CHECKS FAILED — review errors above.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
