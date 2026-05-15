import { readFileSync } from "node:fs";
import { decode } from "@webassemblyjs/wasm-parser";

export type WasmSummary = {
  rawSize: number;
  magicValid: boolean;
  version: number;
  numFunctions: number;
  numImports: number;
  numExports: number;
  exports: { name: string; kind: string }[];
  imports: { module: string; name: string; kind: string }[];
  memoryPages?: number;
};

export function readWasm(path: string): Buffer {
  return readFileSync(path);
}

export function parseWasm(bytes: Buffer): WasmSummary {
  if (bytes.length < 8) {
    throw new Error(`File too small to be WASM: ${bytes.length} bytes`);
  }
  const magicValid =
    bytes[0] === 0x00 &&
    bytes[1] === 0x61 &&
    bytes[2] === 0x73 &&
    bytes[3] === 0x6d;
  const version = bytes.readUInt32LE(4);

  const exports: WasmSummary["exports"] = [];
  const imports: WasmSummary["imports"] = [];
  let numFunctions = 0;
  let memoryPages: number | undefined;

  if (magicValid) {
    let ast: unknown;
    try {
      ast = decode(bytes, {});
    } catch (err) {
      throw new Error(`failed to decode WASM: ${(err as Error).message}`);
    }
    walkAst(ast, (node: any) => {
      switch (node?.type) {
        case "ModuleExport":
          exports.push({
            name: String(node.name ?? ""),
            kind: String(node.descr?.exportType ?? "unknown"),
          });
          break;
        case "ModuleImport":
          imports.push({
            module: String(node.module ?? ""),
            name: String(node.name ?? ""),
            kind: String(node.descr?.type ?? "unknown"),
          });
          break;
        case "Func":
          numFunctions++;
          break;
        case "Memory":
          if (typeof node.limits?.min === "number") memoryPages = node.limits.min;
          break;
      }
    });
  }

  return {
    rawSize: bytes.length,
    magicValid,
    version,
    numFunctions,
    numImports: imports.length,
    numExports: exports.length,
    exports,
    imports,
    memoryPages,
  };
}

function walkAst(node: any, visit: (n: any) => void): void {
  if (!node || typeof node !== "object") return;
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === "loc") continue;
    const v = node[key];
    if (Array.isArray(v)) {
      for (const item of v) walkAst(item, visit);
    } else if (v && typeof v === "object") {
      walkAst(v, visit);
    }
  }
}
