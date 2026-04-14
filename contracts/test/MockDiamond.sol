// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IP2PIntegrator } from "../interfaces/IP2PIntegrator.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title MockDiamond
 * @notice Simulates the P2P Diamond's B2BGatewayFacet for testing the integrator + client.
 *         Handles order placement, completion callbacks, and clawback.
 */
contract MockDiamond {
    using SafeERC20 for IERC20;

    IERC20 public usdc;
    uint256 public nextOrderId = 1;

    struct Order {
        address integrator;
        address user;
        uint256 amount;
        bytes32 currency;
        address recipientAddr;
        bool completed;
    }

    mapping(address => bool) public activeIntegrators;
    mapping(uint256 => Order) public orders;

    event MockOrderPlaced(uint256 orderId, address integrator, address user, uint256 amount);
    event MockOrderCompleted(uint256 orderId);

    constructor(address _usdc) {
        usdc = IERC20(_usdc);
    }

    function registerIntegrator(address integrator) external {
        activeIntegrators[integrator] = true;
    }

    /**
     * @notice Simulates B2BGatewayFacet.placeB2BOrder
     */
    function placeB2BOrder(
        address user,
        uint256 amount,
        bytes32 currency,
        address recipientAddr,
        string calldata /* pubKey */,
        uint256 /* circleId */,
        uint256 /* preferredPaymentChannelConfigId */,
        uint256 /* fiatAmountLimit */
    ) external returns (uint256 orderId) {
        require(activeIntegrators[msg.sender], "Not active integrator");

        // Call integrator.validateOrder
        bool allowed = IP2PIntegrator(msg.sender).validateOrder(user, amount, currency);
        require(allowed, "Validation failed");

        orderId = nextOrderId++;
        orders[orderId] = Order({
            integrator: msg.sender,
            user: user,
            amount: amount,
            currency: currency,
            recipientAddr: recipientAddr,
            completed: false
        });

        emit MockOrderPlaced(orderId, msg.sender, user, amount);
    }

    /**
     * @notice Simulates order completion: transfers USDC to integrator and calls onOrderComplete.
     *         In the real Diamond, this happens inside completeOrder → onB2BOrderComplete.
     *         Caller must fund this contract with USDC first.
     */
    function simulateOrderComplete(uint256 orderId) external {
        Order storage order = orders[orderId];
        require(!order.completed, "Already completed");
        order.completed = true;

        // Transfer USDC to integrator (simulates the Diamond routing USDC)
        usdc.safeTransfer(order.recipientAddr, order.amount);

        // Call integrator callback
        IP2PIntegrator(order.integrator).onOrderComplete(
            orderId,
            order.user,
            order.amount,
            order.recipientAddr
        );

        emit MockOrderCompleted(orderId);
    }

    /**
     * @notice Simulates clawback
     */
    function simulateClawback(uint256 orderId, uint256 amount) external {
        Order storage order = orders[orderId];
        require(order.completed, "Not completed");

        uint256 balanceBefore = usdc.balanceOf(address(this));
        IP2PIntegrator(order.integrator).onClawback(orderId, amount);
        uint256 received = usdc.balanceOf(address(this)) - balanceBefore;

        // In real Diamond: track debt if shortfall, make merchant whole
        require(received <= amount, "Over-returned");
    }
}
