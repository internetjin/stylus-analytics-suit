# Stylus Analytics Suite

[![npm](https://img.shields.io/npm/v/stylus-analytics-suite.svg)](https://www.npmjs.com/package/stylus-analytics-suite)

CLI for analyzing Arbitrum Stylus WASM smart contracts and generating integration code: off-chain TypeScript / ethers.js wrappers for backends and frontends, and Rust `sol_interface!` modules for on-chain Stylus-to-Stylus calls.

## Install

Requires Node 20+.

```bash
npm install -g stylus-analytics-suite
```

Or run it without installing:

```bash
npx stylus-analytics-suite analyze ./target/wasm32-unknown-unknown/release/my_contract.wasm
```

## Quickstart

Point `sas` at a compiled `.wasm` to check it against the Stylus deploy limits:

```console
$ sas analyze ./my_contract.wasm --no-cost
WASM: my_contract.wasm
  version            1
  functions          256
  imports            10
  exports            4
  memory pages       17 (1088 KB)

Size:
  raw                79844 B  (activation cap 131072 B, OK)
  brotli-compressed  21143 B  (deploy cap 24576 B, OK)
  compression ratio  26.5%
  ! Compressed WASM uses 86.0% of the 24576 B deploy budget.
```

Point it at an ABI to check for 4-byte selector collisions (exits non-zero if any are found, so it drops straight into CI):

```console
$ sas collisions ./my_contract.abi.json
ABI: my_contract.abi.json
  functions          12
  unique selectors   11
  collisions         1

  ! selector 0x62018627 matches 2 signatures:
      - f130736()
      - f8491()
```

Then generate integration code from the same ABI:

```bash
sas gen ./my_contract.abi.json               # -> generated/my_contract.ts  (ethers v6, off-chain)
sas export-interface ./my_contract.abi.json  # -> generated/my_contract.rs  (sol_interface!, on-chain)
```

Run `sas` with no arguments for an interactive prompt.

## Commands

| Command | What it does |
| --- | --- |
| `sas analyze <name\|path>` | Parses the WASM header and AST, brotli-compresses the body, checks both sizes against the Stylus deploy / activation caps, and estimates live deployment cost via an Arbitrum RPC. `--no-cost` skips the RPC call. |
| `sas collisions <name\|path>` | Computes the 4-byte selector of every function in the ABI and reports any selector that maps to more than one signature. Exits non-zero on a collision. |
| `sas gen <name\|path>` | Emits a TypeScript module that wraps the contract via ethers v6. Backends / frontends import it, call `attach<Name>(address, runnerOrSigner)`, and get a typed handle with `Promise`-returning read methods and `ContractTransactionResponse`-returning write methods. Writes to `generated/<name>.ts`. |
| `sas export-interface <name\|path>` | Emits a Rust `sol_interface!` module so a **Stylus contract can call this one on-chain** (Stylus-to-Stylus). ABI types map straight to Solidity; `view`/`pure`/`payable` are preserved. `--module <name>` namespaces the interface inside a Rust module. Writes to `generated/<name>.rs`. |
| `sas interactive` | Lists the contracts it can find, lets you pick one and an action, and runs it. Bare `sas` drops into the same wizard. |

Common flags: `--stdout` prints instead of writing a file, `-o <path>` overrides the output path, `--name <I>` renames the generated interface.

## Finding your contracts

Every command takes either an explicit path (anything containing `/`, `\`, `.wasm`, or `.json`) or a bare contract name. Bare names resolve against an artifacts directory — `./artifacts` by default:

```bash
sas analyze erc721        # reads ./artifacts/erc721.wasm
sas collisions erc721     # reads ./artifacts/erc721.abi.json, then ./artifacts/erc721.json
```

Set `SAS_ARTIFACTS_DIR` to point at your own build output, and `SAS_OUT_DIR` to change where generated code lands (default `./generated`).

## Configure

Only `sas analyze` needs network access, and only for the cost estimate. Every other command works entirely offline.

`ARB_RPC_URL` is **optional**. If you don't set it, the cost step falls back to the public endpoint `https://arb1.arbitrum.io/rpc` — so a freshly installed CLI will reach a third-party host on its first `analyze` run unless you say otherwise. `analyze` prints whichever endpoint it used, and marks it `(default)` when the fallback is in play.

To use your own endpoint:

```bash
export ARB_RPC_URL=https://your-endpoint.example/rpc
```

A `.env` file in the working directory works too — see `.env.example`. To skip the network entirely:

```bash
sas analyze ./my_contract.wasm --no-cost
```

## How it works

### `analyze`

- `src/wasm/parse.ts` reads the file, checks the magic header / version, and walks the AST via `@webassemblyjs/wasm-parser` to count functions, imports, exports, and memory pages.
- `src/wasm/size.ts` compresses the raw WASM with brotli at quality 11 (matches the deploy-time compression used by `cargo stylus`) and compares the result against the EIP-170 deploy cap (24,576 B) and the activation cap (128 KB). Both limits are configurable via `--compressed-limit` / `--activation-limit`.
- `src/wasm/cost.ts` builds a real EVM deploy bytecode -- a 14-byte CODECOPY/RETURN stub followed by the Stylus `0xeff000` prefix and the brotli payload -- and asks the configured RPC to `eth_estimateGas` on it, then multiplies by `gasPrice` from `getFeeData()` for an ETH figure.

The cost number covers the EVM CREATE only. The separate `ArbWasm.activateProgram()` transaction is **not** included -- that's its own gas line and depends on memory pages / opcount, which we don't simulate yet.

### `collisions`

- `src/selectors/compute.ts` builds each function's canonical signature (flattening tuple components, preserving tuple array suffixes) and computes `keccak256(sig)[0..4]`.
- `src/selectors/collisions.ts` groups by selector and reports any group with more than one distinct signature. The exit code is 1 if anything collides -- handy for CI.

### `gen`

- `src/codegen/ethers.ts` walks the ABI and emits a TypeScript module targeting **ethers v6** for off-chain (backend / frontend) consumption.
- The generated file exports:
  - `ABI: InterfaceAbi` -- the contract ABI as a JS array literal.
  - `interface I<Name>` -- a typed surface: read methods (`view` / `pure`) return `Promise<T>` where `T` is decoded directly from the ABI types; write methods return `Promise<ContractTransactionResponse>`; payable methods get an optional `overrides?: { value?: bigint }` parameter.
  - `attach<Name>(address, runner)` -- factory that builds an `ethers.Contract` and casts it to the typed interface. `runner` is `Provider | Signer`.
- ABI type mapping: `address` / `string` / `bytes*` → `string`; `bool` → `boolean`; `(u)intN` → `bigint`; arrays → `T[]`; tuples → object types with named fields.
- Constructors, events, fallbacks, and receive functions are dropped from the typed interface (they still live in the embedded ABI for ethers's runtime use).

### `export-interface`

ABI tuple/struct types are emitted as anonymous Solidity tuples (e.g. `(address,uint128)`), which `sol_interface!` accepts directly. The command also reuses the collision analyzer: an ABI with selector collisions, or with overloaded function names that `sol_interface!` would collapse onto one snake_case method (rustc E0592), gets a warning on stderr before the file is written.

## Developing

From a checkout of the source:

```bash
npm install
npm run build
```

Run from source without building — note that npm needs a `--` separator before CLI flags:

```bash
npm run analyze erc721 -- --no-cost
```

### Repo layout

```
contracts/    <-- real Stylus contracts (Rust workspace, three crates)
  erc20/  erc721/  erc1155/
artifacts/    <-- compiled WASM + JSON ABI per contract
  erc20.wasm  erc20.abi.json
  erc721.wasm erc721.abi.json
  erc1155.wasm erc1155.abi.json
generated/    <-- `sas gen` writes ethers.js TS modules here (.ts)
              <-- `sas export-interface` writes Rust sol_interface! modules (.rs)
scripts/
  build-real-fixtures.sh  <-- end-to-end: cargo build → ABI → artifacts/
  sol-to-abi.mjs          <-- converts cargo-stylus's Solidity output to JSON ABI
  inject-collision.mjs    <-- mines a 4-byte collision and appends to an ABI
src/
test/
```

`scripts/build-real-fixtures.sh` rebuilds the three contracts under `contracts/`, copies the WASM into `artifacts/`, exports each ABI to JSON, and injects a pre-mined 4-byte selector collision into the ERC-20 ABI so the collision analyzer has something to flag. Requires `cargo`, `cargo-stylus`, the `wasm32-unknown-unknown` Rust target, and `npm install` in the repo root.

### Tests

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

Without a Rust toolchain, run the suite that doesn't need one — this is also what CI runs on every push, and what `npm publish` runs before it ships anything:

```bash
npm run test:fast     # everything except the Rust compile test
npm run test:compile  # only the Rust compile test
```

`test/compile.test.ts` goes further for the `export-interface` output: it writes the generated `sol_interface!` for the real fixtures (plus a tuple-heavy synthetic ABI) into a throwaway crate and **builds it for `wasm32-unknown-unknown`** — so "it compiles in a Stylus crate" is actually verified, not just string-matched.

The throwaway crate pins `stylus-sdk` to an exact `=x.y.z`, read from the resolved version in the committed `contracts/Cargo.lock`. That's deliberate: taking the caret requirement from `Cargo.toml` instead would let Cargo re-resolve on every run, so an upstream patch release could break the build with no change to this repo. If you bump the SDK, rebuild the lockfile and commit it.

The test skips itself when no `cargo`/wasm32 toolchain is present, so `npm test` degrades gracefully on a machine without Rust. `SAS_SKIP_COMPILE_TEST=1` forces that skip, which is occasionally useful when a toolchain is installed but broken — but prefer `npm run test:fast`, which simply doesn't load the file.

## Roadmap

- **M1–M3** -- WASM analysis, selector-collision detection, TypeScript/ethers codegen. ✅ shipped.
- **M4** -- Stylus Interface Exporter: emit Rust `sol_interface!` blocks so one Stylus contract can call another on-chain. ✅ shipped; output is compile-tested against `stylus-sdk`.
- **M5** -- interactive CLI (`sas interactive`, or bare `sas`). ✅ shipped.
- **M6** -- npm package, install guides, CI. In progress.

Known gaps: `analyze` does not yet model `ArbWasm.activateProgram()` gas, and collision detection is scoped to a single ABI (no cross-contract analysis).

## License

[MIT](./LICENSE)
