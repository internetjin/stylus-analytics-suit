#!/usr/bin/env bash
# Build the three Stylus contracts under contracts/, copy their WASM into
# artifacts/, export each ABI to JSON, and inject a mined 4-byte selector
# collision into the erc20 ABI so the M2 demo has something to flag.
#
#   ./scripts/build-real-fixtures.sh
#
# Requires: cargo, rustup, cargo-stylus, node + npm install in the repo root.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTRACTS="$ROOT/contracts"
ARTIFACTS="$ROOT/artifacts"
WASM_OUT="$CONTRACTS/target/wasm32-unknown-unknown/release"

mkdir -p "$ARTIFACTS"

# Redact local filesystem paths that rustc otherwise embeds in panic metadata
# and debug strings. Without this, the compiled WASM leaks the builder's
# $HOME and cargo registry paths.
export RUSTFLAGS="${RUSTFLAGS:-} --remap-path-prefix=$HOME/.cargo=/cargo --remap-path-prefix=$HOME=/home --remap-path-prefix=$CONTRACTS=."

build_contract() {
  local name="$1"
  echo ""
  echo "=== $name: cargo build --lib (release, wasm32) ==="
  (cd "$CONTRACTS" && cargo build --release --target wasm32-unknown-unknown --lib -p "$name" 2>&1 | tail -3)

  echo "=== $name: copy WASM → artifacts/$name.wasm ==="
  cp "$WASM_OUT/$name.wasm" "$ARTIFACTS/$name.wasm"

  echo "=== $name: cargo stylus export-abi → artifacts/$name.abi.json ==="
  (cd "$CONTRACTS/$name" && cargo stylus export-abi 2>/dev/null) \
    | node "$ROOT/scripts/sol-to-abi.mjs" \
    > "$ARTIFACTS/$name.abi.json"
}

build_contract erc20
build_contract erc721
build_contract erc1155

echo ""
echo "=== erc20: inject mined selector collision into ABI ==="
node "$ROOT/scripts/inject-collision.mjs" "$ARTIFACTS/erc20.abi.json"

echo ""
echo "=== summary ==="
for n in erc20 erc721 erc1155; do
  wasm_size=$(wc -c < "$ARTIFACTS/$n.wasm" | tr -d ' ')
  abi_fns=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$ARTIFACTS/$n.abi.json','utf8')).filter(e=>e.type==='function').length)")
  printf "  %-8s  %s B wasm   %s ABI functions\n" "$n" "$wasm_size" "$abi_fns"
done
