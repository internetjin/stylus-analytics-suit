# Stylus Analytics Suite

CLI for analyzing Arbitrum Stylus WASM smart contracts and generating integration code: off-chain TypeScript / ethers.js wrappers for backends and frontends, and Rust `sol_interface!` modules for on-chain Stylus-to-Stylus calls.

> **Status**: in development. Milestones **1–5** of a six-milestone roadmap are implemented (WASM analysis, collision detection, TypeScript codegen, Stylus-to-Stylus interface export, and the interactive CLI). M6 (npm publish + final docs/report) remains.

## Project layout

```
contracts/    <-- real Stylus contracts (Rust workspace, three crates)
  erc20/  erc721/  erc1155/
artifacts/    <-- compiled WASM + JSON ABI per contract
  erc20.wasm  erc20.abi.json
  erc721.wasm erc721.abi.json
  erc1155.wasm erc1155.abi.json
generated/    <-- `npm run gen` writes ethers.js TS modules here (.ts)
              <-- `npm run export-interface` writes Rust sol_interface! modules (.rs)
  erc1155.ts  erc20.rs
scripts/
  build-real-fixtures.sh  <-- end-to-end: cargo build → ABI → artifacts/
  sol-to-abi.mjs          <-- converts cargo-stylus's Solidity output to JSON ABI
  inject-collision.mjs    <-- mines a 4-byte collision and appends to an ABI
src/
test/
```

`scripts/build-real-fixtures.sh` rebuilds the three contracts under `contracts/`, copies the WASM into `artifacts/`, exports each ABI to JSON, and injects a pre-mined 4-byte selector collision into the ERC-20 ABI so M2 has something to flag. Requires `cargo`, `cargo-stylus`, the `wasm32-unknown-unknown` Rust target, and `npm install` in the repo root.

For each contract, the CLI looks up `artifacts/<name>.wasm` and `artifacts/<name>.abi.json` by bare name. Explicit file paths (anything containing `/`, `\`, `.wasm`, or `.json`) work too. Override folder locations with `SAS_ARTIFACTS_DIR` and `SAS_OUT_DIR`.

## Commands

Each feature is its own npm script. Pass the contract name (or an explicit file path) as the next argument:

| Command | Milestone | What it does |
| --- | --- | --- |
| `npm run analyze <name\|path>` | M1 | Parses the WASM header and AST, brotli-compresses the body, checks both sizes against the Stylus deploy / activation caps, and estimates live deployment cost via an Arbitrum RPC. Resolves `artifacts/<name>.wasm` for bare names. |
| `npm run collisions <name\|path>` | M2 | Computes the 4-byte selector of every function in the ABI and reports any selector that maps to more than one signature. Exits non-zero on a collision. Resolves `artifacts/<name>.abi.json` (then `<name>.json`) for bare names. |
| `npm run gen <name\|path>` | M3 | Emits a TypeScript module that wraps the contract via ethers.js. Backends / frontends import it, call `attach<Name>(address, runnerOrSigner)`, and get a typed handle with `Promise`-returning read methods and `ContractTransactionResponse`-returning write methods. Writes to `generated/<name>.ts` by default. |
| `npm run export-interface <name\|path>` | M4 | Emits a Rust `sol_interface!` module so a **Stylus contract can call this one on-chain** (Stylus-to-Stylus). ABI types map straight to Solidity; `view`/`pure`/`payable` are preserved. Use `--module <name>` to namespace the interface inside a Rust module. Writes to `generated/<name>.rs` by default. |
| `npm run interactive` | M5 | Interactive prompt: lists the contracts in `artifacts/`, lets you pick one and an action (analyze / collisions / gen / export-interface), and runs it. Running `sas` with no subcommand drops into the same wizard. |

Flags (e.g. `--no-cost`, `-o <path>`, `--stdout`, `--module <name>`) need to come after a `--` separator so npm doesn't intercept them: `npm run analyze erc721 -- --no-cost`.

## Install

Requires Node 20+.

```bash
npm install
npm run build
```

You can also run straight from source without building:

```bash
npm run analyze ./path/to/contract.wasm
```

## Configure

```bash
cp .env.example .env
# edit .env:
#   ARB_RPC_URL=https://arb1.arbitrum.io/rpc
```

`ARB_RPC_URL` is only needed for `npm run analyze` when running the cost step. `collisions` and `gen` work entirely offline.

## How each milestone is wired

### M1 -- `npm run analyze`

- `src/wasm/parse.ts` reads the file, checks the magic header / version, and walks the AST via `@webassemblyjs/wasm-parser` to count functions, imports, exports, and memory pages.
- `src/wasm/size.ts` compresses the raw WASM with brotli at quality 11 (matches the deploy-time compression used by `cargo stylus`) and compares the result against the EIP-170 deploy cap (24,576 B) and the activation cap (128 KB). Both limits are configurable via `--compressed-limit` / `--activation-limit`.
- `src/wasm/cost.ts` builds a real EVM deploy bytecode -- a 14-byte CODECOPY/RETURN stub followed by the Stylus `0xeff000` prefix and the brotli payload -- and asks the configured RPC to `eth_estimateGas` on it, then multiplies by `gasPrice` from `getFeeData()` for an ETH figure.

The cost number covers the EVM CREATE only. The separate `ArbWasm.activateProgram()` transaction is **not** included -- that's its own gas line and depends on memory pages / opcount, which we don't simulate yet.

### M2 -- `npm run collisions`

- `src/selectors/compute.ts` builds each function's canonical signature (flattening tuple components, preserving tuple array suffixes) and computes `keccak256(sig)[0..4]`.
- `src/selectors/collisions.ts` groups by selector and reports any group with more than one distinct signature. The exit code is 1 if anything collides -- handy for CI.

### M3 -- `npm run gen`

- `src/codegen/ethers.ts` walks the ABI and emits a TypeScript module targeting **ethers v6** for off-chain (backend / frontend) consumption.
- The generated file exports:
  - `ABI: InterfaceAbi` -- the contract ABI as a JS array literal.
  - `interface I<Name>` -- a typed surface: read methods (`view` / `pure`) return `Promise<T>` where `T` is decoded directly from the ABI types; write methods return `Promise<ContractTransactionResponse>`; payable methods get an optional `overrides?: { value?: bigint }` parameter.
  - `attach<Name>(address, runner)` -- factory that builds an `ethers.Contract` and casts it to the typed interface. `runner` is `Provider | Signer`.
- ABI type mapping: `address` / `string` / `bytes*` → `string`; `bool` → `boolean`; `(u)intN` → `bigint`; arrays → `T[]`; tuples → object types with named fields.
- Constructors, events, fallbacks, and receive functions are dropped from the typed interface (they still live in the embedded ABI for ethers's runtime use).

For the **on-chain** counterpart — generating a Rust `sol_interface!` so one Stylus contract can call another — see the `export-interface` command (M4) above. ABI tuple/struct types are emitted as anonymous Solidity tuples (e.g. `(address,uint128)`), which `sol_interface!` accepts directly; `test/compile.test.ts` builds the generated output against `stylus-sdk` to prove it compiles.

## Tests

```bash
npm test
```

Uses Node 20's built-in `node:test` via `tsx`. Coverage:

- known ERC-20 selectors round-trip,
- collision detection groups distinct signatures that share a selector,
- ethers TS generator splits read vs. write returns, threads payable overrides, maps array / tuple types,
- Stylus `sol_interface!` generator maps mutability, returns, array/tuple types (single-element tuples get the required trailing comma), and `--module` namespacing,
- minimal WASM header / magic checks,
- size analyzer flags over-cap compressed payloads,
- deploy bytecode begins with the 14-byte init stub and embeds the Stylus magic prefix in the right offset.

`test/compile.test.ts` goes further for the M4 output: it writes the generated `sol_interface!` for the real fixtures (plus a tuple-heavy synthetic ABI) into a throwaway crate and **builds it for `wasm32-unknown-unknown` against the pinned `stylus-sdk`** — so "it compiles in a Stylus crate" is actually verified, not just string-matched. It runs as part of `npm test` when a Rust/`cargo`/wasm32 toolchain is present and skips otherwise; run it explicitly with `npm run test:compile`, or skip it with `SAS_SKIP_COMPILE_TEST=1`.

## Roadmap

- **M1–M3** -- WASM analysis, selector-collision detection, TypeScript/ethers codegen. ✅ shipped.
- **M4** -- Stylus Interface Exporter: emit Rust `sol_interface!` blocks so one Stylus contract can call another on-chain. ✅ shipped (`export-interface`); output is compile-tested against `stylus-sdk`.
- **M5** -- interactive CLI (`interactive`, or bare `sas`). ✅ shipped.
- **M6** -- NPM package, install guides, final docs/report. (remaining)
