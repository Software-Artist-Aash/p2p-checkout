// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IP2PIntegrator } from "./interfaces/IP2PIntegrator.sol";
import { IB2BGateway } from "./interfaces/IB2BGateway.sol";
import { ICheckoutClient } from "./interfaces/ICheckoutClient.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title CheckoutIntegratorV2
 * @notice Non-upgradeable integrator with RP-based per-tx limits, daily count limits,
 *         and quantity-based product purchases.
 *
 *   1. PER-TRANSACTION USDC LIMIT (RP-based, per-currency):
 *        - 0 RP → baseTxLimit (default 50 USDC)
 *        - RP > 0 → userRP * rpToUsdc[currency]
 *        - Capped at maxTxLimit[currency]
 *
 *   2. DAILY TRANSACTION COUNT LIMIT:
 *        - Global dailyTxCountLimit max orders per user per day
 *
 *   3. QUANTITY SUPPORT:
 *        - userPlaceOrder accepts quantity; total = unitPrice * quantity
 *        - Client mints `quantity` NFTs on fulfillment
 */
contract CheckoutIntegratorV2 is IP2PIntegrator {
    using SafeERC20 for IERC20;

    // ─── Errors ───────────────────────────────────────────────────────

    error OnlyDiamond();
    error OnlyOwner();
    error ClientNotRegistered();
    error ProductNotFound();
    error OrderAlreadyFulfilled();
    error InvalidAddress();
    error InvalidQuantity();
    error ArrayLengthMismatch();

    // ─── Events ───────────────────────────────────────────────────────

    event CheckoutOrderCreated(
        uint256 indexed orderId,
        address indexed user,
        address indexed client,
        uint256 productId,
        uint256 quantity,
        uint256 totalUsdcAmount
    );
    event CheckoutFulfilled(
        uint256 indexed orderId,
        address indexed user,
        address indexed client,
        uint256 productId,
        uint256 quantity
    );
    event ClientRegistered(address indexed client);
    event ClientRemoved(address indexed client);

    event UserRPUpdated(address indexed user, uint256 rp);
    event RpRateUpdated(bytes32 indexed currency, uint256 usdcPerRp);
    event BaseTxLimitUpdated(uint256 limit);
    event MaxTxLimitUpdated(bytes32 indexed currency, uint256 cap);
    event DailyTxCountLimitUpdated(uint256 count);

    // ─── Immutables ───────────────────────────────────────────────────

    address public immutable diamond;
    IERC20 public immutable usdc;
    address public immutable owner;

    // ─── Configurable Limits ──────────────────────────────────────────

    uint256 public baseTxLimit;
    uint256 public dailyTxCountLimit;
    mapping(bytes32 => uint256) public rpToUsdc;
    mapping(bytes32 => uint256) public maxTxLimit;
    mapping(address => uint256) public userRP;

    // ─── State ────────────────────────────────────────────────────────

    struct ClientConfig {
        bool isRegistered;
    }

    struct CheckoutSession {
        address user;
        address client;
        uint256 productId;
        uint256 quantity;
        uint256 usdcAmount;
        bool fulfilled;
    }

    mapping(address => ClientConfig) public clients;
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
        usdc = IERC20(_usdc);
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

    // ─── Admin: Clients ───────────────────────────────────────────────

    function registerClient(address client) external onlyOwner {
        if (client == address(0)) revert InvalidAddress();
        clients[client].isRegistered = true;
        emit ClientRegistered(client);
    }

    function removeClient(address client) external onlyOwner {
        clients[client].isRegistered = false;
        emit ClientRemoved(client);
    }

    // ─── User-Facing Order Placement ──────────────────────────────────

    /**
     * @notice End-user places a checkout order for `quantity` units of a product.
     *         Total cost = unitPrice × quantity.
     */
    function userPlaceOrder(
        address client,
        uint256 productId,
        uint256 quantity,
        bytes32 currency,
        uint256 circleId,
        string calldata pubKey,
        uint256 preferredPaymentChannelConfigId,
        uint256 fiatAmountLimit
    ) external returns (uint256 orderId) {
        if (!clients[client].isRegistered) revert ClientNotRegistered();
        if (quantity == 0) revert InvalidQuantity();

        uint256 unitPrice = ICheckoutClient(client).getProductPrice(productId);
        if (unitPrice == 0) revert ProductNotFound();

        uint256 totalPrice = unitPrice * quantity;

        orderId = IB2BGateway(diamond).placeB2BOrder(
            msg.sender,
            totalPrice,
            currency,
            address(this),
            pubKey,
            circleId,
            preferredPaymentChannelConfigId,
            fiatAmountLimit
        );

        sessions[orderId] = CheckoutSession({
            user: msg.sender,
            client: client,
            productId: productId,
            quantity: quantity,
            usdcAmount: totalPrice,
            fulfilled: false
        });

        emit CheckoutOrderCreated(orderId, msg.sender, client, productId, quantity, totalPrice);
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
        uint256 amount,
        address /* recipientAddr */
    ) external onlyDiamond {
        CheckoutSession storage session = sessions[orderId];
        if (session.fulfilled) revert OrderAlreadyFulfilled();

        session.fulfilled = true;

        usdc.safeTransfer(session.client, amount);
        ICheckoutClient(session.client).onCheckoutPayment(
            session.user,
            amount,
            session.productId,
            session.quantity
        );

        emit CheckoutFulfilled(orderId, session.user, session.client, session.productId, session.quantity);
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
