import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// The wizard is the one command that reads stdin, so it is the one command that
// can hang a CI job instead of failing it. These tests drive the real binary
// with piped (non-TTY) stdin under a hard timeout: the property under test is
// "always terminates, never blocks", not the exact prompt wording.

const REPO = resolve(__dirname, "..");
// Don't go through node_modules/.bin: on Windows that's a .cmd shim, and since
// the CVE-2024-27980 patch (Node 18.20.2 / 20.12.2) spawnSync refuses to execute
// .bat/.cmd without shell: true and throws EINVAL. Resolving tsx's JS entry and
// running it under the current node binary avoids shims and shells entirely.
const TSX_CLI = require.resolve("tsx/cli");
const CLI = join(REPO, "src", "cli.ts");
const TIMEOUT_MS = 60_000;

const MINIMAL_ABI = [
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }], outputs: [] },
];

function fixtureDirs(): { artifacts: string; out: string } {
  const base = mkdtempSync(join(tmpdir(), "sas-wizard-"));
  const artifacts = join(base, "artifacts");
  const out = join(base, "generated");
  mkdirSync(artifacts);
  mkdirSync(out);
  writeFileSync(join(artifacts, "demo.abi.json"), JSON.stringify(MINIMAL_ABI));
  return { artifacts, out };
}

function runWizard(input: string, dirs: { artifacts: string; out: string }) {
  return spawnSync(process.execPath, [TSX_CLI, CLI, "interactive"], {
    input,
    encoding: "utf8",
    timeout: TIMEOUT_MS,
    env: { ...process.env, SAS_ARTIFACTS_DIR: dirs.artifacts, SAS_OUT_DIR: dirs.out },
  });
}

// A killed-on-timeout process reports signal SIGTERM; asserting on it is what
// distinguishes "hung" from "exited non-zero", which are very different bugs.
function assertTerminated(res: ReturnType<typeof spawnSync>): void {
  assert.equal(res.signal, null, `wizard did not exit within ${TIMEOUT_MS}ms (hung on piped stdin)`);
}

// `sas --version` shipped as 0.1.0 in the 1.0.0 release because the string was
// hardcoded in cli.ts and `npm version` only rewrites package.json. Assert the
// binary reports what the manifest says, so that drift fails the suite instead
// of reaching the registry.
test("cli -- --version matches package.json", () => {
  const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")) as { version: string };
  const res = spawnSync(process.execPath, [TSX_CLI, CLI, "--version"], {
    encoding: "utf8",
    timeout: TIMEOUT_MS,
  });

  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout.trim(), pkg.version);
});

test("interactive -- lists discovered contracts and exits cleanly on piped stdin", () => {
  const dirs = fixtureDirs();
  const res = runWizard("1\n4\n", dirs);

  assertTerminated(res);
  assert.equal(res.status, 0, `expected exit 0, got ${res.status}\n${res.stderr}`);
  assert.match(res.stdout, /demo/, "wizard should list the contract found in the artifacts dir");
});

test("interactive -- exits cleanly when stdin closes mid-prompt", () => {
  const dirs = fixtureDirs();
  // EOF immediately: the wizard must fall through its cancel path rather than
  // waiting forever on a stream that will never produce a line.
  const res = runWizard("", dirs);

  assertTerminated(res);
  assert.equal(res.status, 0, `expected exit 0, got ${res.status}\n${res.stderr}`);
});

test("interactive -- reports an empty artifacts dir instead of prompting", () => {
  const base = mkdtempSync(join(tmpdir(), "sas-wizard-empty-"));
  const res = runWizard("", { artifacts: base, out: base });

  assertTerminated(res);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /No contracts found/i);
});
