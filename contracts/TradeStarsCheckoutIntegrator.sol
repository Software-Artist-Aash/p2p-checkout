// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IP2PIntegrator } from "./interfaces/IP2PIntegrator.sol";
import { IB2BGateway } from "./interfaces/IB2BGateway.sol";

/**
 * @title TradeStarsCheckoutIntegrator
 * @notice Integrator for the TradeStars checkout flow.
 *
 *         - Accepts fiat → USDC orders through the P2P Diamond
 *         - Carries a Solana recipient pubkey (32 bytes) through the session
 *         - On fulfillment, emits a minimal CheckoutFulfilled event that an
 *           off-chain relayer (e.g., an Alchemy webhook) picks up to trigger
 *           the Solana-side mint
 *         - USDC received on completion is held by this contract; transfer
 *           to the escrow account is intentionally left as a TODO and is not
 *           implemented in this version
 *
 *   Limits (shared with CheckoutIntegratorV2):
 *     - Per-tx USDC: 0 RP → baseTxLimit; RP > 0 → userRP * rpToUsdc[currency];
 *       capped at maxTxLimit[currency]
 *     - Daily count: dailyTxCountLimit orders per user per UTC day
 */
contract TradeStarsCheckoutIntegrator is IP2PIntegrator {
    // ─── Errors ───────────────────────────────────────────────────────

    error OnlyDiamond();
    error OnlyOwner();
    error OrderAlreadyFulfilled();
    error InvalidAddress();
    error InvalidAmount();
    error InvalidSolanaRecipient();
    error ArrayLengthMismatch();

    // ─── Events ───────────────────────────────────────────────────────

    event CheckoutOrderCreated(
        uint256 indexed orderId,
        address indexed user,
        bytes32 indexed solanaRecipient,
        uint256 amount
    );

    /// @notice Emitted when an order is fulfilled on Base. `user` is a Solana
    ///         pubkey (32 bytes) — the relayer uses this as the mint recipient.
    event CheckoutFulfilled(
        uint256 indexed orderId,
        bytes32 indexed user,
        uint256 amount
    );

    event UserRPUpdated(address indexed user, uint256 rp);
    event RpRateUpdated(bytes32 indexed currency, uint256 usdcPerRp);
    event BaseTxLimitUpdated(uint256 limit);
    event MaxTxLimitUpdated(bytes32 indexed currency, uint256 cap);
    event DailyTxCountLimitUpdated(uint256 count);

    // ─── Immutables ───────────────────────────────────────────────────

    address public immutable diamond;
    address public immutable usdc;
    address public immutable owner;

    // ─── Configurable Limits ──────────────────────────────────────────

    uint256 public baseTxLimit;
    uint256 public dailyTxCountLimit;
    mapping(bytes32 => uint256) public rpToUsdc;
    mapping(bytes32 => uint256) public maxTxLimit;
    mapping(address => uint256) public userRP;

    // ─── State ────────────────────────────────────────────────────────

    struct CheckoutSession {
        address user;
        bytes32 solanaRecipient;
        uint256 usdcAmount;
        bool fulfilled;
    }

    mapping(uint256 => CheckoutSession) public sessions;
    mapping(address => mapping(uint256 => uint256)) public userDailyCount;

    // ─── Modifiers ────────────────────────────────────────────────────

    modifier onlyDiamond() {
        if (msg.sender != diamond) revert OnlyDiamond();
        _;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    // ─── Constructor ──────────────────────────────────────────────────

    constructor(
        address _diamond,
        address _usdc,
        uint256 _baseTxLimit,
        uint256 _dailyTxCountLimit
    ) {
        if (_diamond == address(0) || _usdc == address(0)) revert InvalidAddress();
        diamond = _diamond;
        usdc = _usdc;
        owner = msg.sender;
        baseTxLimit = _baseTxLimit;
        dailyTxCountLimit = _dailyTxCountLimit;
    }

    // ─── Admin: Limits ────────────────────────────────────────────────

    function setBaseTxLimit(uint256 limit) external onlyOwner {
        baseTxLimit = limit;
        emit BaseTxLimitUpdated(limit);
    }

    function setDailyTxCountLimit(uint256 count) external onlyOwner {
        dailyTxCountLimit = count;
        emit DailyTxCountLimitUpdated(count);
    }

    function setRpToUsdc(bytes32 currency, uint256 usdcPerRp) external onlyOwner {
        rpToUsdc[currency] = usdcPerRp;
        emit RpRateUpdated(currency, usdcPerRp);
    }

    function setMaxTxLimit(bytes32 currency, uint256 cap) external onlyOwner {
        maxTxLimit[currency] = cap;
        emit MaxTxLimitUpdated(currency, cap);
    }

    // ─── Admin: User RP ───────────────────────────────────────────────

    function setUserRP(address user, uint256 rp) external onlyOwner {
        userRP[user] = rp;
        emit UserRPUpdated(user, rp);
    }

    function batchSetUserRP(
        address[] calldata users,
        uint256[] calldata rps
    ) external onlyOwner {
        if (users.length != rps.length) revert ArrayLengthMismatch();
        for (uint256 i = 0; i < users.length; i++) {
            userRP[users[i]] = rps[i];
            emit UserRPUpdated(users[i], rps[i]);
        }
    }

    // ─── User-Facing Order Placement ──────────────────────────────────

    /**
     * @notice End-user places a USDC checkout order to be minted on Solana.
     * @param solanaRecipient Solana pubkey (32 bytes) to receive the Solana-side mint
     * @param amount USDC amount (6 decimals)
     */
    function userPlaceOrder(
        bytes32 solanaRecipient,
        uint256 amount,
        bytes32 currency,
        uint256 circleId,
        string calldata pubKey,
        uint256 preferredPaymentChannelConfigId,
        uint256 fiatAmountLimit
    ) external returns (uint256 orderId) {
        if (solanaRecipient == bytes32(0)) revert InvalidSolanaRecipient();
        if (amount == 0) revert InvalidAmount();

        orderId = IB2BGateway(diamond).placeB2BOrder(
            msg.sender,
            amount,
            currency,
            address(this),
            pubKey,
            circleId,
            preferredPaymentChannelConfigId,
            fiatAmountLimit
        );

        sessions[orderId] = CheckoutSession({
            user: msg.sender,
            solanaRecipient: solanaRecipient,
            usdcAmount: amount,
            fulfilled: false
        });

        emit CheckoutOrderCreated(orderId, msg.sender, solanaRecipient, amount);
    }

    // ─── IP2PIntegrator Callbacks ─────────────────────────────────────

    function validateOrder(
        address user,
        uint256 amount,
        bytes32 currency
    ) external onlyDiamond returns (bool allowed) {
        uint256 txLimit = getUserTxLimit(user, currency);
        if (amount > txLimit) return false;

        uint256 dayIndex = block.timestamp / 1 days;
        uint256 count = userDailyCount[user][dayIndex];
        if (count + 1 > dailyTxCountLimit) return false;

        userDailyCount[user][dayIndex] = count + 1;
        return true;
    }

    function onOrderComplete(
        uint256 orderId,
        address /* user */,
        uint256 /* amount */,
        address /* recipientAddr */
    ) external onlyDiamond {
        CheckoutSession storage session = sessions[orderId];
        if (session.fulfilled) revert OrderAlreadyFulfilled();

        session.fulfilled = true;

        // TODO: transfer session.usdcAmount USDC to the escrow account once
        // that address is configured. Until then the Diamond pushes USDC to
        // this contract and it sits here. The off-chain relayer uses the
        // event below to drive the Solana-side mint.

        emit CheckoutFulfilled(orderId, session.solanaRecipient, session.usdcAmount);
    }

    // ─── View Functions ───────────────────────────────────────────────

    function getUserTxLimit(
        address user,
        bytes32 currency
    ) public view returns (uint256) {
        uint256 rp = userRP[user];
        if (rp == 0) return baseTxLimit;

        uint256 rate = rpToUsdc[currency];
        if (rate == 0) rate = 1e6;
        uint256 limit = rp * rate;

        uint256 cap = maxTxLimit[currency];
        if (cap > 0 && limit > cap) return cap;
        return limit;
    }

    function getRemainingDailyCount(address user) external view returns (uint256) {
        uint256 dayIndex = block.timestamp / 1 days;
        uint256 count = userDailyCount[user][dayIndex];
        if (count >= dailyTxCountLimit) return 0;
        return dailyTxCountLimit - count;
    }

    function getTodayCount(address user) external view returns (uint256) {
        return userDailyCount[user][block.timestamp / 1 days];
    }

    function getSession(uint256 orderId) external view returns (CheckoutSession memory) {
        return sessions[orderId];
    }
}
