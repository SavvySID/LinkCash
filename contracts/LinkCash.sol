// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title LinkCash - send USDC to anyone with a link
/// @notice On Arc, USDC is the native gas token. A sender locks USDC behind a
///         one-time "claim key" (a fresh keypair generated in the browser). The
///         private half travels inside the link's URL fragment and never touches
///         a server. Whoever holds the link can move the funds to any address;
///         if nobody claims before expiry, the sender takes the funds back.
///
///         To let recipients claim with zero balance, the sender can forward a
///         tiny gas allowance to the claim key, which then pays for its own
///         claim transaction. Claims can also be relayed by anyone using a
///         signature from the claim key.
contract LinkCash {
    struct Link {
        address sender;
        uint64 expiry;
        bool settled;
        uint256 amount;
    }

    /// @dev Upper bound on the gas allowance forwarded to a claim key (0.1 USDC).
    uint256 public constant MAX_GAS_ALLOWANCE = 0.1 ether;

    mapping(address claimKey => Link) public links;

    event LinkCreated(address indexed claimKey, address indexed sender, uint256 amount, uint64 expiry);
    event LinkClaimed(address indexed claimKey, address indexed recipient, uint256 amount);
    event LinkRefunded(address indexed claimKey, address indexed sender, uint256 amount);

    error LinkExists();
    error LinkNotFound();
    error AlreadySettled();
    error NotExpired();
    error NotSender();
    error InvalidAmount();
    error InvalidExpiry();
    error InvalidRecipient();
    error BadSignature();
    error TransferFailed();

    /// @notice Lock msg.value - gasAllowance behind `claimKey`, forwarding
    ///         `gasAllowance` to the claim key so it can pay for its own claim.
    function create(address claimKey, uint64 expiry, uint256 gasAllowance) external payable {
        if (claimKey == address(0)) revert InvalidRecipient();
        if (links[claimKey].sender != address(0)) revert LinkExists();
        if (expiry <= block.timestamp) revert InvalidExpiry();
        if (gasAllowance > MAX_GAS_ALLOWANCE || msg.value <= gasAllowance) revert InvalidAmount();

        uint256 amount = msg.value - gasAllowance;
        links[claimKey] = Link({sender: msg.sender, expiry: expiry, settled: false, amount: amount});
        emit LinkCreated(claimKey, msg.sender, amount, expiry);

        if (gasAllowance > 0) _send(claimKey, gasAllowance);
    }

    /// @notice Claim by sending a transaction from the claim key itself.
    function claim(address recipient) external {
        _claim(msg.sender, recipient);
    }

    /// @notice Claim on behalf of a claim key, e.g. from a relayer or a recipient
    ///         who already has gas. The signature binds the recipient, so a
    ///         relayer cannot redirect funds.
    function claimWithSig(address claimKey, address recipient, bytes calldata sig) external {
        if (_recover(claimDigest(claimKey, recipient), sig) != claimKey) revert BadSignature();
        _claim(claimKey, recipient);
    }

    /// @notice Return unclaimed funds to the sender after expiry.
    function refund(address claimKey) external {
        Link storage link = links[claimKey];
        if (link.sender == address(0)) revert LinkNotFound();
        if (link.settled) revert AlreadySettled();
        if (msg.sender != link.sender) revert NotSender();
        if (block.timestamp < link.expiry) revert NotExpired();

        link.settled = true;
        emit LinkRefunded(claimKey, link.sender, link.amount);
        _send(link.sender, link.amount);
    }

    /// @notice EIP-191 digest the claim key signs to authorise a relayed claim.
    function claimDigest(address claimKey, address recipient) public view returns (bytes32) {
        bytes32 inner = keccak256(abi.encode(block.chainid, address(this), claimKey, recipient));
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", inner));
    }

    /// @dev Claims stay valid after expiry until the sender actually refunds,
    ///      so a late recipient still gets paid.
    function _claim(address claimKey, address recipient) internal {
        Link storage link = links[claimKey];
        if (link.sender == address(0)) revert LinkNotFound();
        if (link.settled) revert AlreadySettled();
        if (recipient == address(0)) revert InvalidRecipient();

        link.settled = true;
        emit LinkClaimed(claimKey, recipient, link.amount);
        _send(recipient, link.amount);
    }

    function _send(address to, uint256 value) internal {
        (bool ok,) = to.call{value: value}("");
        if (!ok) revert TransferFailed();
    }

    function _recover(bytes32 digest, bytes calldata sig) internal pure returns (address signer) {
        if (sig.length != 65) revert BadSignature();
        bytes32 r = bytes32(sig[0:32]);
        bytes32 s = bytes32(sig[32:64]);
        uint8 v = uint8(sig[64]);
        // Reject malleable high-s signatures.
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) revert BadSignature();
        signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert BadSignature();
    }
}
