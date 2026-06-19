import { Abi, AbiFunction, AbiInput, AbiOutput } from "../types";

export type StylusCodegenOptions = {
  interfaceName: string;
  contractName: string;
  // optional Rust module to wrap the interface in, for namespacing when several
  // generated interfaces live in one crate
  module?: string;
};

// Solidity reserved words we must not emit as bare parameter identifiers.
const SOL_RESERVED = new Set([
  "address", "bool", "string", "bytes", "int", "uint", "mapping", "function",
  "memory", "calldata", "storage", "external", "internal", "public", "private",
  "view", "pure", "payable", "returns", "return", "interface", "contract",
  "library", "this", "super", "new", "delete", "emit", "event", "struct",
  "enum", "modifier", "constructor", "fallback", "receive",
]);

function solIdent(name: string | undefined, idx: number): string {
  if (!name || name.length === 0) return `arg${idx}`;
  let cleaned = name.replace(/[^A-Za-z0-9_]/g, "_");
  if (/^[0-9]/.test(cleaned)) cleaned = `_${cleaned}`;
  if (SOL_RESERVED.has(cleaned)) cleaned = `${cleaned}_`;
  return cleaned;
}

function pascalCase(s: string): string {
  return s
    .replace(/[^A-Za-z0-9]+(.)/g, (_, c: string) => c.toUpperCase())
    .replace(/^[a-z]/, (c) => c.toUpperCase());
}

// `external` mutability suffix; nonpayable / unspecified emit nothing.
function mutabilityKeyword(fn: AbiFunction): string {
  switch (fn.stateMutability) {
    case "view": return " view";
    case "pure": return " pure";
    case "payable": return " payable";
    default: return "";
  }
}

// Render an ABI type as a Solidity type for the `sol_interface!` macro.
// ABI tuple/struct types become anonymous Solidity tuples, e.g. (address,uint128),
// which the macro accepts in params, returns, arrays, and nested (verified by
// test/compile.test.ts). This differs from `canonicalType` (used for M2 selector
// math) in ONE way: `sol!` requires a trailing comma on a single-element tuple —
// `(uint256,)` — to disambiguate it from parenthesized grouping. The ABI selector
// form has no such comma, which is why this is a separate renderer.
function solType(io: AbiInput | AbiOutput): string {
  if (io.type === "tuple" || io.type.startsWith("tuple")) {
    const comps = io.components ?? [];
    const inner = comps.map(solType).join(",");
    const body = comps.length === 1 ? `${inner},` : inner;
    const suffix = io.type.slice("tuple".length); // "" | "[]" | "[N]"
    return `(${body})${suffix}`;
  }
  return io.type;
}

function renderParams(inputs: AbiInput[] | undefined): string {
  return (inputs ?? [])
    .map((input, idx) => `${solType(input)} ${solIdent(input.name, idx)}`)
    .join(", ");
}

function renderReturns(outputs: AbiOutput[] | undefined): string {
  if (!outputs || outputs.length === 0) return "";
  return ` returns (${outputs.map(solType).join(", ")})`;
}

/**
 * Names shared by more than one `function` entry in the ABI (Solidity overloads).
 *
 * `sol_interface!` lowers every method to its snake_case form, so two functions
 * with the same name but different parameters (e.g. ERC-721 / ERC-1155
 * `safeTransferFrom` with and without `bytes data`) collapse onto a single Rust
 * method name and the crate fails to compile with E0592 ("duplicate definitions").
 * Unlike a 4-byte selector collision (M2), an overload has a *distinct* selector,
 * so it is invisible to `detectCollisions` — it needs its own check.
 */
export function overloadedFunctionNames(abi: Abi): string[] {
  const counts = new Map<string, number>();
  for (const entry of abi) {
    if (entry.type !== "function" || !entry.name) continue;
    counts.set(entry.name, (counts.get(entry.name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, n]) => n > 1)
    .map(([name]) => name)
    .sort();
}

/**
 * Generate a Rust `sol_interface!` module so a Stylus contract can call
 * `contractName` on-chain (Stylus-to-Stylus). ABI types are already Solidity
 * types, so they map straight through; `view`/`pure`/`payable` are preserved.
 */
export function generateStylusInterface(abi: Abi, opts: StylusCodegenOptions): string {
  const lines: string[] = [];

  for (const entry of abi) {
    if (entry.type !== "function" || !entry.name) continue;
    lines.push(
      `        function ${entry.name}(${renderParams(entry.inputs)}) external${mutabilityKeyword(entry)}${renderReturns(entry.outputs)};`,
    );
  }

  // Overloaded names collapse onto a single snake_case Rust method and break
  // compilation (E0592). Surface it in the file itself so the breakage is never
  // silent, even when the generator's stderr warning is missed (e.g. --stdout).
  const overloads = overloadedFunctionNames(abi);
  const overloadNote = overloads.length === 0 ? "" :
`//
// !! WARNING: overloaded function name(s): ${overloads.join(", ")}.
// !! sol_interface! lowers each to the same snake_case method, so this file will
// !! NOT compile as-is (rustc E0592: duplicate definitions). Remove or rename one
// !! side of each overload before using it.
`;

  let block =
`sol_interface! {
    interface ${opts.interfaceName} {
${lines.join("\n")}
    }
}`;

  // Optionally namespace the interface inside a Rust module.
  let useLine = "use stylus_sdk::prelude::*;\n\n";
  if (opts.module) {
    const indented = block
      .split("\n")
      .map((l) => (l.length > 0 ? `    ${l}` : l))
      .join("\n");
    block = `pub mod ${opts.module} {\n    use stylus_sdk::prelude::*;\n\n${indented}\n}`;
    useLine = "";
  }

  return `// Auto-generated by Stylus Analytics Suite. Do not edit by hand.
// Source contract: ${opts.contractName}
${overloadNote}//
// Stylus-to-Stylus interface. Import these declarations into a Stylus contract
// to call \`${opts.contractName}\` on-chain:
//
//   let other = ${opts.interfaceName}::new(target_address);
//   // Each method takes a stylus-sdk call context as its first argument; consult
//   // the stylus-sdk \`sol_interface!\` docs for the exact form for your SDK version.
//   let value = other.some_view(self /* call context */)?;
//   other.some_write(self /* call context */, arg)?;
//
// Method names are the snake_case form of the Solidity functions below.
${useLine}${block}
`;
}
