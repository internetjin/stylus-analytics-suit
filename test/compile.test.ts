import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { generateStylusInterface } from "../src/codegen/stylus";
import { loadAbi } from "../src/abi/load";
import { resolveAbiInput } from "../src/paths";
import { Abi } from "../src/types";

// The correctness bar for an on-chain code generator is "the emitted
// sol_interface! actually compiles in a Stylus crate." This test writes the
// generated Rust into a throwaway crate and builds it for wasm32 against the
// pinned stylus-sdk, reusing contracts/target so the build is fast.

const REPO = resolve(__dirname, "..");
const CONTRACTS_TARGET = join(REPO, "contracts", "target");

function toolchainAvailable(): string | false {
  if (process.env.SAS_SKIP_COMPILE_TEST) return "SAS_SKIP_COMPILE_TEST is set";
  const cargo = spawnSync("cargo", ["--version"], { encoding: "utf8" });
  if (cargo.status !== 0) return "cargo not found";
  // if rustup is present, require the wasm32 target; if not, assume it's there
  const targets = spawnSync("rustup", ["target", "list", "--installed"], { encoding: "utf8" });
  if (targets.status === 0 && !/wasm32-unknown-unknown/.test(targets.stdout)) {
    return "wasm32-unknown-unknown target not installed";
  }
  return false;
}

function stylusSdkVersion(): string {
  try {
    const ws = readFileSync(join(REPO, "contracts", "Cargo.toml"), "utf8");
    return ws.match(/stylus-sdk\s*=\s*"([^"]+)"/)?.[1] ?? "0.10.5";
  } catch {
    return "0.10.5";
  }
}

// tuple param, tuple-array return, a nested tuple, and a payable function — the
// cases the generator emits as anonymous Solidity tuples plus the `payable`
// mutability branch (the one most likely to matter for value-transfer contracts).
const TUPLE_ABI: Abi = [
  {
    type: "function", name: "setInfo", stateMutability: "nonpayable",
    inputs: [{ name: "info", type: "tuple", components: [
      { name: "owner", type: "address" }, { name: "count", type: "uint128" },
    ] }],
    outputs: [],
  },
  {
    type: "function", name: "topUp", stateMutability: "payable",
    inputs: [{ name: "to", type: "address" }], outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function", name: "list", stateMutability: "view", inputs: [],
    outputs: [{ name: "", type: "tuple[]", components: [{ name: "x", type: "uint256" }] }],
  },
  {
    type: "function", name: "nested", stateMutability: "view",
    inputs: [{ name: "n", type: "tuple", components: [
      { name: "u", type: "uint256" },
      { name: "inner", type: "tuple", components: [
        { name: "a", type: "address" }, { name: "flag", type: "bool" },
      ] },
    ] }],
    outputs: [],
  },
];

const skip = toolchainAvailable();

test(
  "stylus export -- generated sol_interface! compiles under stylus-sdk (wasm32)",
  { skip: skip || false, timeout: 240_000 },
  () => {
    const modules = [
      { name: "erc721_iface", rust: generateStylusInterface(loadAbi(resolveAbiInput("erc721")), { interfaceName: "IErc721", contractName: "erc721" }) },
      { name: "erc1155_iface", rust: generateStylusInterface(loadAbi(resolveAbiInput("erc1155")), { interfaceName: "IErc1155", contractName: "erc1155" }) },
      { name: "tuples_iface", rust: generateStylusInterface(TUPLE_ABI, { interfaceName: "ITuples", contractName: "tuples" }) },
    ];

    const dir = mkdtempSync(join(tmpdir(), "sas-compile-"));
    mkdirSync(join(dir, "src"));

    writeFileSync(
      join(dir, "Cargo.toml"),
      `[package]
name = "sas-compile-check"
edition = "2021"
version = "0.0.0"

[dependencies]
stylus-sdk = "${stylusSdkVersion()}"

[lib]
crate-type = ["lib"]
`,
    );

    const modDecls = modules.map((m) => `mod ${m.name};`).join("\n");
    writeFileSync(
      join(dir, "src", "lib.rs"),
      `#![cfg_attr(not(any(feature = "export-abi", test)), no_main)]\nextern crate alloc;\n${modDecls}\n`,
    );
    for (const m of modules) writeFileSync(join(dir, "src", `${m.name}.rs`), m.rust);

    const res = spawnSync(
      "cargo",
      [
        "build",
        "--target", "wasm32-unknown-unknown",
        "--manifest-path", join(dir, "Cargo.toml"),
        "--target-dir", CONTRACTS_TARGET,
      ],
      { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
    );

    assert.equal(
      res.status,
      0,
      `cargo build failed:\n${res.stderr ?? ""}\n${res.stdout ?? ""}`,
    );
  },
);
