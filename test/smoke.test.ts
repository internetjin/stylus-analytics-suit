import test from "node:test";
import assert from "node:assert/strict";

import {
  canonicalType,
  functionSignature,
  resolveSelectors,
  selector,
} from "../src/selectors/compute";
import { detectCollisions } from "../src/selectors/collisions";
import { generateEthersInterface } from "../src/codegen/ethers";
import { parseWasm } from "../src/wasm/parse";
import { analyzeSize } from "../src/wasm/size";
import { buildDeployBytecode } from "../src/wasm/cost";
import {
  defaultGenOutputPath,
  deriveContractName,
  resolveAbiInput,
  resolveWasmInput,
} from "../src/paths";

test("selector -- transfer(address,uint256) yields the canonical ERC-20 selector", () => {
  assert.equal(selector("transfer(address,uint256)"), "0xa9059cbb");
});

test("selector -- balanceOf(address) yields 0x70a08231", () => {
  assert.equal(selector("balanceOf(address)"), "0x70a08231");
});

test("canonicalType -- flattens nested tuple components", () => {
  assert.equal(
    canonicalType({
      name: "x",
      type: "tuple",
      components: [
        { name: "a", type: "uint256" },
        { name: "b", type: "address" },
      ],
    }),
    "(uint256,address)",
  );
});

test("canonicalType -- preserves tuple array suffix", () => {
  assert.equal(
    canonicalType({
      name: "x",
      type: "tuple[]",
      components: [{ name: "a", type: "uint256" }],
    }),
    "(uint256)[]",
  );
});

test("functionSignature -- encodes a zero-arg function", () => {
  assert.equal(
    functionSignature({ type: "function", name: "ping", inputs: [], outputs: [] }),
    "ping()",
  );
});

test("resolveSelectors -- skips events, constructors, and unnamed functions", () => {
  const resolved = resolveSelectors([
    { type: "function", name: "ping", inputs: [] },
    { type: "constructor", inputs: [] },
    { type: "event", name: "Pinged", inputs: [] },
    { type: "fallback", inputs: [] },
  ]);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].signature, "ping()");
});

test("collisions -- distinct signatures produce no collisions", () => {
  const resolved = resolveSelectors([
    { type: "function", name: "transfer", inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ] },
    { type: "function", name: "balanceOf", inputs: [{ name: "a", type: "address" }] },
  ]);
  const report = detectCollisions(resolved);
  assert.equal(report.collisions.length, 0);
  assert.equal(report.totalFunctions, 2);
  assert.equal(report.uniqueSelectors, 2);
});

test("collisions -- groups distinct signatures sharing a selector", () => {
  const report = detectCollisions([
    { signature: "foo()", selector: "0xdeadbeef",
      fn: { type: "function", name: "foo", inputs: [] } },
    { signature: "bar(uint256)", selector: "0xdeadbeef",
      fn: { type: "function", name: "bar", inputs: [{ name: "x", type: "uint256" }] } },
    { signature: "baz()", selector: "0xcafebabe",
      fn: { type: "function", name: "baz", inputs: [] } },
  ]);
  assert.equal(report.collisions.length, 1);
  assert.equal(report.collisions[0].selector, "0xdeadbeef");
  assert.deepEqual(report.collisions[0].signatures, ["bar(uint256)", "foo()"]);
});

test("codegen -- emits ethers TS interface with read/write split and payable overrides", () => {
  const ts = generateEthersInterface(
    [
      { type: "function", name: "transfer", stateMutability: "nonpayable",
        inputs: [
          { name: "to", type: "address" },
          { name: "amount", type: "uint256" },
        ],
        outputs: [{ name: "", type: "bool" }] },
      { type: "function", name: "balanceOf", stateMutability: "view",
        inputs: [{ name: "a", type: "address" }],
        outputs: [{ name: "", type: "uint256" }] },
      { type: "function", name: "deposit", stateMutability: "payable",
        inputs: [], outputs: [] },
      { type: "constructor", inputs: [] },
      { type: "event", name: "Transfer", inputs: [] },
    ],
    { interfaceName: "IBank", contractName: "bank" },
  );

  assert.match(ts, /from "ethers"/);
  assert.match(ts, /export const ABI: InterfaceAbi/);
  assert.match(ts, /export interface IBank \{/);
  // Write method returns the ethers transaction response
  assert.match(ts, /transfer\(to: string, amount: bigint\): Promise<ContractTransactionResponse>;/);
  // Read method returns the decoded value
  assert.match(ts, /balanceOf\(a: string\): Promise<bigint>;/);
  // Payable method gets an overrides parameter
  assert.match(ts, /deposit\(overrides\?: \{ value\?: bigint \}\): Promise<ContractTransactionResponse>;/);
  // Attach helper named after the contract
  assert.match(ts, /export function attachBank\(/);
  // No TS method declarations for non-function ABI entries (the embedded ABI JSON does
  // contain the strings "constructor" and "Transfer" as type/name values -- that's fine).
  assert.doesNotMatch(ts, /^\s+constructor\(/m);
  assert.doesNotMatch(ts, /^\s+Transfer\(/m);
  // No leftover from the deleted Stylus / Rust generator
  assert.doesNotMatch(ts, /sol_interface/);
});

test("codegen -- falls back to argN when a parameter has no name", () => {
  const ts = generateEthersInterface(
    [
      { type: "function", name: "set", stateMutability: "nonpayable",
        inputs: [{ name: "", type: "uint256" }, { name: "", type: "address" }],
        outputs: [] },
    ],
    { interfaceName: "ISetter", contractName: "setter" },
  );
  assert.match(ts, /set\(arg0: bigint, arg1: string\): Promise<ContractTransactionResponse>;/);
});

test("codegen -- maps array and tuple ABI types to TS shapes", () => {
  const ts = generateEthersInterface(
    [
      { type: "function", name: "batch", stateMutability: "view",
        inputs: [
          { name: "addrs", type: "address[]" },
          { name: "ids", type: "uint256[3]" },
        ],
        outputs: [{
          name: "info",
          type: "tuple",
          components: [
            { name: "owner", type: "address" },
            { name: "count", type: "uint128" },
          ],
        }] },
    ],
    { interfaceName: "IBatch", contractName: "batch" },
  );
  assert.match(ts, /batch\(addrs: string\[\], ids: bigint\[\]\): Promise<\{ owner: string; count: bigint \}>;/);
});

test("WASM -- magic and version on a minimal valid module", () => {
  const minimal = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
  const result = parseWasm(minimal);
  assert.equal(result.magicValid, true);
  assert.equal(result.version, 1);
  assert.equal(result.numFunctions, 0);
});

test("WASM -- rejects garbage as not-WASM", () => {
  const garbage = Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
  const result = parseWasm(garbage);
  assert.equal(result.magicValid, false);
});

test("size -- flags compressed payload over a custom deploy cap", () => {
  const big = Buffer.alloc(1000, 0xaa);
  const report = analyzeSize(big, { compressedLimit: 5, activationLimit: 999_999 });
  assert.equal(report.fitsCompressed, false);
  assert.equal(report.fitsActivated, true);
  assert.ok(report.warnings.some(w => /Compressed WASM/.test(w)));
});

test("paths -- bare name resolves into artifacts/ for WASM and ABI", () => {
  const wasm = resolveWasmInput("erc20", "/tmp/artifacts");
  const abi = resolveAbiInput("erc20", "/tmp/artifacts-does-not-exist");
  assert.equal(wasm, "/tmp/artifacts/erc20.wasm");
  // When neither .abi.json nor .json exists on disk, the resolver falls back to the .json form.
  assert.equal(abi, "/tmp/artifacts-does-not-exist/erc20.json");
});

test("paths -- path-like args bypass artifacts lookup", () => {
  assert.match(resolveWasmInput("./tmp/foo.wasm", "/ignored"), /tmp[\\/]foo\.wasm$/);
  assert.match(resolveAbiInput("./tmp/foo.abi.json", "/ignored"), /tmp[\\/]foo\.abi\.json$/);
  assert.match(resolveAbiInput("/abs/path/foo.json", "/ignored"), /^\/abs\/path\/foo\.json$/);
});

test("paths -- defaultGenOutputPath strips known extensions and dirs, emits .ts", () => {
  assert.equal(defaultGenOutputPath("erc20", "/out"), "/out/erc20.ts");
  assert.equal(defaultGenOutputPath("artifacts/erc20.abi.json", "/out"), "/out/erc20.ts");
  assert.equal(defaultGenOutputPath("foo.wasm", "/out"), "/out/foo.ts");
});

test("paths -- deriveContractName drops dir and extension", () => {
  assert.equal(deriveContractName("erc20"), "erc20");
  assert.equal(deriveContractName("artifacts/erc20.abi.json"), "erc20");
  assert.equal(deriveContractName("/abs/path/myToken.wasm"), "myToken");
});

test("cost -- deploy bytecode begins with the 14-byte init stub and embeds Stylus magic", () => {
  const compressed = Buffer.from([0xaa, 0xbb, 0xcc]);
  const hex = buildDeployBytecode(compressed);
  // The runtime portion (after the 14-byte init stub) must start with the 3-byte Stylus magic 0xeff000.
  // Stub is 14 bytes = 28 hex chars; then 6 hex chars of magic.
  assert.equal(hex.slice(0, 2), "0x");
  assert.equal(hex.slice(2 + 28, 2 + 28 + 6), "eff000");
  // Followed by the original compressed payload (aa bb cc).
  assert.equal(hex.slice(2 + 28 + 6), "aabbcc");
});
