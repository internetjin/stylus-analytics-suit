// Mine two function names with colliding 4-byte selectors via birthday-attack
// over `fN()` and append them to the given ABI file in-place.
//
// stylus-sdk catches selector collisions at compile time, so a collision can't
// live in the Rust source. Injecting at the ABI layer demonstrates the M2
// detector against ABIs that come from any other toolchain or are hand-rolled.

import { readFileSync, writeFileSync } from "node:fs";
import { keccak256, toUtf8Bytes } from "ethers";

const [, , abiPath] = process.argv;
if (!abiPath) {
  console.error("usage: inject-collision.mjs <abi.json>");
  process.exit(2);
}

function selector(sig) {
  return keccak256(toUtf8Bytes(sig)).slice(0, 10);
}

const seen = new Map();
let collision = null;
for (let i = 0; i < 5_000_000; i++) {
  const sig = `f${i}()`;
  const sel = selector(sig);
  if (seen.has(sel)) {
    collision = { sigA: seen.get(sel), sigB: sig, selector: sel, iterations: i };
    break;
  }
  seen.set(sel, sig);
}
if (!collision) {
  console.error("no collision found after 5M tries");
  process.exit(1);
}

const fnA = collision.sigA.slice(0, collision.sigA.indexOf("("));
const fnB = collision.sigB.slice(0, collision.sigB.indexOf("("));

const abi = JSON.parse(readFileSync(abiPath, "utf8"));
abi.push(
  { type: "function", name: fnA, stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: fnB, stateMutability: "nonpayable", inputs: [], outputs: [] },
);
writeFileSync(abiPath, JSON.stringify(abi, null, 2) + "\n");

console.log(
  `injected collision: ${fnA}() and ${fnB}() share ${collision.selector} (mined in ${collision.iterations} iterations)`
);
