#!/usr/bin/env node
import { Command } from "commander";

import { runAnalyze, runCollisions, runGen, runExport } from "./commands";
import { runWizard } from "./interactive";

// Read the version from package.json rather than repeating it here: `npm version`
// only rewrites package.json, so a hardcoded string silently drifts and ships a
// CLI that misreports itself. Plain require (not an import) keeps package.json
// outside tsc's rootDir while resolving identically from src/ and dist/.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { version } = require("../package.json") as { version: string };

const program = new Command();
program
  .name("sas")
  .description("Stylus Analytics Suite -- WASM analysis and Stylus codegen")
  .version(version);

program
  .command("analyze")
  .description("M1 -- WASM size validation + live-RPC deployment cost estimate")
  .argument("<name|path>", "contract name (resolved against artifacts/) or explicit .wasm path")
  .option("--no-cost", "skip the live RPC cost estimate")
  .option("--compressed-limit <bytes>", "override compressed deploy limit", (v) => parseInt(v, 10))
  .option("--activation-limit <bytes>", "override activation size limit", (v) => parseInt(v, 10))
  .action((arg: string, opts: { cost: boolean; compressedLimit?: number; activationLimit?: number }) =>
    runAnalyze(arg, opts),
  );

program
  .command("collisions")
  .description("M2 -- detect 4-byte selector collisions inside a single ABI")
  .argument("<name|path>", "contract name (resolved against artifacts/) or explicit ABI path")
  .action((arg: string) => runCollisions(arg));

program
  .command("gen")
  .description("M3 -- emit a TypeScript ethers.js module for off-chain (backend/frontend) interaction")
  .argument("<name|path>", "contract name (resolved against artifacts/) or explicit ABI path")
  .option("--name <interfaceName>", "name for the generated TS interface (default: I<ContractName>)")
  .option("--contract <contractName>", "override the contract name embedded in the header / attach helper")
  .option("-o, --out <path>", "write to this path instead of generated/<name>.ts")
  .option("--stdout", "print to stdout instead of writing a file")
  .action((arg: string, opts: { name?: string; contract?: string; out?: string; stdout?: boolean }) =>
    runGen(arg, opts),
  );

program
  .command("export-interface")
  .description("M4 -- emit a Rust sol_interface! module for Stylus-to-Stylus (on-chain) calls")
  .argument("<name|path>", "contract name (resolved against artifacts/) or explicit ABI path")
  .option("--name <interfaceName>", "name for the generated Rust interface (default: I<ContractName>)")
  .option("--module <modName>", "wrap the interface in a Rust module for namespacing")
  .option("--contract <contractName>", "override the contract name embedded in the header")
  .option("-o, --out <path>", "write to this path instead of generated/<name>.rs")
  .option("--stdout", "print to stdout instead of writing a file")
  .action((arg: string, opts: { name?: string; module?: string; contract?: string; out?: string; stdout?: boolean }) =>
    runExport(arg, opts),
  );

program
  .command("interactive")
  .description("M5 -- interactive prompt to pick a contract and an action")
  .action(() => runWizard());

// Top-level guard: surface any rejection and exit non-zero rather than letting
// it become an unhandledRejection (which Node may not flag with a clean status).
function fail(err: unknown): never {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

// No subcommand -> drop into the interactive wizard.
if (process.argv.length <= 2) {
  runWizard().catch(fail);
} else {
  program.parseAsync(process.argv).catch(fail);
}
