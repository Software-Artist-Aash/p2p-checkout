import { ethers } from "hardhat";

/**
 * End-to-end driver for TradeStarsCheckoutIntegrator on Base Sepolia.
 *
 * Places an order, waits for the merchant bot (Railway) to accept, calls
 * paidBuyOrder, waits for completion, then prints the CheckoutFulfilled log.
 *
 *   Usage:
 *     INTEGRATOR_ADDRESS=0x... DIAMOND_ADDRESS=0x... \
 *       npx hardhat run scripts/drive-tradestars-order.ts --network baseSepolia
 *
 *   Optional:
 *     AMOUNT_USDC=10      (integer USDC, default 10)
 *     CURRENCY=INR        (default INR)
 *     CIRCLE_ID=1         (default 1)
 *     SOLANA_RECIPIENT=0x... (32-byte hex, default dummy 0x11..11)
 *     POLL_MS=5000        (polling interval, default 5s)
 *     TIMEOUT_MS=600000   (overall timeout, default 10min)
 */

const INTEGRATOR_ADDRESS = process.env.INTEGRATOR_ADDRESS || "";
const DIAMOND_ADDRESS = process.env.DIAMOND_ADDRESS || "";
const AMOUNT_USDC = process.env.AMOUNT_USDC || "10";
const CURRENCY = process.env.CURRENCY || "INR";
const CIRCLE_ID = BigInt(process.env.CIRCLE_ID || "1");
const SOLANA_RECIPIENT = process.env.SOLANA_RECIPIENT || ("0x" + "11".repeat(32));
const POLL_MS = Number(process.env.POLL_MS || "5000");
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || "600000");
const EXISTING_ORDER_ID = process.env.EXISTING_ORDER_ID;

// Order status enum on Diamond
const STATUS = ["PLACED", "ACCEPTED", "PAID", "COMPLETED", "CANCELLED"] as const;

const INTEGRATOR_ABI = [
  "function userPlaceOrder(bytes32 solanaRecipient, uint256 amount, bytes32 currency, uint256 circleId, string pubKey, uint256 preferredPaymentChannelConfigId, uint256 fiatAmountLimit) external returns (uint256)",
  "event CheckoutOrderCreated(uint256 indexed orderId, address indexed user, bytes32 indexed solanaRecipient, uint256 amount)",
  "event CheckoutFulfilled(uint256 indexed orderId, bytes32 indexed user, uint256 amount)",
];

const DIAMOND_ABI = [
  "function paidBuyOrder(uint256 _orderId) external",
  "function getOrdersById(uint256 orderId) external view returns (tuple(uint256 amount, uint256 fiatAmount, uint256 placedTimestamp, uint256 completedTimestamp, uint256 userCompletedTimestamp, address acceptedMerchant, address user, address recipientAddr, string pubkey, string encUpi, bool userCompleted, uint8 status, uint8 orderType, tuple(uint8 raisedBy, uint8 status, uint256 redactTransId, uint256 accountNumber) disputeInfo, uint256 id, string userPubKey, string encMerchantUpi, uint256 acceptedAccountNo, uint256[] assignedAccountNos, bytes32 currency, uint256 preferredPaymentChannelConfigId, uint256 circleId))",
];

async function waitForStatus(
  diamond: any,
  orderId: bigint,
  target: number,
  label: string
) {
  const start = Date.now();
  let lastStatus = -1;
  while (Date.now() - start < TIMEOUT_MS) {
    const order = await diamond.getOrdersById(orderId);
    const status = Number(order.status);
    if (status !== lastStatus) {
      console.log(`  [${new Date().toISOString()}] status=${STATUS[status]} (${status})`);
      lastStatus = status;
    }
    if (status === target) return order;
    if (status === 4) throw new Error(`Order cancelled while waiting for ${label}`);
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error(`Timeout waiting for ${label} after ${TIMEOUT_MS}ms`);
}

async function main() {
  if (!INTEGRATOR_ADDRESS || !DIAMOND_ADDRESS) {
    throw new Error("INTEGRATOR_ADDRESS and DIAMOND_ADDRESS required");
  }

  const [signer] = await ethers.getSigners();
  const user = await signer.getAddress();
  const currencyBytes = ethers.encodeBytes32String(CURRENCY);
  const amount = ethers.parseUnits(AMOUNT_USDC, 6);

  console.log("=== E2E Driver: TradeStars CheckoutFulfilled ===");
  console.log(`User:              ${user}`);
  console.log(`Integrator:        ${INTEGRATOR_ADDRESS}`);
  console.log(`Diamond:           ${DIAMOND_ADDRESS}`);
  console.log(`Amount:            ${AMOUNT_USDC} USDC`);
  console.log(`Currency:          ${CURRENCY}`);
  console.log(`Circle:            ${CIRCLE_ID}`);
  console.log(`Solana recipient:  ${SOLANA_RECIPIENT}`);
  console.log("");

  const integrator = new ethers.Contract(INTEGRATOR_ADDRESS, INTEGRATOR_ABI, signer);
  const diamond = new ethers.Contract(DIAMOND_ADDRESS, DIAMOND_ABI, signer);

  let orderId: bigint;
  let placementBlock: number;

  if (EXISTING_ORDER_ID) {
    orderId = BigInt(EXISTING_ORDER_ID);
    placementBlock = (await ethers.provider.getBlockNumber()) - 5000;
    console.log(`1. Using existing orderId: ${orderId}`);
    console.log("");
  } else {
    console.log("1. Placing order via userPlaceOrder...");
    const tx = await integrator.userPlaceOrder(
      SOLANA_RECIPIENT,
      amount,
      currencyBytes,
      CIRCLE_ID,
      "",
      0n,
      0n
    );
    console.log(`   tx: ${tx.hash}`);
    const receipt = await tx.wait();
    placementBlock = receipt.blockNumber;
    console.log(`   mined in block ${receipt.blockNumber}`);

    const placedLog = receipt.logs.find((l: any) => {
      try {
        const parsed = integrator.interface.parseLog(l);
        return parsed?.name === "CheckoutOrderCreated";
      } catch { return false; }
    });
    if (!placedLog) throw new Error("CheckoutOrderCreated event not found in receipt");
    orderId = integrator.interface.parseLog(placedLog)!.args.orderId;
    console.log(`   orderId: ${orderId}`);
    console.log("");
  }

  // 2. Wait for merchant acceptance
  console.log("2. Waiting for merchant to accept (Railway bot)...");
  await waitForStatus(diamond, orderId, 1, "ACCEPTED");
  console.log("");

  // 3. Mark paid
  console.log("3. Calling paidBuyOrder (user simulates fiat paid)...");
  const paidTx = await diamond.paidBuyOrder(orderId);
  console.log(`   tx: ${paidTx.hash}`);
  await paidTx.wait();
  console.log("");

  // 4. Wait for completion
  console.log("4. Waiting for merchant to complete (Railway bot)...");
  await waitForStatus(diamond, orderId, 3, "COMPLETED");
  console.log("");

  // 5. Find CheckoutFulfilled log
  console.log("5. Finding CheckoutFulfilled event on integrator...");
  const fulfilledTopic = ethers.id("CheckoutFulfilled(uint256,bytes32,uint256)");
  // Search recent blocks for our orderId. We know the order was placed earlier,
  // so search from receipt.blockNumber forward.
  const currentBlock = await ethers.provider.getBlockNumber();
  const logs = await ethers.provider.getLogs({
    address: INTEGRATOR_ADDRESS,
    topics: [
      fulfilledTopic,
      ethers.zeroPadValue(ethers.toBeHex(orderId), 32),
    ],
    fromBlock: placementBlock,
    toBlock: currentBlock,
  });
  if (logs.length === 0) throw new Error("CheckoutFulfilled log not found");
  const log = logs[0];
  const parsed = integrator.interface.parseLog(log)!;

  console.log("");
  console.log("=== CheckoutFulfilled captured ===");
  console.log(`  orderId:         ${parsed.args.orderId}`);
  console.log(`  user (Solana):   ${parsed.args.user}`);
  console.log(`  amount:          ${ethers.formatUnits(parsed.args.amount, 6)} USDC`);
  console.log("");
  console.log("=== On-chain proof ===");
  console.log(`  tx hash:         ${log.transactionHash}`);
  console.log(`  block number:    ${log.blockNumber}`);
  console.log(`  log index:       ${log.index}`);
  console.log(`  contract addr:   ${log.address}`);
  console.log(`  topics[0]:       ${log.topics[0]}`);
  console.log(`  topics[1]:       ${log.topics[1]}`);
  console.log(`  topics[2]:       ${log.topics[2]}`);
  console.log(`  data:            ${log.data}`);
  console.log(`  explorer:        https://sepolia.basescan.org/tx/${log.transactionHash}`);
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
