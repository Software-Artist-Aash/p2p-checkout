// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IP2PIntegrator
 * @notice Interface that every B2B integrator contract must implement.
 *         The protocol calls these functions during the order lifecycle.
 */
interface IP2PIntegrator {
    function validateOrder(
        address user,
        uint256 amount,
        bytes32 currency
    ) external returns (bool allowed);

    function onOrderComplete(
        uint256 orderId,
        address user,
        uint256 amount,
        address recipientAddr
    ) external;

    function onClawback(
        uint256 orderId,
        uint256 amount
    ) external;
}
