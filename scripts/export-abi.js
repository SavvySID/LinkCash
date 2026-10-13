// Copies the compiled ABI + bytecode into web/src/contract.json for the frontend.
// Run after `npx hardhat compile`.
const fs = require("fs");
const path = require("path");

const { abi, bytecode } = require("../artifacts/contracts/LinkCash.sol/LinkCash.json");
const out = path.join(__dirname, "..", "web", "src", "contract.json");
fs.writeFileSync(out, JSON.stringify({ abi, bytecode }, null, 2) + "\n");
console.log(`Wrote ${out}`);
