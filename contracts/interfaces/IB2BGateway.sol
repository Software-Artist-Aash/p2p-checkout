// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IB2BGateway
 * @notice Interface for the B2BGatewayFacet on the P2P Diamond.
 */
interface IB2BGateway {
    function placeB2BOrder(
        address user,
        uint256 amount,
        bytes32 currency,
        address recipientAddr,
        string calldata pubKey,
        uint256 circleId,
        uint256 preferredPaymentChannelConfigId,
        uint256 fiatAmountLimit
    ) external returns (uint256 orderId);
}
