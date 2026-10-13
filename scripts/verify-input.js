// Writes the Solidity standard-JSON input for LinkCash.sol, for verifying the
// deployed contract's source on the Arc explorer (see README, "Verify the
// contract source"). Run after `npx hardhat compile`:
//   node scripts/verify-input.js
const fs = require("fs");
const path = require("path");

const SOURCE = "contracts/LinkCash.sol";
const buildInfoDir = path.join(__dirname, "..", "artifacts", "build-info");
const infos = fs
  .readdirSync(buildInfoDir)
  .map((f) => JSON.parse(fs.readFileSync(path.join(buildInfoDir, f), "utf8")))
  .filter((b) => b.input.sources[SOURCE]);
if (!infos.length) throw new Error(`No build-info contains ${SOURCE}. Run \`npx hardhat compile\` first.`);

const { input, solcLongVersion } = infos[infos.length - 1];
// LinkCash.sol has no imports, so it can be verified on its own.
const out = { ...input, sources: { [SOURCE]: input.sources[SOURCE] } };
const dir = path.join(__dirname, "..", "artifacts", "verify");
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, "LinkCash.standard-input.json");
fs.writeFileSync(file, JSON.stringify(out, null, 2));
console.log(`Wrote ${path.relative(process.cwd(), file)}`);
console.log(`Compiler: v${solcLongVersion}  optimizer: ${JSON.stringify(input.settings.optimizer)}  evmVersion: ${input.settings.evmVersion}`);
