declare module "@webassemblyjs/wasm-parser" {
  export function decode(bytes: Uint8Array | Buffer, opts?: Record<string, unknown>): unknown;
}
