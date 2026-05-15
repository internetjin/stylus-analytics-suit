import "dotenv/config";

export type Config = { rpcUrl: string };

export function loadConfig(): Config {
  return {
    rpcUrl: process.env.ARB_RPC_URL ?? "https://arb1.arbitrum.io/rpc",
  };
}
