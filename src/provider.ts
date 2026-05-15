import { JsonRpcProvider } from "ethers";
import { loadConfig } from "./config";

let cached: JsonRpcProvider | null = null;

export function getProvider(): JsonRpcProvider {
  if (cached) return cached;
  const { rpcUrl } = loadConfig();
  cached = new JsonRpcProvider(rpcUrl);
  return cached;
}
