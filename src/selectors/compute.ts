import { keccak256, toUtf8Bytes } from "ethers";
import { Abi, AbiFunction, AbiInput } from "../types";

export function canonicalType(input: AbiInput): string {
  if (input.type === "tuple" || input.type.startsWith("tuple")) {
    const inner = (input.components ?? []).map(canonicalType).join(",");
    const suffix = input.type.slice("tuple".length);
    return `(${inner})${suffix}`;
  }
  return input.type;
}

export function functionSignature(fn: AbiFunction): string {
  if (!fn.name) throw new Error("function entry has no name");
  const args = (fn.inputs ?? []).map(canonicalType).join(",");
  return `${fn.name}(${args})`;
}

export function selector(signature: string): string {
  return keccak256(toUtf8Bytes(signature)).slice(0, 10); // "0x" + 8 hex chars
}

export type ResolvedSelector = {
  signature: string;
  selector: string;
  fn: AbiFunction;
};

export function resolveSelectors(abi: Abi): ResolvedSelector[] {
  const out: ResolvedSelector[] = [];
  for (const entry of abi) {
    if (entry.type === "function" && entry.name) {
      const sig = functionSignature(entry);
      out.push({ signature: sig, selector: selector(sig), fn: entry });
    }
  }
  return out;
}
