import { writeFileSync } from "node:fs";
import { basename, dirname, relative } from "node:path";

import { loadAbi } from "./abi/load";
import { loadConfig } from "./config";
import { parseWasm, readWasm } from "./wasm/parse";
import { analyzeSize, brotliMaxCompress } from "./wasm/size";
import { estimateDeploymentCost } from "./wasm/cost";
import { getProvider } from "./provider";
import { resolveSelectors } from "./selectors/compute";
import { detectCollisions } from "./selectors/collisions";
import { generateEthersInterface } from "./codegen/ethers";
import { generateStylusInterface, overloadedFunctionNames } from "./codegen/stylus";
import {
  assertInputExists,
  defaultExportOutputPath,
  defaultGenOutputPath,
  deriveContractName,
  ensureDir,
  resolveAbiInput,
  resolveWasmInput,
} from "./paths";

// I<Pascal> interface name + cleaned contract name, shared by gen and export.
function namesFor(arg: string, contractOverride?: string, nameOverride?: string) {
  const contractName = contractOverride ?? deriveContractName(arg);
  const stem = contractName.replace(/[^A-Za-z0-9]/g, "");
  const pascal = stem.length > 0
    ? stem.charAt(0).toUpperCase() + stem.slice(1)
    : "Contract";
  return { contractName, interfaceName: nameOverride ?? `I${pascal}` };
}

function reportWrite(outPath: string): void {
  const rel = relative(process.cwd(), outPath);
  console.log(`wrote ${rel && !rel.startsWith("..") ? rel : outPath}`);
}

export type AnalyzeOptions = {
  cost: boolean;
  compressedLimit?: number;
  activationLimit?: number;
};

// M1 -- WASM size validation + live-RPC deployment cost estimate
export async function runAnalyze(arg: string, opts: AnalyzeOptions): Promise<void> {
  const wasmPath = resolveWasmInput(arg);
  assertInputExists(wasmPath, arg, "WASM");
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
    `  raw                ${size.rawSize} B  (activation cap ${size.activationLimit} B, ${size.fitsActivated ? "OK" : "OVER"})`,
  );
  console.log(
    `  brotli-compressed  ${size.compressedSize} B  (deploy cap ${size.compressedLimit} B, ${size.fitsCompressed ? "OK" : "OVER"})`,
  );
  console.log(`  compression ratio  ${(size.compressionRatio * 100).toFixed(1)}%`);

  for (const w of size.warnings) console.log(`  ! ${w}`);

  if (opts.cost && size.fitsCompressed) {
    const provider = getProvider();
    const compressed = brotliMaxCompress(bytes);
    console.log();
    console.log("Deployment cost (live RPC):");
    // ARB_RPC_URL is optional and falls back to a public endpoint, so the numbers
    // below can come from a host the user never chose. Name it.
    console.log(`  endpoint           ${loadConfig().rpcUrl}${process.env.ARB_RPC_URL ? "" : "  (default — set ARB_RPC_URL to override)"}`);
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
}

// M2 -- detect 4-byte selector collisions inside a single ABI
export function runCollisions(arg: string): void {
  const abiPath = resolveAbiInput(arg);
  assertInputExists(abiPath, arg, "ABI");
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
}

export type GenOptions = {
  name?: string;
  contract?: string;
  out?: string;
  stdout?: boolean;
};

// M3 -- emit a TypeScript ethers.js module for off-chain interaction
export function runGen(arg: string, opts: GenOptions): void {
  const abiPath = resolveAbiInput(arg);
  assertInputExists(abiPath, arg, "ABI");
  const abi = loadAbi(abiPath);
  const { contractName, interfaceName } = namesFor(arg, opts.contract, opts.name);

  const ts = generateEthersInterface(abi, { interfaceName, contractName });

  if (opts.stdout) {
    process.stdout.write(ts);
    return;
  }
  const outPath = opts.out ?? defaultGenOutputPath(arg);
  ensureDir(dirname(outPath));
  writeFileSync(outPath, ts);
  reportWrite(outPath);
}

export type ExportOptions = {
  name?: string;
  module?: string;
  contract?: string;
  out?: string;
  stdout?: boolean;
};

// M4 -- emit a Rust sol_interface! module for Stylus-to-Stylus (on-chain) calls
export function runExport(arg: string, opts: ExportOptions): void {
  const abiPath = resolveAbiInput(arg);
  assertInputExists(abiPath, arg, "ABI");
  const abi = loadAbi(abiPath);
  const { contractName, interfaceName } = namesFor(arg, opts.contract, opts.name);

  // Reuse M2: an ABI with selector collisions yields an interface whose calls are
  // ambiguous on-chain. Warn (to stderr, so --stdout stays clean) rather than
  // silently emitting a broken interface.
  const collisions = detectCollisions(resolveSelectors(abi)).collisions;
  if (collisions.length > 0) {
    console.warn(
      `! warning: ${collisions.length} selector collision(s) in this ABI — the generated interface will have ambiguous on-chain calls. Run \`sas collisions ${arg}\` for details.`,
    );
  }

  // Overloaded names (distinct selectors, same snake_case Rust method) make the
  // generated sol_interface! fail to compile (E0592). Selector-collision checks
  // miss this, so warn separately — to stderr, keeping --stdout output clean.
  const overloads = overloadedFunctionNames(abi);
  if (overloads.length > 0) {
    console.warn(
      `! warning: overloaded function name(s) — ${overloads.join(", ")}. sol_interface! collapses each onto one snake_case method, so the generated interface will NOT compile (rustc E0592). Rename or remove one side of each overload.`,
    );
  }

  const rust = generateStylusInterface(abi, {
    interfaceName,
    contractName,
    module: opts.module,
  });

  if (opts.stdout) {
    process.stdout.write(rust);
    return;
  }
  const outPath = opts.out ?? defaultExportOutputPath(arg);
  ensureDir(dirname(outPath));
  writeFileSync(outPath, rust);
  reportWrite(outPath);
}
