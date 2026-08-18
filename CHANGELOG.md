# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Because the CLI's output is its public surface, versioning treats it as an API:

- **major** — a command is removed or renamed, a flag changes meaning, or generated
  code changes shape in a way that breaks existing importers.
- **minor** — new commands, new flags, additional generated exports, new warnings.
- **patch** — bug fixes, wording, dependency bumps.

Releases are cut by hand — there is no release automation yet. The full sequence:

1. Rename the `[Unreleased]` heading below to the version you are shipping, with
   today's date, and open a fresh empty `[Unreleased]` above it. Date a section
   only when it ships; dating it early is how changelogs end up lying about their
   own history.
2. `npm version <major|minor|patch>` — bumps `package.json` and creates a `vX.Y.Z`
   git tag. Commit the changelog edit first, so the tag points at it.
3. `npm publish` — `prepublishOnly` runs typecheck, build, and `test:fast` first,
   and aborts the publish if any of them fail. Add `--otp=<code>` if 2FA does not
   prompt.
4. `git push && git push --tags` — without the second one the tag stays local and
   the published version has no commit anyone can point at.

## [Unreleased]

## [1.0.1] — 2026-08-18

### Fixed

- `sas --version` reported `0.1.0` on the 1.0.0 release. The version was hardcoded
  in `src/cli.ts` and `npm version` only rewrites `package.json`, so the two drifted
  apart. The CLI now reads the version from the manifest, and a test asserts the two
  match so the drift cannot ship again.

## [1.0.0] — 2026-08-18

First public release, so everything below is new rather than changed.

### Commands

- `analyze` — WASM header/AST parsing, brotli size validation against the Stylus
  deploy (24,576 B) and activation (128 KB) caps, and live deployment-cost
  estimation over an Arbitrum RPC. Prints the endpoint it used, marked
  `(default)` when falling back to the public one.
- `collisions` — canonical-signature construction and 4-byte selector collision
  detection, exiting non-zero for CI use.
- `gen` — TypeScript / ethers v6 wrapper generation for off-chain interaction.
- `export-interface` — Rust `sol_interface!` generation for on-chain
  Stylus-to-Stylus calls, with warnings for selector collisions and for overloaded
  names that would fail to compile (rustc E0592).
- `interactive` — prompt-driven contract and action selection; also the behaviour
  of bare `sas`.

### Packaging

- MIT license.
- npm metadata: `repository`, `homepage`, `bugs`, and `keywords`.
- `prepublishOnly` runs typecheck, build, and `test:fast`, so a publish cannot
  ship an unbuilt or failing `dist/`. It deliberately skips the Rust compile test —
  that belongs in CI, not in the publish path, where an ambient toolchain change
  could block an unrelated release.
- CI on Node 20 and 22: typecheck, build, `test:fast`, then pack the tarball,
  install it globally, and exercise the installed binary — including the wizard
  with closed stdin, the one command that could hang a job. A separate job runs
  the `wasm32` compile test with a cargo cache keyed on `contracts/Cargo.lock`.
- Test scripts name their files explicitly rather than globbing, so they work on
  Windows, where npm runs scripts through `cmd.exe` and no shell glob expansion
  happens.

### Notes

- `contracts/Cargo.lock` is committed, and the compile test pins its throwaway
  crate to the exact `stylus-sdk` version the lockfile resolved. Previously the
  test read the caret requirement from `Cargo.toml` and re-resolved on every run,
  so a new upstream patch release could break CI with no change to this repo.
- Known gaps: `analyze` does not model `ArbWasm.activateProgram()` gas, and
  collision detection is scoped to a single ABI.
