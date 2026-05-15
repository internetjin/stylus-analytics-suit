import { formatEther, JsonRpcProvider } from "ethers";

const STYLUS_MAGIC = Buffer.from("eff000", "hex");

export type CostReport = {
  compressedSize: number;
  estimatedDeployGas: bigint;
  gasPriceWei: bigint;
  deployCostWei: bigint;
  deployCostEth: string;
  source: "rpc-estimate" | "static-formula";
  notes: string[];
};

export function buildDeployBytecode(compressed: Buffer): string {
  const runtime = Buffer.concat([STYLUS_MAGIC, compressed]);
  const runtimeLen = runtime.length;
  if (runtimeLen > 0xffff) {
    // Beyond a 2-byte PUSH; if you hit this, the contract is already past the deploy cap.
    throw new Error(
      `runtime bytecode (${runtimeLen} B) is too large for the 2-byte init-stub encoding; it cannot deploy regardless.`
    );
  }

  const hi = (runtimeLen >> 8) & 0xff;
  const lo = runtimeLen & 0xff;
  const stub = Buffer.from([
    0x61, hi, lo, // PUSH2 runtimeLen
    0x60, 0x0e,   // PUSH1 14 (offset to runtime in init bytecode = stub length)
    0x60, 0x00,   // PUSH1 0  (mem dest)
    0x39,         // CODECOPY
    0x61, hi, lo, // PUSH2 runtimeLen
    0x60, 0x00,   // PUSH1 0
    0xf3,         // RETURN
  ]);

  return "0x" + Buffer.concat([stub, runtime]).toString("hex");
}

export async function estimateDeploymentCost(
  compressed: Buffer,
  provider: JsonRpcProvider
): Promise<CostReport> {
  const notes: string[] = [];
  const deployBytecode = buildDeployBytecode(compressed);

  let gas: bigint;
  let source: CostReport["source"];
  try {
    gas = await provider.estimateGas({ data: deployBytecode });
    source = "rpc-estimate";
  } catch (err) {
    const codeDepositGas = BigInt(200 * (STYLUS_MAGIC.length + compressed.length));
    gas = 21_000n + 32_000n + codeDepositGas;
    source = "static-formula";
    notes.push(
      `RPC estimateGas failed (${(err as Error).message}). Fell back to a static G_codedeposit formula.`
    );
  }

  const fee = await provider.getFeeData();
  const gasPriceWei = fee.gasPrice ?? fee.maxFeePerGas ?? 0n;
  const deployCostWei = gas * gasPriceWei;

  notes.push(
    "Cost covers the EVM CREATE only. The separate ArbWasm.activateProgram() transaction is not included."
  );

  return {
    compressedSize: compressed.length,
    estimatedDeployGas: gas,
    gasPriceWei,
    deployCostWei,
    deployCostEth: formatEther(deployCostWei),
    source,
    notes,
  };
}
