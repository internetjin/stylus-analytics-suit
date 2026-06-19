import { createInterface, type Interface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { listArtifactContracts } from "./paths";
import { runAnalyze, runCollisions, runGen, runExport } from "./commands";

// Resolves to the answer, or null if stdin reaches EOF (Ctrl-D) while we wait.
// `rl.question` never resolves on a closed stream, so race it against `close`.
function question(rl: Interface, prompt: string): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const onClose = () => {
      if (settled) return;
      settled = true;
      resolve(null);
    };
    rl.once("close", onClose);
    rl.question(prompt).then(
      (ans) => {
        if (settled) return;
        settled = true;
        rl.removeListener("close", onClose);
        resolve(ans);
      },
      () => onClose(),
    );
  });
}

// Loop until the user enters a valid 1..count choice. Returns null on EOF so the
// caller can exit cleanly instead of hanging forever on a closed stdin.
async function askIndex(rl: Interface, count: number): Promise<number | null> {
  for (;;) {
    const raw = await question(rl, "> ");
    if (raw === null) return null;
    const n = Number.parseInt(raw.trim(), 10);
    if (Number.isInteger(n) && n >= 1 && n <= count) return n - 1;
    console.log(`Please enter a number between 1 and ${count}.`);
  }
}

const ACTIONS = [
  { key: "analyze", label: "analyze (M1) — WASM size + deployment cost" },
  { key: "collisions", label: "collisions (M2) — 4-byte selector clashes" },
  { key: "gen", label: "gen (M3) — TypeScript / ethers.js wrapper" },
  { key: "export-interface", label: "export-interface (M4) — Rust sol_interface!" },
] as const;

// M5 -- interactive prompt: pick a contract from artifacts/, pick an action, run it.
export async function runWizard(): Promise<void> {
  const contracts = listArtifactContracts();
  if (contracts.length === 0) {
    console.log("No contracts found in the artifacts directory.");
    console.log("Set SAS_ARTIFACTS_DIR, or pass a name/path to a command directly (e.g. `sas analyze <path>`).");
    return;
  }

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    console.log("Stylus Analytics Suite — interactive\n");

    console.log("Select a contract:");
    contracts.forEach((c, i) => console.log(`  ${i + 1}) ${c}`));
    const contractIdx = await askIndex(rl, contracts.length);
    if (contractIdx === null) return cancelled();
    const contract = contracts[contractIdx];

    console.log("\nSelect an action:");
    ACTIONS.forEach((a, i) => console.log(`  ${i + 1}) ${a.label}`));
    const actionIdx = await askIndex(rl, ACTIONS.length);
    if (actionIdx === null) return cancelled();
    const action = ACTIONS[actionIdx].key;

    console.log();
    switch (action) {
      case "analyze":
        await runAnalyze(contract, { cost: true });
        break;
      case "collisions":
        runCollisions(contract);
        break;
      case "gen":
        runGen(contract, {});
        break;
      case "export-interface":
        runExport(contract, {});
        break;
    }

    // The commands set `process.exitCode = 1` for CI use (collisions found, bad
    // WASM magic). In an interactive browse that's a side effect we don't want —
    // a normal session should exit 0 regardless of what was inspected.
    process.exitCode = 0;
  } finally {
    rl.close();
  }
}

function cancelled(): void {
  console.log("\nCancelled.");
}
