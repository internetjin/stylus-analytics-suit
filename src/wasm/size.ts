import { brotliCompressSync, constants } from "node:zlib";

export const ARBITRUM_COMPRESSED_LIMIT = 24576; // EIP-170 contract-code cap, applies to brotli-compressed Stylus runtime bytecode
export const ARBITRUM_ACTIVATION_LIMIT = 128 * 1024; // uncompressed WASM cap enforced at activation

export type SizeReport = {
  rawSize: number;
  compressedSize: number;
  compressionRatio: number;
  fitsCompressed: boolean;
  fitsActivated: boolean;
  compressedLimit: number;
  activationLimit: number;
  warnings: string[];
};

export function brotliMaxCompress(bytes: Buffer): Buffer {
  return brotliCompressSync(bytes, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
      [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_GENERIC,
    },
  });
}

export function analyzeSize(
  rawBytes: Buffer,
  opts?: { compressedLimit?: number; activationLimit?: number }
): SizeReport {
  const compressedLimit = opts?.compressedLimit ?? ARBITRUM_COMPRESSED_LIMIT;
  const activationLimit = opts?.activationLimit ?? ARBITRUM_ACTIVATION_LIMIT;

  const compressed = brotliMaxCompress(rawBytes);
  const compressedSize = compressed.length;
  const rawSize = rawBytes.length;

  const fitsCompressed = compressedSize <= compressedLimit;
  const fitsActivated = rawSize <= activationLimit;

  const warnings: string[] = [];
  if (!fitsCompressed) {
    warnings.push(
      `Compressed WASM (${compressedSize} B) exceeds the deploy cap (${compressedLimit} B). Contract cannot be deployed as-is.`
    );
  } else if (compressedSize > compressedLimit * 0.8) {
    warnings.push(
      `Compressed WASM uses ${((compressedSize / compressedLimit) * 100).toFixed(1)}% of the ${compressedLimit} B deploy budget.`
    );
  }

  if (!fitsActivated) {
    warnings.push(
      `Uncompressed WASM (${rawSize} B) exceeds the activation cap (${activationLimit} B). Activation will fail.`
    );
  } else if (rawSize > activationLimit * 0.8) {
    warnings.push(
      `Uncompressed WASM uses ${((rawSize / activationLimit) * 100).toFixed(1)}% of the ${activationLimit} B activation budget.`
    );
  }

  return {
    rawSize,
    compressedSize,
    compressionRatio: rawSize === 0 ? 0 : compressedSize / rawSize,
    fitsCompressed,
    fitsActivated,
    compressedLimit,
    activationLimit,
    warnings,
  };
}
