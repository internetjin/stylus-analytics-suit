import { readFileSync } from "node:fs";
import { Abi } from "../types";

export function loadAbi(path: string): Abi {
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) return parsed as Abi;
  if (parsed && Array.isArray(parsed.abi)) return parsed.abi as Abi;
  throw new Error(
    `ABI at ${path} is neither a JSON array nor an object with an "abi" array (got keys: ${Object.keys(parsed ?? {}).join(", ") || "<none>"}).`
  );
}
