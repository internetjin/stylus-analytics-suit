// Convert `cargo stylus export-abi` output (Solidity interface text) into
// the JSON ABI format ethers / web3 expect. Reads from stdin, writes to stdout.
//
//   cargo stylus export-abi | node scripts/sol-to-abi.mjs > artifacts/foo.abi.json
//
// Side-steps the solc dependency `cargo stylus export-abi --json` requires.

import { readFileSync } from "node:fs";
import { Interface } from "ethers";

const text = readFileSync(0, "utf8");

const fragments = [];
const lines = text.split(/\r?\n/);
for (const raw of lines) {
  const line = raw.trim();
  if (!line) continue;
  if (line.startsWith("//") || line.startsWith("/*") || line.startsWith("*") || line.startsWith("*/")) continue;
  if (line.startsWith("pragma") || line.startsWith("interface") || line.startsWith("contract") || line === "{" || line === "}") continue;

  // Strip trailing semicolons and any `memory` / `calldata` storage-location markers
  // that aren't part of ethers' human-readable ABI grammar.
  const cleaned = line
    .replace(/;\s*$/, "")
    .replace(/\b(memory|calldata|storage)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.startsWith("function ") || cleaned.startsWith("event ") || cleaned.startsWith("error ")) {
    fragments.push(cleaned);
  }
}

const iface = new Interface(fragments);
const json = JSON.parse(iface.formatJson());
process.stdout.write(JSON.stringify(json, null, 2) + "\n");
