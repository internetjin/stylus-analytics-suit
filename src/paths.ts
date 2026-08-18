import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

const ARTIFACT_EXT = /\.(wasm|json)$/i;

export function getArtifactsDir(): string {
  return process.env.SAS_ARTIFACTS_DIR ?? resolve(process.cwd(), "artifacts");
}

export function getGeneratedDir(): string {
  return process.env.SAS_OUT_DIR ?? resolve(process.cwd(), "generated");
}

export function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

function isPathLike(s: string): boolean {
  return (
    s.includes("/") ||
    s.includes("\\") ||
    isAbsolute(s) ||
    ARTIFACT_EXT.test(s)
  );
}

export function resolveWasmInput(arg: string, artifactsDir = getArtifactsDir()): string {
  if (isPathLike(arg)) return resolve(arg);
  return join(artifactsDir, `${arg}.wasm`);
}

export function resolveAbiInput(arg: string, artifactsDir = getArtifactsDir()): string {
  if (isPathLike(arg)) return resolve(arg);
  const dotAbi = join(artifactsDir, `${arg}.abi.json`);
  if (existsSync(dotAbi)) return dotAbi;
  return join(artifactsDir, `${arg}.json`);
}

// The resolvers above are pure path math — they never touch the disk, so a
// missing file surfaces later as a raw ENOENT from the reader. That reads badly
// for the common install-from-npm case, where there is no artifacts/ dir at all
// and a bare name has nowhere to resolve to. Call this after resolving to turn
// that into an actionable message.
export function assertInputExists(
  resolvedPath: string,
  arg: string,
  kind: "WASM" | "ABI",
  artifactsDir = getArtifactsDir(),
): void {
  if (existsSync(resolvedPath)) return;

  if (isPathLike(arg)) {
    throw new Error(`no ${kind} file at ${resolvedPath}`);
  }

  const hint = existsSync(artifactsDir)
    ? `No ${kind} for "${arg}" in ${artifactsDir}.`
    : `No artifacts directory at ${artifactsDir}.`;
  throw new Error(
    `${hint}\n` +
      `Pass an explicit path (e.g. \`sas ${kind === "WASM" ? "analyze" : "gen"} ./path/to/contract.${kind === "WASM" ? "wasm" : "abi.json"}\`), ` +
      `or point SAS_ARTIFACTS_DIR at the directory holding your build output.`,
  );
}

export function defaultGenOutputPath(arg: string, outDir = getGeneratedDir()): string {
  const stem = arg
    .replace(/^.*[\\/]/, "")
    .replace(/\.(abi\.json|json|wasm)$/i, "");
  return join(outDir, `${stem}.ts`);
}

// M4: Stylus interface export defaults to generated/<name>.rs
export function defaultExportOutputPath(arg: string, outDir = getGeneratedDir()): string {
  const stem = arg
    .replace(/^.*[\\/]/, "")
    .replace(/\.(abi\.json|json|wasm)$/i, "");
  return join(outDir, `${stem}.rs`);
}

export function deriveContractName(arg: string): string {
  return arg.replace(/^.*[\\/]/, "").replace(/\.(abi\.json|json|wasm)$/i, "");
}

// Bare contract names discovered in the artifacts dir (from .wasm / .abi.json /
// .json files), de-duplicated and sorted — used to populate the interactive menu.
export function listArtifactContracts(artifactsDir = getArtifactsDir()): string[] {
  let entries: string[];
  try {
    entries = readdirSync(artifactsDir);
  } catch {
    return [];
  }
  const names = new Set<string>();
  for (const f of entries) {
    const m = f.match(/^(.+?)\.(?:abi\.json|json|wasm)$/i);
    if (m) names.add(m[1]);
  }
  return [...names].sort();
}
