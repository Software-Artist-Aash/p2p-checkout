import { ethers } from "hardhat";

/**
 * Deploy SimpleERC721Client.
 *
 * Usage:
 *   INTEGRATOR_ADDRESS=0x... USDC_ADDRESS=0x... npx hardhat run scripts/deploy-client.ts --network baseSepolia
 *
 * Optional env vars:
 *   NFT_NAME    — ERC721 collection name (default: "MegapotNFT")
 *   NFT_SYMBOL  — ERC721 symbol (default: "MNFT")
 *
 * After deployment:
 *   1. Register client on integrator: registerClient(address)
 *   2. Set product prices: setProductPrice(productId, priceInUsdc6Decimals)
 */

const INTEGRATOR_ADDRESS = process.env.INTEGRATOR_ADDRESS || "";
const USDC_ADDRESS = process.env.USDC_ADDRESS || "";
const NFT_NAME = process.env.NFT_NAME || "Digital Item";
const NFT_SYMBOL = process.env.NFT_SYMBOL || "ITEM";

async function main() {
  if (!INTEGRATOR_ADDRESS || !USDC_ADDRESS) {
    throw new Error("INTEGRATOR_ADDRESS and USDC_ADDRESS env vars required");
  }

  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", await deployer.getAddress());
  console.log("Integrator:", INTEGRATOR_ADDRESS);
  console.log("USDC:", USDC_ADDRESS);
  console.log(`NFT: ${NFT_NAME} (${NFT_SYMBOL})`);
  console.log("");

  // ─── Deploy ─────────────────────────────────────────────────────

  console.log("Deploying SimpleERC721Client...");
  const Client = await ethers.getContractFactory("SimpleERC721Client");
  const client = await Client.deploy(
    INTEGRATOR_ADDRESS,
    USDC_ADDRESS,
    NFT_NAME,
    NFT_SYMBOL
  );
  const deployTx = client.deploymentTransaction();
  await deployTx?.wait(5);

  const address = await client.getAddress();
  console.log(`SimpleERC721Client deployed to: ${address}`);

  // ─── Verify ─────────────────────────────────────────────────────

  const code = await ethers.provider.getCode(address);
  if (code === "0x" || code.length <= 2) {
    throw new Error(`Contract has no code at ${address}`);
  }

  const integrator = await client.integrator();
  const usdc = await client.usdc();
  const owner = await client.owner();
  const name = await client.name();
  const symbol = await client.symbol();

  console.log("");
  console.log("=== Deployment Summary ===");
  console.log(`Client:        ${address}`);
  console.log(`Integrator:    ${integrator}`);
  console.log(`USDC:          ${usdc}`);
  console.log(`Owner:         ${owner}`);
  console.log(`Name:          ${name}`);
  console.log(`Symbol:        ${symbol}`);
  console.log("");
  console.log("Next steps:");
  console.log(
    `  1. Register on integrator:  cast send ${INTEGRATOR_ADDRESS} "registerClient(address)" ${address}`
  );
  console.log(
    `  2. Set product prices:      cast send ${address} "setProductPrice(uint256,uint256)" 1 10000000`
  );
  console.log("     (product ID 1, price = 10 USDC)");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
