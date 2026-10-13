// Security audit tests for LinkCash (local Hardhat network only).
// Covers authorization, signature/replay, reentrancy, state races, boundary
// values, and a seeded random-operation invariant fuzzer.
//   npx hardhat test test/security.audit.test.js
//   FUZZ_SEEDS=1,2,3 FUZZ_OPS=400 npx hardhat test test/security.audit.test.js
const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const { time, setBalance } = require("@nomicfoundation/hardhat-network-helpers");

const DAY = 86400;
const MAX_ALLOWANCE = ethers.parseEther("0.1");
const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const coder = ethers.AbiCoder.defaultAbiCoder();

const innerDigest = (chainId, contract, claimKey, recipient) =>
  ethers.keccak256(coder.encode(["uint256", "address", "address", "address"], [chainId, contract, claimKey, recipient]));
const sign = (wallet, chainId, contract, claimKey, recipient) => wallet.signMessage(ethers.getBytes(innerDigest(chainId, contract, claimKey, recipient)));

function splitSig(sig) {
  const b = ethers.getBytes(sig);
  return { r: ethers.hexlify(b.slice(0, 32)), s: BigInt(ethers.hexlify(b.slice(32, 64))), v: b[64] };
}
const joinSig = (r, s, v) => ethers.concat([r, ethers.toBeHex(s, 32), ethers.toBeHex(v, 1)]);

async function deploy() {
  return (await ethers.getContractFactory("LinkCash")).deploy();
}

describe("Security audit: LinkCash", function () {
  let lc, signers, sender, recipient, relayer, attacker, chainId;

  beforeEach(async function () {
    signers = await ethers.getSigners();
    [sender, recipient, relayer, attacker] = signers;
    lc = await deploy();
    chainId = (await ethers.provider.getNetwork()).chainId;
  });

  async function newLink({ amount = ethers.parseEther("10"), allowance = ethers.parseEther("0.005"), days = 7, from = sender, key } = {}) {
    key = key || ethers.Wallet.createRandom().connect(ethers.provider);
    const expiry = (await time.latest()) + days * DAY;
    await lc.connect(from).create(key.address, expiry, allowance, { value: amount + allowance });
    return { key, amount, allowance, expiry };
  }

  describe("Authorization and fund safety", function () {
    it("an account that is not the claim key cannot claim (no link under its address)", async function () {
      await newLink();
      await expect(lc.connect(attacker).claim(attacker.address)).to.be.revertedWithCustomError(lc, "LinkNotFound");
    });

    it("an attacker cannot claim with their own signature, or with the claim key's signature for another recipient", async function () {
      const { key } = await newLink();
      const fake = ethers.Wallet.createRandom();
      const forged = await sign(fake, chainId, lc.target, key.address, attacker.address);
      await expect(lc.connect(attacker).claimWithSig(key.address, attacker.address, forged)).to.be.revertedWithCustomError(lc, "BadSignature");
      const genuine = await sign(key, chainId, lc.target, key.address, recipient.address);
      await expect(lc.connect(attacker).claimWithSig(key.address, attacker.address, genuine)).to.be.revertedWithCustomError(lc, "BadSignature");
    });

    it("refund is limited to the stored sender, only after expiry, and pays the stored sender", async function () {
      const { key, amount, expiry } = await newLink();
      await expect(lc.connect(attacker).refund(key.address)).to.be.revertedWithCustomError(lc, "NotSender");
      await expect(lc.connect(sender).refund(key.address)).to.be.revertedWithCustomError(lc, "NotExpired");
      await time.increaseTo(expiry);
      await expect(lc.connect(attacker).refund(key.address)).to.be.revertedWithCustomError(lc, "NotSender");
      const tx = lc.connect(sender).refund(key.address);
      await expect(tx).to.changeEtherBalances([sender, lc], [amount, -amount], { includeFee: false });
      await expect(tx).to.emit(lc, "LinkRefunded").withArgs(key.address, sender.address, amount);
    });

    it("refund of an unknown link reverts", async function () {
      await expect(lc.refund(ethers.Wallet.createRandom().address)).to.be.revertedWithCustomError(lc, "LinkNotFound");
    });

    it("the contract has no admin, owner, pause, upgrade or sweep functions", async function () {
      const fns = lc.interface.fragments.filter((f) => f.type === "function").map((f) => f.name).sort();
      expect(fns).to.deep.equal(["MAX_GAS_ALLOWANCE", "claim", "claimDigest", "claimWithSig", "create", "links", "refund"]);
    });

    it("plain transfers to the contract are rejected (no receive/fallback)", async function () {
      await expect(sender.sendTransaction({ to: lc.target, value: 1n })).to.be.reverted;
    });

    it("the amount locked is exactly msg.value minus the allowance, and the allowance goes only to the claim key", async function () {
      const key = ethers.Wallet.createRandom();
      const amount = ethers.parseEther("3.25");
      const allowance = ethers.parseEther("0.005");
      const expiry = (await time.latest()) + DAY;
      const tx = lc.create(key.address, expiry, allowance, { value: amount + allowance });
      await expect(tx).to.changeEtherBalances([lc, key.address], [amount, allowance]);
      await expect(tx).to.emit(lc, "LinkCreated").withArgs(key.address, sender.address, amount, expiry);
      expect((await lc.links(key.address)).amount).to.equal(amount);
    });

    it("the allowance cap is enforced at exactly 0.1 USDC", async function () {
      const expiry = (await time.latest()) + DAY;
      await expect(lc.create(ethers.Wallet.createRandom().address, expiry, MAX_ALLOWANCE, { value: MAX_ALLOWANCE + 1n })).to.not.be.reverted;
      await expect(lc.create(ethers.Wallet.createRandom().address, expiry, MAX_ALLOWANCE + 1n, { value: MAX_ALLOWANCE + 2n }))
        .to.be.revertedWithCustomError(lc, "InvalidAmount");
    });

    it("zero and allowance-only deposits are rejected; 1 wei is the contract minimum", async function () {
      const expiry = (await time.latest()) + DAY;
      await expect(lc.create(ethers.Wallet.createRandom().address, expiry, 0, { value: 0 })).to.be.revertedWithCustomError(lc, "InvalidAmount");
      await expect(lc.create(ethers.Wallet.createRandom().address, expiry, 5n, { value: 5n })).to.be.revertedWithCustomError(lc, "InvalidAmount");
      await expect(lc.create(ethers.Wallet.createRandom().address, expiry, 0, { value: 1n })).to.not.be.reverted;
    });

    it("very large amounts lock and claim without overflow", async function () {
      const huge = 2n ** 200n;
      await setBalance(sender.address, huge * 2n);
      const { key } = await newLink({ amount: huge, allowance: 0n });
      await setBalance(key.address, ethers.parseEther("1"));
      const to = ethers.Wallet.createRandom().address;
      await expect(lc.connect(key).claim(to)).to.changeEtherBalance(to, huge);
    });

    it("expiry bounds: now is rejected, now+1 and uint64 max are accepted", async function () {
      const now = await time.latest();
      await time.setNextBlockTimestamp(now + 10);
      await expect(lc.create(ethers.Wallet.createRandom().address, now + 10, 0, { value: 1n })).to.be.revertedWithCustomError(lc, "InvalidExpiry");
      await expect(lc.create(ethers.Wallet.createRandom().address, (await time.latest()) + 2, 0, { value: 1n })).to.not.be.reverted;
      await expect(lc.create(ethers.Wallet.createRandom().address, 2n ** 64n - 1n, 0, { value: 1n })).to.not.be.reverted;
    });
  });

  describe("Signatures and replay", function () {
    it("claimDigest equals the EIP-191 hash of abi.encode(chainId, contract, claimKey, recipient) used by the frontend", async function () {
      const key = ethers.Wallet.createRandom();
      const onChain = await lc.claimDigest(key.address, recipient.address);
      expect(onChain).to.equal(ethers.hashMessage(ethers.getBytes(innerDigest(chainId, lc.target, key.address, recipient.address))));
    });

    it("a signature for the wrong chain ID is rejected", async function () {
      const { key } = await newLink();
      const sig = await sign(key, 5042n, lc.target, key.address, recipient.address);
      await expect(lc.connect(relayer).claimWithSig(key.address, recipient.address, sig)).to.be.revertedWithCustomError(lc, "BadSignature");
    });

    it("a signature for another LinkCash deployment is rejected (cross-contract replay)", async function () {
      const other = await deploy();
      const key = ethers.Wallet.createRandom().connect(ethers.provider);
      const expiry = (await time.latest()) + DAY;
      await lc.create(key.address, expiry, 0, { value: ethers.parseEther("1") });
      await other.create(key.address, expiry, 0, { value: ethers.parseEther("1") });
      const sigForOther = await sign(key, chainId, other.target, key.address, recipient.address);
      await expect(lc.connect(relayer).claimWithSig(key.address, recipient.address, sigForOther)).to.be.revertedWithCustomError(lc, "BadSignature");
      await expect(other.connect(relayer).claimWithSig(key.address, recipient.address, sigForOther)).to.not.be.reverted;
    });

    it("a signature for one link cannot claim a different link", async function () {
      const a = await newLink();
      const b = await newLink();
      const sigA = await sign(a.key, chainId, lc.target, a.key.address, recipient.address);
      await expect(lc.connect(relayer).claimWithSig(b.key.address, recipient.address, sigA)).to.be.revertedWithCustomError(lc, "BadSignature");
    });

    it("a used signature cannot be replayed, and the claim key can never back a new link", async function () {
      const { key } = await newLink();
      const sig = await sign(key, chainId, lc.target, key.address, recipient.address);
      await lc.connect(relayer).claimWithSig(key.address, recipient.address, sig);
      await expect(lc.connect(relayer).claimWithSig(key.address, recipient.address, sig)).to.be.revertedWithCustomError(lc, "AlreadySettled");
      const expiry = (await time.latest()) + DAY;
      await expect(lc.create(key.address, expiry, 0, { value: 1n })).to.be.revertedWithCustomError(lc, "LinkExists");
    });

    it("malleable high-s, v=0/1, wrong-length and zero signatures are rejected", async function () {
      const { key } = await newLink();
      const sig = await sign(key, chainId, lc.target, key.address, recipient.address);
      const { r, s, v } = splitSig(sig);
      const highS = joinSig(r, SECP256K1_N - s, v === 27 ? 28 : 27);
      await expect(lc.connect(relayer).claimWithSig(key.address, recipient.address, highS)).to.be.revertedWithCustomError(lc, "BadSignature");
      await expect(lc.connect(relayer).claimWithSig(key.address, recipient.address, joinSig(r, s, v - 27))).to.be.revertedWithCustomError(lc, "BadSignature");
      await expect(lc.connect(relayer).claimWithSig(key.address, recipient.address, ethers.dataSlice(sig, 0, 64))).to.be.revertedWithCustomError(lc, "BadSignature");
      await expect(lc.connect(relayer).claimWithSig(key.address, recipient.address, ethers.concat([sig, "0x00"]))).to.be.revertedWithCustomError(lc, "BadSignature");
      await expect(lc.connect(relayer).claimWithSig(key.address, recipient.address, ethers.ZeroHash + "00".repeat(33))).to.be.revertedWithCustomError(lc, "BadSignature");
      await expect(lc.connect(relayer).claimWithSig(key.address, recipient.address, sig)).to.not.be.reverted;
    });

    it("signatures have no deadline: a signed claim stays valid until the link settles (documented behaviour)", async function () {
      const { key, expiry } = await newLink();
      const sig = await sign(key, chainId, lc.target, key.address, recipient.address);
      await time.increaseTo(expiry + 365 * DAY);
      await expect(lc.connect(relayer).claimWithSig(key.address, recipient.address, sig)).to.not.be.reverted;
    });

    it("a relayer cannot redirect funds: the signed recipient is the only one paid", async function () {
      const { key, amount } = await newLink();
      const sig = await sign(key, chainId, lc.target, key.address, recipient.address);
      await expect(lc.connect(relayer).claimWithSig(key.address, recipient.address, sig)).to.changeEtherBalances([recipient, relayer], [amount, 0n], {
        includeFee: false,
      });
    });
  });

  describe("Reentrancy and hostile receivers", function () {
    it("a recipient re-entering claim() during a claim gets paid once", async function () {
      const actor = await (await ethers.getContractFactory("ReentrantActor")).deploy(lc.target);
      const amount = ethers.parseEther("2");
      const expiry = (await time.latest()) + DAY;
      await lc.create(actor.target, expiry, 0, { value: amount }); // the contract itself is the claim key
      await actor.setup(1, ethers.ZeroAddress, "0x");
      await expect(actor.doClaim(actor.target)).to.changeEtherBalances([actor, lc], [amount, -amount]);
      expect(await actor.reentryReverted()).to.equal(true);
      expect(await actor.receivedCount()).to.equal(1n);
    });

    it("a sender re-entering refund() during a refund gets paid once", async function () {
      const actor = await (await ethers.getContractFactory("ReentrantActor")).deploy(lc.target);
      const key = ethers.Wallet.createRandom();
      const amount = ethers.parseEther("3");
      const expiry = (await time.latest()) + DAY;
      await actor.createLink(key.address, expiry, { value: amount });
      await time.increaseTo(expiry);
      await actor.setup(2, key.address, "0x");
      await expect(actor.doRefund(key.address)).to.changeEtherBalances([actor, lc], [amount, -amount]);
      expect(await actor.reentryReverted()).to.equal(true);
      expect(await actor.receivedCount()).to.equal(1n);
    });

    it("a recipient re-entering claimWithSig() with the same signature gets paid once", async function () {
      const actor = await (await ethers.getContractFactory("ReentrantActor")).deploy(lc.target);
      const { key, amount } = await newLink({ allowance: 0n });
      const sig = await sign(key, chainId, lc.target, key.address, actor.target);
      await actor.setup(3, key.address, sig);
      await expect(lc.connect(relayer).claimWithSig(key.address, actor.target, sig)).to.changeEtherBalances([actor, lc], [amount, -amount]);
      expect(await actor.reentryReverted()).to.equal(true);
      expect(await actor.receivedCount()).to.equal(1n);
    });

    it("a claim to a recipient that rejects payment reverts and leaves the link claimable", async function () {
      const rejecter = await (await ethers.getContractFactory("RejectingReceiver")).deploy(lc.target);
      const { key, amount } = await newLink();
      await expect(lc.connect(key).claim(rejecter.target)).to.be.revertedWithCustomError(lc, "TransferFailed");
      expect((await lc.links(key.address)).settled).to.equal(false);
      await expect(lc.connect(key).claim(recipient.address)).to.changeEtherBalance(recipient, amount);
    });

    it("a sender that cannot receive can never refund; only the claim key can move the funds (documented limitation)", async function () {
      const rejecter = await (await ethers.getContractFactory("RejectingReceiver")).deploy(lc.target);
      const key = ethers.Wallet.createRandom().connect(ethers.provider);
      const expiry = (await time.latest()) + DAY;
      await rejecter.createLink(key.address, expiry, { value: ethers.parseEther("1") });
      await time.increaseTo(expiry);
      await expect(rejecter.doRefund(key.address)).to.be.revertedWithCustomError(lc, "TransferFailed");
      await setBalance(key.address, ethers.parseEther("1"));
      await expect(lc.connect(key).claim(recipient.address)).to.changeEtherBalance(recipient, ethers.parseEther("1"));
    });

    it("value force-sent with selfdestruct is stranded but never affects link accounting", async function () {
      const { key, amount } = await newLink();
      await (await (await ethers.getContractFactory("ForceSender")).deploy({ value: 12345n })).boom(lc.target);
      expect(await ethers.provider.getBalance(lc.target)).to.equal(amount + 12345n);
      await lc.connect(key).claim(recipient.address);
      expect(await ethers.provider.getBalance(lc.target)).to.equal(12345n);
    });

    it("a claim to the contract's own address reverts (no receive), leaving the link claimable", async function () {
      const { key } = await newLink();
      await expect(lc.connect(key).claim(lc.target)).to.be.revertedWithCustomError(lc, "TransferFailed");
      await expect(lc.connect(key).claim(ethers.ZeroAddress)).to.be.revertedWithCustomError(lc, "InvalidRecipient");
      expect((await lc.links(key.address)).settled).to.equal(false);
    });
  });

  describe("State transitions and races", function () {
    afterEach(async function () {
      await network.provider.send("evm_setAutomine", [true]);
    });

    it("claim then refund, and refund then claim, both settle exactly once", async function () {
      const a = await newLink();
      await time.increaseTo(a.expiry);
      await lc.connect(a.key).claim(recipient.address);
      await expect(lc.connect(sender).refund(a.key.address)).to.be.revertedWithCustomError(lc, "AlreadySettled");
      const b = await newLink();
      await time.increaseTo(b.expiry);
      await lc.connect(sender).refund(b.key.address);
      await expect(lc.connect(b.key).claim(recipient.address)).to.be.revertedWithCustomError(lc, "AlreadySettled");
    });

    for (const first of ["claim", "refund"]) {
      it(`claim and refund in the same block: the first (${first}) wins, the second reverts, funds move once`, async function () {
        const { key, amount, expiry } = await newLink();
        await time.increaseTo(expiry);
        const before = await ethers.provider.getBalance(lc.target);
        await network.provider.send("evm_setAutomine", [false]);
        const txs = {};
        const send = { claim: () => lc.connect(key).claim(recipient.address, { gasLimit: 200000 }), refund: () => lc.connect(sender).refund(key.address, { gasLimit: 200000 }) };
        txs[first] = await send[first]();
        const second = first === "claim" ? "refund" : "claim";
        txs[second] = await send[second]();
        await network.provider.send("evm_mine");
        await network.provider.send("evm_setAutomine", [true]);
        const r1 = await ethers.provider.getTransactionReceipt(txs[first].hash);
        const r2 = await ethers.provider.getTransactionReceipt(txs[second].hash);
        expect(r1.blockNumber).to.equal(r2.blockNumber);
        expect(r1.status).to.equal(1);
        expect(r2.status).to.equal(0);
        expect(before - (await ethers.provider.getBalance(lc.target))).to.equal(amount);
      });
    }

    it("two relayed claims for the same link in one block: one succeeds", async function () {
      const { key } = await newLink({ allowance: 0n });
      const sigA = await sign(key, chainId, lc.target, key.address, recipient.address);
      const sigB = await sign(key, chainId, lc.target, key.address, relayer.address);
      await network.provider.send("evm_setAutomine", [false]);
      const t1 = await lc.connect(relayer).claimWithSig(key.address, recipient.address, sigA, { gasLimit: 200000 });
      const t2 = await lc.connect(attacker).claimWithSig(key.address, relayer.address, sigB, { gasLimit: 200000 });
      await network.provider.send("evm_mine");
      await network.provider.send("evm_setAutomine", [true]);
      const statuses = [(await ethers.provider.getTransactionReceipt(t1.hash)).status, (await ethers.provider.getTransactionReceipt(t2.hash)).status];
      expect(statuses.filter((s) => s === 1).length).to.equal(1);
    });

    it("front-running create() with the same claim key makes the victim's create revert (griefing, Low)", async function () {
      const key = ethers.Wallet.createRandom();
      const expiry = (await time.latest()) + 7 * DAY;
      await network.provider.send("evm_setAutomine", [false]);
      const victim = await lc.connect(sender).create(key.address, expiry, 0, { value: ethers.parseEther("10"), gasLimit: 200000, maxPriorityFeePerGas: 1n, maxFeePerGas: ethers.parseUnits("100", "gwei") });
      const front = await lc.connect(attacker).create(key.address, (await time.latest()) + 2, 0, { value: 1n, gasLimit: 200000, maxPriorityFeePerGas: ethers.parseUnits("50", "gwei"), maxFeePerGas: ethers.parseUnits("100", "gwei") });
      await network.provider.send("evm_mine");
      await network.provider.send("evm_setAutomine", [true]);
      expect((await ethers.provider.getTransactionReceipt(front.hash)).status).to.equal(1);
      expect((await ethers.provider.getTransactionReceipt(victim.hash)).status).to.equal(0);
      expect((await lc.links(key.address)).sender).to.equal(attacker.address);
    });

    it("events always agree with state and transfers", async function () {
      const { key, amount } = await newLink();
      const tx = await lc.connect(key).claim(recipient.address);
      const log = (await tx.wait()).logs.map((l) => lc.interface.parseLog(l)).find((l) => l?.name === "LinkClaimed");
      expect(log.args.claimKey).to.equal(key.address);
      expect(log.args.recipient).to.equal(recipient.address);
      expect(log.args.amount).to.equal(amount);
      expect((await lc.links(key.address)).settled).to.equal(true);
    });
  });

  describe("Invariant fuzzing (seeded random operations)", function () {
    this.timeout(600000);
    const seeds = (process.env.FUZZ_SEEDS || "1,7,42,1337,9001").split(",").map(Number);
    const OPS = Number(process.env.FUZZ_OPS || 250);

    function rng(seed) {
      let a = seed >>> 0;
      return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    for (const seed of seeds) {
      it(`seed ${seed}: ${OPS} random create/claim/claimWithSig/refund/warp operations keep every invariant`, async function () {
        const rand = rng(seed);
        const pick = (arr) => arr[Math.floor(rand() * arr.length)];
        const keys = Array.from({ length: Number(process.env.FUZZ_KEYS || 40) }, () => ethers.Wallet.createRandom().connect(ethers.provider));
        for (const k of keys) await setBalance(k.address, ethers.parseEther("100"));
        const senders = signers.slice(0, 4);
        const relayers = signers.slice(4, 6);
        const outsiders = [attacker, signers[6]];
        const payees = Array.from({ length: 4 }, () => ethers.Wallet.createRandom().address);
        const model = new Map(); // claimKey -> { sender, amount, expiry, settled }
        const settleCount = new Map();
        const tally = { ok: 0, reverted: 0 };

        const expectOutcome = async (promise, expected, label) => {
          let name = null;
          let receipt = null;
          try {
            receipt = await (await promise).wait();
          } catch (e) {
            name = e.revert?.name || lc.interface.parseError(e.data || "0x")?.name || e.shortMessage || String(e);
          }
          expect(name, `${label} (seed ${seed})`).to.equal(expected);
          if (expected === null) tally.ok++;
          else tally.reverted++;
          return receipt;
        };

        for (let i = 0; i < OPS; i++) {
          const op = pick(["create", "create", "create", "claim", "claim", "claimWithSig", "claimWithSig", "refund", "refund", "warp"]);
          const now = await time.latest();
          if (op === "create") {
            const key = pick(keys);
            const from = pick(senders);
            const allowance = pick([0n, 1n, ethers.parseEther("0.005"), MAX_ALLOWANCE, MAX_ALLOWANCE + 1n]);
            const amount = pick([0n, 1n, ethers.parseEther("0.01"), BigInt(Math.floor(rand() * 1e6)) * 10n ** 12n, ethers.parseEther("50")]);
            const expiry = pick([now - 5, now + 1 + Math.floor(rand() * 30 * DAY)]);
            const nextTs = now + 1;
            let expected = null;
            if (model.has(key.address)) expected = "LinkExists";
            else if (expiry <= nextTs) expected = "InvalidExpiry";
            else if (allowance > MAX_ALLOWANCE || amount === 0n) expected = "InvalidAmount";
            const keyBefore = await ethers.provider.getBalance(key.address);
            await time.setNextBlockTimestamp(nextTs);
            const r = await expectOutcome(lc.connect(from).create(key.address, expiry, allowance, { value: amount + allowance, gasLimit: 300000 }), expected, `create ${i}`);
            if (r) {
              model.set(key.address, { sender: from.address, amount, expiry, settled: false });
              expect(await ethers.provider.getBalance(key.address), "allowance forwarded exactly").to.equal(keyBefore + allowance);
            }
          } else if (op === "claim") {
            const key = pick(keys);
            const to = pick([...payees, ethers.ZeroAddress]);
            const link = model.get(key.address);
            let expected = null;
            if (!link) expected = "LinkNotFound";
            else if (link.settled) expected = "AlreadySettled";
            else if (to === ethers.ZeroAddress) expected = "InvalidRecipient";
            const before = to === ethers.ZeroAddress ? 0n : await ethers.provider.getBalance(to);
            const r = await expectOutcome(lc.connect(key).claim(to, { gasLimit: 300000 }), expected, `claim ${i}`);
            if (r) {
              link.settled = true;
              settleCount.set(key.address, (settleCount.get(key.address) || 0) + 1);
              expect(await ethers.provider.getBalance(to), "recipient paid exactly").to.equal(before + link.amount);
            }
          } else if (op === "claimWithSig") {
            const key = pick(keys);
            const signer = rand() < 0.7 ? key : ethers.Wallet.createRandom();
            const signedTo = pick(payees);
            const passedTo = rand() < 0.8 ? signedTo : pick(payees);
            const sig = await sign(signer, chainId, lc.target, key.address, signedTo);
            const link = model.get(key.address);
            let expected = null;
            if (signer !== key || passedTo !== signedTo) expected = "BadSignature";
            else if (!link) expected = "LinkNotFound";
            else if (link.settled) expected = "AlreadySettled";
            const before = await ethers.provider.getBalance(passedTo);
            const r = await expectOutcome(lc.connect(pick([...relayers, ...outsiders])).claimWithSig(key.address, passedTo, sig, { gasLimit: 300000 }), expected, `claimWithSig ${i}`);
            if (r) {
              link.settled = true;
              settleCount.set(key.address, (settleCount.get(key.address) || 0) + 1);
              expect(await ethers.provider.getBalance(passedTo), "signed recipient paid exactly").to.equal(before + link.amount);
            }
          } else if (op === "refund") {
            const key = pick(keys);
            const caller = pick([...senders, ...outsiders]);
            const link = model.get(key.address);
            const nextTs = now + 1;
            let expected = null;
            if (!link) expected = "LinkNotFound";
            else if (link.settled) expected = "AlreadySettled";
            else if (caller.address !== link.sender) expected = "NotSender";
            else if (nextTs < link.expiry) expected = "NotExpired";
            await time.setNextBlockTimestamp(nextTs);
            const before = await ethers.provider.getBalance(caller.address);
            const r = await expectOutcome(lc.connect(caller).refund(key.address, { gasLimit: 300000 }), expected, `refund ${i}`);
            if (r) {
              link.settled = true;
              settleCount.set(key.address, (settleCount.get(key.address) || 0) + 1);
              expect(await ethers.provider.getBalance(caller.address), "sender refunded exactly").to.equal(before + link.amount - r.fee);
            }
          } else {
            await time.increase(Math.floor(rand() * 10 * DAY) + 1);
          }

          // Invariants after every operation
          const open = [...model.values()].filter((l) => !l.settled).reduce((a, l) => a + l.amount, 0n);
          expect(await ethers.provider.getBalance(lc.target), `balance == open liabilities after op ${i} (seed ${seed})`).to.equal(open);
          for (const [k, n] of settleCount) expect(n, `link ${k} settled at most once`).to.be.at.most(1);
          for (const [k, l] of model) expect((await lc.links(k)).settled).to.equal(l.settled);
        }
        console.log(`      seed ${seed}: ${tally.ok} successful and ${tally.reverted} expected reverts, ${model.size} links, ${[...settleCount.values()].length} settled`);
      });
    }
  });
});
