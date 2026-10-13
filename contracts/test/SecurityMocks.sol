// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// Test-only helpers for test/security.audit.test.js. Never deployed.

interface ILinkCash {
    function create(address claimKey, uint64 expiry, uint256 gasAllowance) external payable;
    function claim(address recipient) external;
    function claimWithSig(address claimKey, address recipient, bytes calldata sig) external;
    function refund(address claimKey) external;
}

/// Acts as a sender, a claim key or a recipient, and tries to re-enter
/// LinkCash once from its receive hook.
contract ReentrantActor {
    ILinkCash public immutable lc;
    uint8 public mode; // 0 none, 1 claim(), 2 refund(key), 3 claimWithSig(key, this, sig)
    address public targetKey;
    bytes public sig;
    bool public reentryReverted;
    uint256 public receivedCount;
    uint256 public receivedTotal;

    constructor(ILinkCash _lc) {
        lc = _lc;
    }

    function setup(uint8 m, address key, bytes calldata s) external {
        mode = m;
        targetKey = key;
        sig = s;
    }

    function createLink(address key, uint64 expiry) external payable {
        lc.create{value: msg.value}(key, expiry, 0);
    }

    function doRefund(address key) external {
        lc.refund(key);
    }

    function doClaim(address recipient) external {
        lc.claim(recipient);
    }

    receive() external payable {
        receivedCount += 1;
        receivedTotal += msg.value;
        uint8 m = mode;
        if (m == 0) return;
        mode = 0;
        if (m == 1) {
            try lc.claim(address(this)) {} catch { reentryReverted = true; }
        } else if (m == 2) {
            try lc.refund(targetKey) {} catch { reentryReverted = true; }
        } else if (m == 3) {
            try lc.claimWithSig(targetKey, address(this), sig) {} catch { reentryReverted = true; }
        }
    }
}

/// A recipient or sender that can't accept native USDC.
contract RejectingReceiver {
    ILinkCash public immutable lc;

    constructor(ILinkCash _lc) {
        lc = _lc;
    }

    function createLink(address key, uint64 expiry) external payable {
        lc.create{value: msg.value}(key, expiry, 0);
    }

    function doRefund(address key) external {
        lc.refund(key);
    }

    receive() external payable {
        revert("rejects payments");
    }
}

/// Pushes value into a contract without calling it (selfdestruct still
/// transfers the balance after Cancun).
contract ForceSender {
    constructor() payable {}

    function boom(address payable to) external {
        selfdestruct(to);
    }
}
