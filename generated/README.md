# generated/

Output folder for `sas gen` (M3). Each off-chain interaction module lands here as `<name>.ts` -- a TypeScript file targeting ethers v6 that backends / frontends drop into their codebase to talk to the Stylus contract from off-chain.

Treat the contents as **build output** -- regenerate from the source ABI rather than hand-editing. Override the folder location with `SAS_OUT_DIR` or pass `-o <path>` to write somewhere else.

The Stylus-to-Stylus on-chain interface code generator (Rust `sol_interface!`) is M4 -- not generated here yet.
