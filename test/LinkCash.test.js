const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const ONE_DAY = 24 * 60 * 60;
const GAS = ethers.parseEther("0.005");

describe("LinkCash", function () {
  let linkCash, sender, recipient, relayer, claimKey;

  beforeEach(async function () {
    [sender, recipient, relayer] = await ethers.getSigners();
    linkCash = await (await ethers.getContractFactory("LinkCash")).deploy();
    claimKey = ethers.Wallet.createRandom().connect(ethers.provider);
  });

  async function createLink(amount = ethers.parseEther("10"), gas = GAS) {
    const expiry = (await time.latest()) + 7 * ONE_DAY;
    await linkCash.connect(sender).create(claimKey.address, expiry, gas, { value: amount + gas });
    return { amount, expiry };
  }

  it("locks funds and forwards the gas allowance to the claim key", async function () {
    const { amount, expiry } = await createLink();
    const link = await linkCash.links(claimKey.address);
    expect(link.sender).to.equal(sender.address);
    expect(link.amount).to.equal(amount);
    expect(link.expiry).to.equal(expiry);
    expect(await ethers.provider.getBalance(claimKey.address)).to.equal(GAS);
    expect(await ethers.provider.getBalance(linkCash.target)).to.equal(amount);
  });

  it("lets the claim key pay for its own claim to a fresh recipient", async function () {
    const { amount } = await createLink();
    const fresh = ethers.Wallet.createRandom();
    await expect(linkCash.connect(claimKey).claim(fresh.address))
      .to.emit(linkCash, "LinkClaimed")
      .withArgs(claimKey.address, fresh.address, amount);
    expect(await ethers.provider.getBalance(fresh.address)).to.equal(amount);
  });

  it("rejects double claims", async function () {
    await createLink();
    await linkCash.connect(claimKey).claim(recipient.address);
    await expect(linkCash.connect(claimKey).claim(recipient.address)).to.be.revertedWithCustomError(linkCash, "AlreadySettled");
  });

  it("supports relayed claims bound to the signed recipient", async function () {
    const { amount } = await createLink(ethers.parseEther("5"), 0n);
    const inner = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "address", "address", "address"],
        [31337, linkCash.target, claimKey.address, recipient.address],
      ),
    );
    const sig = await claimKey.signMessage(ethers.getBytes(inner));

    await expect(linkCash.connect(relayer).claimWithSig(claimKey.address, relayer.address, sig))
      .to.be.revertedWithCustomError(linkCash, "BadSignature");
    await expect(linkCash.connect(relayer).claimWithSig(claimKey.address, recipient.address, sig))
      .to.changeEtherBalance(recipient, amount);
  });

  it("refunds the sender only after expiry", async function () {
    const { amount, expiry } = await createLink();
    await expect(linkCash.connect(sender).refund(claimKey.address)).to.be.revertedWithCustomError(linkCash, "NotExpired");
    await time.increaseTo(expiry);
    await expect(linkCash.connect(recipient).refund(claimKey.address)).to.be.revertedWithCustomError(linkCash, "NotSender");
    await expect(linkCash.connect(sender).refund(claimKey.address)).to.changeEtherBalance(sender, amount, { includeFee: false });
    await expect(linkCash.connect(claimKey).claim(recipient.address)).to.be.revertedWithCustomError(linkCash, "AlreadySettled");
  });

  it("still allows a late claim if the sender has not refunded", async function () {
    const { amount, expiry } = await createLink();
    await time.increaseTo(expiry + ONE_DAY);
    await expect(linkCash.connect(claimKey).claim(recipient.address)).to.changeEtherBalance(recipient, amount);
  });

  it("validates inputs", async function () {
    const expiry = (await time.latest()) + ONE_DAY;
    await expect(linkCash.create(claimKey.address, expiry, GAS, { value: GAS })).to.be.revertedWithCustomError(linkCash, "InvalidAmount");
    await expect(linkCash.create(claimKey.address, expiry, ethers.parseEther("1"), { value: ethers.parseEther("2") }))
      .to.be.revertedWithCustomError(linkCash, "InvalidAmount");
    await expect(linkCash.create(claimKey.address, 1, 0, { value: 1 })).to.be.revertedWithCustomError(linkCash, "InvalidExpiry");
    await expect(linkCash.create(ethers.ZeroAddress, expiry, 0, { value: 1 })).to.be.revertedWithCustomError(linkCash, "InvalidRecipient");
    await linkCash.create(claimKey.address, expiry, 0, { value: 1 });
    await expect(linkCash.create(claimKey.address, expiry, 0, { value: 1 })).to.be.revertedWithCustomError(linkCash, "LinkExists");
    await expect(linkCash.connect(relayer).claim(recipient.address)).to.be.revertedWithCustomError(linkCash, "LinkNotFound");
  });
});
