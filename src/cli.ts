#!/usr/bin/env node
import { Command } from "commander";
import { writeFileSync } from "node:fs";
import { basename, dirname, relative } from "node:path";

import { loadAbi } from "./abi/load";
import { parseWasm, readWasm } from "./wasm/parse";
import { analyzeSize, brotliMaxCompress } from "./wasm/size";
import { estimateDeploymentCost } from "./wasm/cost";
import { getProvider } from "./provider";
import { resolveSelectors } from "./selectors/compute";
import { detectCollisions } from "./selectors/collisions";
import { generateEthersInterface } from "./codegen/ethers";
import {
  defaultGenOutputPath,
  deriveContractName,
  ensureDir,
  resolveAbiInput,
  resolveWasmInput,
} from "./paths";

const program = new Command();
program
  .name("sas")
  .description("Stylus Analytics Suite -- WASM analysis and Stylus codegen")
  .version("0.1.0");

program
  .command("analyze")
  .description("M1 -- WASM size validation + live-RPC deployment cost estimate")
  .argument("<name|path>", "contract name (resolved against artifacts/) or explicit .wasm path")
  .option("--no-cost", "skip the live RPC cost estimate")
  .option("--compressed-limit <bytes>", "override compressed deploy limit", (v) => parseInt(v, 10))
  .option("--activation-limit <bytes>", "override activation size limit", (v) => parseInt(v, 10))
  .action(async (
    arg: string,
    opts: { cost: boolean; compressedLimit?: number; activationLimit?: number },
  ) => {
    const wasmPath = resolveWasmInput(arg);
    const bytes = readWasm(wasmPath);
    const wasm = parseWasm(bytes);
    if (!wasm.magicValid) {
      console.error(`error: ${wasmPath} does not have a valid WASM magic header`);
      process.exitCode = 1;
      return;
    }

    const size = analyzeSize(bytes, {
      compressedLimit: opts.compressedLimit,
      activationLimit: opts.activationLimit,
    });

    console.log(`WASM: ${basename(wasmPath)}`);
    console.log(`  version            ${wasm.version}`);
    console.log(`  functions          ${wasm.numFunctions}`);
    console.log(`  imports            ${wasm.numImports}`);
    console.log(`  exports            ${wasm.numExports}`);
    if (wasm.memoryPages != null) {
      console.log(`  memory pages       ${wasm.memoryPages} (${wasm.memoryPages * 64} KB)`);
    }

    console.log();
    console.log("Size:");
    console.log(
      `  raw                ${size.rawSize} B  (activation cap ${size.activationLimit} B, ${size.fitsActivated ? "OK" : "OVER"})`
    );
    console.log(
      `  brotli-compressed  ${size.compressedSize} B  (deploy cap ${size.compressedLimit} B, ${size.fitsCompressed ? "OK" : "OVER"})`
    );
    console.log(`  compression ratio  ${(size.compressionRatio * 100).toFixed(1)}%`);

    for (const w of size.warnings) console.log(`  ! ${w}`);

    if (opts.cost && size.fitsCompressed) {
      const provider = getProvider();
      const compressed = brotliMaxCompress(bytes);
      console.log();
      console.log("Deployment cost (live RPC):");
      try {
        const cost = await estimateDeploymentCost(compressed, provider);
        console.log(`  estimated gas      ${cost.estimatedDeployGas.toString()}`);
        console.log(`  gas price (wei)    ${cost.gasPriceWei.toString()}`);
        console.log(`  deploy cost (ETH)  ${cost.deployCostEth}`);
        console.log(`  source             ${cost.source}`);
        for (const n of cost.notes) console.log(`  note: ${n}`);
      } catch (err) {
        console.log(`  error: ${(err as Error).message}`);
      }
    } else if (!opts.cost) {
      console.log();
      console.log("Deployment cost: skipped (--no-cost).");
    }
  });

program
  .command("collisions")
  .description("M2 -- detect 4-byte selector collisions inside a single ABI")
  .argument("<name|path>", "contract name (resolved against artifacts/) or explicit ABI path")
  .action((arg: string) => {
    const abiPath = resolveAbiInput(arg);
    const abi = loadAbi(abiPath);
    const resolved = resolveSelectors(abi);
    const report = detectCollisions(resolved);

    console.log(`ABI: ${basename(abiPath)}`);
    console.log(`  functions          ${report.totalFunctions}`);
    console.log(`  unique selectors   ${report.uniqueSelectors}`);
    if (report.collisions.length === 0) {
      console.log("  collisions         none");
      return;
    }

    console.log(`  collisions         ${report.collisions.length}`);
    for (const c of report.collisions) {
      console.log();
      console.log(`  ! selector ${c.selector} matches ${c.signatures.length} signatures:`);
      for (const sig of c.signatures) console.log(`      - ${sig}`);
    }
    process.exitCode = 1;
  });

program
  .command("gen")
  .description("M3 -- emit a TypeScript ethers.js module for off-chain (backend/frontend) interaction")
  .argument("<name|path>", "contract name (resolved against artifacts/) or explicit ABI path")
  .option("--name <interfaceName>", "name for the generated TS interface (default: I<ContractName>)")
  .option("--contract <contractName>", "override the contract name embedded in the header / attach helper")
  .option("-o, --out <path>", "write to this path instead of generated/<name>.ts")
  .option("--stdout", "print to stdout instead of writing a file")
  .action((arg: string, opts: { name?: string; contract?: string; out?: string; stdout?: boolean }) => {
    const abiPath = resolveAbiInput(arg);
    const abi = loadAbi(abiPath);

    const contractName = opts.contract ?? deriveContractName(arg);
    const stem = contractName.replace(/[^A-Za-z0-9]/g, "");
    const pascal = stem.length > 0
      ? stem.charAt(0).toUpperCase() + stem.slice(1)
      : "Contract";
    const interfaceName = opts.name ?? `I${pascal}`;

    const ts = generateEthersInterface(abi, {
      interfaceName,
      contractName,
    });

    if (opts.stdout) {
      process.stdout.write(ts);
      return;
    }

    const outPath = opts.out ?? defaultGenOutputPath(arg);
    ensureDir(dirname(outPath));
    writeFileSync(outPath, ts);
    const rel = relative(process.cwd(), outPath);
    console.log(`wrote ${rel && !rel.startsWith("..") ? rel : outPath}`);
  });

program.parseAsync(process.argv);
