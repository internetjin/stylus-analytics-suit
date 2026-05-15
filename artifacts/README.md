# artifacts/

Compiled Stylus contract artifacts. The CLI looks up bare contract names from this folder.

The three files checked in (`erc20`, `erc721`, `erc1155`) are produced by `scripts/build-real-fixtures.sh`, which compiles the Rust crates under `../contracts/` with `cargo build --release --target wasm32-unknown-unknown --lib` and exports each ABI via `cargo stylus export-abi`.

## Layout

For a contract named `myToken`, place either or both of:

- `myToken.wasm` -- the compiled WASM produced by `cargo build --release --target wasm32-unknown-unknown` (under your Stylus project's `target/wasm32-unknown-unknown/release/`).
- `myToken.abi.json` -- the ABI JSON produced by `cargo stylus export-abi --json` (or any equivalent ABI array / Hardhat-Foundry artifact wrapper).

The `.abi.json` extension is preferred. A bare `.json` is also accepted as a fallback.

## How the CLI resolves inputs

| Invocation                          | Resolves to                       |
| ----------------------------------- | --------------------------------- |
| `sas analyze myToken`               | `artifacts/myToken.wasm`          |
| `sas collisions myToken`            | `artifacts/myToken.abi.json`      |
| `sas gen myToken`                   | `artifacts/myToken.abi.json` → `generated/myToken.ts` |
| `sas analyze ./elsewhere/foo.wasm`  | literal path (anything with a `/`, `\`, or `.wasm`/`.json` suffix is treated as a path) |

Override the folder location with `SAS_ARTIFACTS_DIR` or by passing an explicit path.
