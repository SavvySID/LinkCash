// Local end-to-end helper: deploys LinkCash to a running `npx hardhat node`,
// creates a funded link, and prints the claim URL.
//   npx hardhat node
//   npx hardhat run scripts/local-demo.js --network localhost
const { ethers } = require("hardhat");

async function main() {
  const [sender] = await ethers.getSigners();
  const linkCash = await (await ethers.getContractFactory("LinkCash")).deploy();
  await linkCash.waitForDeployment();

  const key = ethers.Wallet.createRandom();
  const amount = ethers.parseEther("25");
  const gas = ethers.parseEther("0.005");
  const expiry = Math.floor(Date.now() / 1000) + 7 * 86400;
  await (await linkCash.create(key.address, expiry, gas, { value: amount + gas })).wait();

  const base = (process.env.APP_URL || "http://localhost:5173").replace(/\/$/, "");
  console.log("contract:", linkCash.target);
  console.log("sender:  ", sender.address);
  console.log("claim:   ", `${base}/claim/${key.address}#k=${key.privateKey.slice(2)}&m=${encodeURIComponent("Lunch money")}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
