# M01 — Initial implementation of weldengine/setup-zig

> **Status:** PLANNED
> **Project:** weldengine/setup-zig (standalone tooling repo, not part of the Weld engine codebase)
> **Branch:** `feat/M01-initial-implementation`
> **Tag planned:** `v0.1.0` (mobile tag `v1` posted on the same commit by Guy after merge)
> **Dependencies:** none (new repository)
> **Opening date:** 2026-05-08
> **Closing date:** —

---

# FROZEN SECTION

*Produced by Claude.ai. Not modifiable by Claude Code outside of an explicit Claude.ai round-trip (cf. § Acted deviations).*

## Context

`weldengine/setup-zig` is a standalone GitHub Action / Forgejo Action that installs the Zig compiler in a CI workflow and preserves the Zig cache across runs. It is a TypeScript reimplementation inspired by `mlugg/setup-zig` (MIT, © Matthew Lugg), with concrete improvements: parallel mirror race for resilience, ncc-bundled distribution for supply-chain auditability, and Weld-specific ergonomics (`version-file`, `source`, `enforce-version-range` inputs, `zig-version` output). This milestone delivers the complete repository: working action, full test suite, CI on both GitHub and Forgejo, documentation, and `v0.1.0` tag.

## Scope

- TypeScript source tree under `src/` covering version resolution, parallel download with mirror race, minisign verification, cache key generation, optional cache size GC, orchestration and post step
- ncc-bundled `dist/` directory committed to the repo (not gitignored)
- `action.yml` declaring 8 inputs (`version`, `version-file`, `mirror`, `source`, `use-cache`, `cache-key`, `cache-size-limit`, `enforce-version-range`), 1 output (`zig-version`), `runs.using: node24`
- Optional `.zig-cache` size GC controlled by the `cache-size-limit` input: defaults to `2GiB` (matches `mlugg/setup-zig` behavior); set to `0` or empty string to disable GC entirely. When active, the post step measures the cache directory size and clears its contents before save if the size exceeds the limit.
- Unit test suite with ≥ 36 test cases across all modules, target coverage ≥ 90 %
- Integration test workflows under `.github/workflows/test.yml` (matrix: 4 OS × 5 Zig versions = 20 jobs) and `.forgejo/workflows/test.yml` (reduced matrix for Codeberg constraints)
- `README.md` with usage, complete input/output table, "Differences from mlugg/setup-zig" section, "Forgejo / Codeberg compatibility" section, "Acknowledgements" section
- `LICENSE` MIT with double-copyright (Guy + attribution to Matthew Lugg) per agreed format
- Three usage examples under `examples/`: minimal usage, monorepo with `version-file`, matrix build with `cache-key`

## Out-of-scope

- Forking from `mlugg/setup-zig` (this is a from-scratch reimplementation, not a GitHub fork)
- Tool-cache support (`@actions/tool-cache` directory persistence on self-hosted runners — not relevant for Weld's CI plan)
- Standalone composite-action variant (decided against in design conversation; JS action chosen)
- Native ZON parser implementation (regex-based extraction of `minimum_zig_version` and `mach_zig_version` is sufficient for two named fields)
- Custom minisign reimplementation outside of `node:crypto` Ed25519 + BLAKE2b (the existing approach in `mlugg/setup-zig`'s `minisign.js` is correct and is ported with attribution)
- Migration scripts or any `mlugg/setup-zig` → `weldengine/setup-zig` upgrade tooling
- Codeberg repository setup (target migration is end of Phase 1 per Weld criterion C1.10; this milestone targets GitHub only, with `.forgejo/workflows/test.yml` provided proactively for forward compatibility)
- macOS 13 support in CI matrix (Node 24 does not run on macOS 13.4 and below)
- Self-update mechanism for the action

## Reference documents to read first

These are external references, not Weld engine specs. Claude Code reads them in this order before implementing.

1. `mlugg/setup-zig` reference repository — read the full source at `https://codeberg.org/mlugg/setup-zig` (or its GitHub mirror at `https://github.com/mlugg/setup-zig`). Specifically the files `action.yml`, `main.js`, `common.js`, `minisign.js`, `post.js`, `package.json`. This is the architectural baseline.
2. `https://docs.github.com/en/actions/creating-actions/metadata-syntax-for-github-actions` — sections "JavaScript actions" and "runs for JavaScript actions" for the `node24` runtime declaration.
3. `https://forgejo.org/docs/latest/user/actions/actions/` — section "Node actions" to confirm Forgejo compatibility expectations.
4. The Zig public minisign key `RWSGOq2NVecA2UPNdBUZykf1CCb147pkmdtYxgb3Ti+JO/wCYvhbAb/U` (used by Zig releases since 2020) is hardcoded in `mlugg/setup-zig/minisign.js` and must be carried over verbatim.
5. The hardcoded fallback mirror list at the bottom of `mlugg/setup-zig/main.js` (13 mirrors) is carried over as-is for resilience when `https://ziglang.org/download/community-mirrors.txt` is unreachable.

## Files to create

Working tree layout. Paths outside this list must not be created without going through a brief amendment.

### Source

- `src/main.ts` — creation — pipeline entry point: resolve → download with mirror race → verify → extract → configure cache
- `src/post.ts` — creation — post step entry point: invokes optional GC (via `src/gc.ts`) before triggering cache save
- `src/version.ts` — creation — pure functions: `parseVersion`, `versionLessThan`, `getTarballName`, `getTarballExt`, including historical rename handling
- `src/resolve.ts` — creation — version resolution: input precedence, ZON parsing, `index.json` fetching for master/latest/`*-mach`, optional `enforce-version-range` validation
- `src/download.ts` — creation — parallel mirror race with `AbortController`, minisign verification, trusted comment validation, exponential backoff, ziglang.org last-resort fallback
- `src/minisign.ts` — creation — Ed25519 + BLAKE2b minisign verification using `node:crypto`. **File header with explicit attribution required**: this module is ported from `mlugg/setup-zig/minisign.js` with minimal changes (TS types, ESM imports). Header text:
  ```
  /**
   * Minisign signature verification (Ed25519 + BLAKE2b).
   *
   * Originally from mlugg/setup-zig (https://codeberg.org/mlugg/setup-zig)
   * Copyright (c) Matthew Lugg, MIT License.
   * Adapted for weldengine/setup-zig: TypeScript types and ESM imports.
   */
  ```
- `src/cache.ts` — creation — cache key generation helpers (deterministic, pure)
- `src/gc.ts` — creation — optional `.zig-cache` size GC: parses human-readable size strings (`2GiB`, `500MiB`, `1024MB`), computes recursive directory size, clears directory contents if over limit. Treats input value `0`, empty, or unset as "GC disabled".

### Tests

- `tests/version.test.ts` — creation — minimum 15 cases covering: version parse for stable/dev/master/mach formats, version comparison transitions at 0.14.1 / 0.15.0-dev.631 / 0.15.1, tarball name format flip (platform-arch → arch-platform), arm/armv7a rename, ppc64 → ppc64le on little-endian, Windows zip vs tar.xz extension
- `tests/resolve.test.ts` — creation — minimum 7 cases: explicit literal version, `master` alias, `latest` alias, `*-mach` alias, version inferred from `build.zig.zon` (`minimum_zig_version`), version inferred from `build.zig.zon` (`mach_zig_version`), missing `build.zig.zon` (error), `enforce-version-range` mismatch (error)
- `tests/download.test.ts` — creation — minimum 4 cases with mocked `fetch`: all mirrors respond OK (race winner first), first mirror dead (race continues), all mirrors dead (last-resort to ziglang.org succeeds), mirror responds with corrupted signature (rejected, race continues)
- `tests/minisign.test.ts` — creation — minimum 3 cases with a known-good test vector trio: valid signature returns true, corrupted payload returns false, altered trusted comment returns false
- `tests/cache.test.ts` — creation — minimum 3 cases on key generation: tarball cache key format, zig-cache cache key format with run_id and run_attempt, restore-keys ordering
- `tests/gc.test.ts` — creation — minimum 5 cases on filesystem fixture: directory size under limit (no purge), directory size over limit (purge clears contents), nonexistent directory (no crash, no-op), size limit parser accepts valid formats (`2GiB`, `500MiB`, `1024MB`, `1.5GB`), size limit parser rejects invalid formats and treats `0` / empty / unset as disabled

Total: ≥ 37 unit test cases.

### Configuration & build

- `package.json` — creation — declares `"engines": { "node": ">=24" }`, dependencies on `@actions/cache@^5`, `@actions/core@^1.11`, `@actions/exec@^1.1`, `@actions/github@^6`, `@actions/tool-cache@^2`; devDependencies on `typescript`, `@vercel/ncc`, `vitest`, `@vitest/coverage-v8`, `eslint`, `@typescript-eslint/*`, `prettier`. Scripts: `build` (ncc bundles `src/main.ts` → `dist/index.js` and `src/post.ts` → `dist/post.js`), `test`, `lint`, `format:check`.
- `package-lock.json` — creation — generated by `npm install`, committed
- `tsconfig.json` — creation — target `es2024`, module `nodenext`, strict mode on, no implicit any, no unchecked indexed access
- `vitest.config.ts` — creation — coverage thresholds set at 90 %
- `eslint.config.js` — creation — flat config, TS strict, no unused vars, no any
- `.prettierrc.json` — creation — minimal config (default print width 100, single quotes)
- `.gitignore` — creation — ignores `node_modules/`, coverage outputs, build artifacts. **Does NOT ignore `dist/`** (intentional: bundled output is committed)
- `.gitattributes` — creation — `dist/* linguist-generated=true` (so GitHub doesn't show bundled files in language stats)

### Action manifest

- `action.yml` — creation — declares the 8 inputs and 1 output, `runs.using: node24`, `runs.main: dist/index.js`, `runs.post: dist/post.js`, branding fields. The `cache-size-limit` input has `default: '2GiB'` and a description noting that `0` or empty string disables the GC.

### Bundled output (committed)

- `dist/index.js` — creation — ncc bundle of `src/main.ts`
- `dist/post.js` — creation — ncc bundle of `src/post.ts`
- `dist/licenses.txt` — creation — auto-generated by ncc, consolidates third-party licenses

### CI workflows

- `.github/workflows/test.yml` — creation — matrix 4 OS × 5 Zig versions = 20 jobs, plus 4 dedicated jobs for special inputs (custom `version-file` path, `enforce-version-range`, custom `mirror`, custom `source`). OS list: `ubuntu-latest`, `macos-14`, `macos-latest`, `windows-latest`. Zig versions: `master`, `latest`, `0.14.1`, `0.15.1`, `0.16.0`. **macOS 13 is excluded** (Node 24 incompatibility).
- `.github/workflows/lint.yml` — creation — runs `npm run lint`, `npm run format:check`, and verifies that `npm run build` produces a `dist/` identical to the committed one (catches forgotten rebuilds)
- `.forgejo/workflows/test.yml` — creation — reduced matrix for Codeberg `codeberg-tiny` runner constraints, runs on default Codeberg image (Node 24 already present)

### Documentation

- `README.md` — creation — sections in this order: short tagline, "Quick start" (3-line example), "Inputs" table, "Outputs" table, "How it works" (1 paragraph), "Differences from mlugg/setup-zig" (bulleted list of the 6 concrete differences agreed in the design conversation: parallel mirror race, ncc bundle, `node24` runtime, `version-file` input, `source` input, `zig-version` output, `enforce-version-range` input), "Forgejo / Codeberg compatibility" section, "Acknowledgements" section pointing to mlugg/setup-zig
- `LICENSE` — creation — MIT, double-copyright format. Exact opening:
  ```
  MIT License

  Copyright (c) 2026 Guy <last name to be filled by Guy>

  This software is a reimplementation based on mlugg/setup-zig
  (https://codeberg.org/mlugg/setup-zig), Copyright (c) Matthew Lugg,
  also licensed under the MIT License.
  ```
  followed by the standard MIT permission text.
- `examples/minimal.yml` — creation — simplest possible usage
- `examples/monorepo.yml` — creation — uses `version-file: tools/build.zig.zon`
- `examples/matrix.yml` — creation — strategy matrix with `cache-key` per matrix combination

## Acceptance criteria

### Tests

All test cases listed under "Files to create / Tests" must pass. Coverage thresholds enforced by `vitest.config.ts`:

- ≥ 90 % statements on every module under `src/`
- ≥ 85 % branches on every module under `src/`

### Behavior — verified by integration CI matrix

Each of the following must pass green in `.github/workflows/test.yml`:

- For every `(OS, version)` pair in the matrix: `zig version` after the action prints exactly the requested version (resolved alias for `master`/`latest`)
- For every cache hit scenario: the second job in the same workflow run reports cache hit on the tarball cache and skips the download step
- The 4 dedicated input jobs:
  - `version-file` pointed to `tests/fixtures/build.zig.zon` resolves to the version declared in that file
  - `enforce-version-range: '0.16'` succeeds for `0.16.0` and fails with a clear error message for `0.15.1`
  - Custom `mirror: 'https://pkg.machengine.org/zig'` is used preferentially
  - Custom `source: 'github-test-foobar'` query string appears in the request URL (verified via `core.debug` output capture)

### Behavior — verified by Forgejo CI

`.forgejo/workflows/test.yml` runs on `codeberg-tiny` (or `codeberg-tiny-lazy`) with at minimum:

- One job that resolves Zig version `0.16.0` and runs `zig version`
- One job that uses `version-file` input

### CI quality gates

- `npm run build` produces `dist/index.js` and `dist/post.js` with zero warnings
- `npm test` green on Linux, macOS, Windows (Node 24)
- Coverage thresholds met
- `npm run lint` green (zero ESLint errors, zero warnings)
- `npm run format:check` green
- The committed `dist/` matches a freshly-rebuilt `dist/` byte-for-byte (enforced by `.github/workflows/lint.yml`)

### Observable demonstration

A test consumer repository (set up by Guy after merge, out of scope here) consuming the action via `uses: weldengine/setup-zig@v0.1.0` succeeds in installing Zig 0.16.0 and running `zig build` on a trivial `build.zig`. This demonstration is not part of the milestone's CI but is the practical validation criterion before the mobile `v1` tag is posted.

## Conventions

- **Branch:** `feat/M01-initial-implementation`
- **Final tag:** `v0.1.0` (annotated). Mobile tag `v1` posted on the same commit by Guy after merge.
- **PR title:** `M01 / setup-zig / Initial implementation`
- **Commit convention:** Conventional Commits. Allowed types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `ci`, `build`. Allowed scopes: `version`, `resolve`, `download`, `minisign`, `cache`, `gc`, `action`, `ci`, `docs`, `deps`, `build`. Examples:
  - `feat(download): add parallel mirror race with AbortController`
  - `feat(action): expose zig-version output`
  - `feat(gc): add optional cache size limit with default 2GiB`
  - `test(version): add cases for 0.14.1 → 0.15.1 tarball format flip`
  - `ci(forgejo): add codeberg-tiny test workflow`
- **Merge strategy:** squash-and-merge
- **Languages:** all repo artifacts (code, comments, commits, docs, brief journal) in English

## Notes

### Decisions explicitly made and not to be revisited

1. JS action over composite action — composite cannot reliably implement post-job cache save; the design conversation evaluated the trade-off and chose JS.
2. Reimplementation over GitHub fork — clean history, no upstream link, MIT compatibility preserved via attribution in LICENSE and `src/minisign.ts` header.
3. ncc bundle committed — primarily for supply-chain auditability (not raw checkout speed). Single `dist/` reviewable per release.
4. Optional `.zig-cache` GC via `cache-size-limit` input — default `2GiB` matching `mlugg/setup-zig` behavior, set to `0` or empty to disable. Rationale: not strictly needed for Weld's current single-target CI on GitHub (cache typically under 1 GiB), but becomes valuable for future cross-platform matrix builds and especially for Codeberg post-C1.10 where fair-use guidelines make proactive cache size management more relevant. Keeping it optional with a sensible default avoids the binary "always on / always off" decision and gives users (including Weld at different points in its lifecycle) a single knob to tune.
5. `runs.using: node24` direct, not `node20` — June 2, 2026 is the GitHub-mandated migration deadline; deferring it would create needless near-term technical debt. Codeberg's `catthehacker/ubuntu:act-latest` image already ships Node 24 as the PATH default (verified in the Dockerfile source: `ARG NODE_VERSION="20 24"` with explicit "make this version the default" handling for 24).
6. macOS 13 excluded from matrix — Node 24 does not support macOS 13.4 and earlier. Documented in README.

### Known gotchas

- The `dist/` rebuild check in `.github/workflows/lint.yml` will fail on any commit that modifies `src/` without rebuilding. Contributors must run `npm run build` before pushing. This is the standard pattern in `actions/checkout`, `actions/cache`, etc.
- The Zig public minisign key is `RWSGOq2NVecA2UPNdBUZykf1CCb147pkmdtYxgb3Ti+JO/wCYvhbAb/U`. Hardcoded in `src/minisign.ts`. This key has been used by Zig releases since 2020 and is not expected to rotate. If it ever does rotate, that is a major-version bump for this action.
- `actions/cache@v5` (the version aligned with Node 24) has slightly different return shapes than `@v4`. The TS types from `@actions/cache@^5` are authoritative.
- The trusted comment in a Zig minisign signature has the exact form `timestamp:N\tfile:NAME\thashed`. The check must match `file:` followed by the expected basename, not the full path. mlugg's existing implementation does this correctly.
- For the Forgejo `.forgejo/workflows/test.yml`: do NOT specify `container.image` explicitly. Default Codeberg runners already ship Node 24. Specifying a custom image would require the user (or contributor running tests) to grant additional Codeberg permissions.
- The `cache-size-limit` input uses a string format (not an integer of bytes) to be human-readable. The parser must accept at minimum: `2GiB`, `1.5GiB`, `500MiB`, `1024MB`, `1GB`, plain integers (interpreted as bytes), and the special values `0` and `''` (both meaning "GC disabled"). Invalid formats must throw a clear error at start of the post step.

### References (read but not strictly required for implementation)

- GitHub Actions Node 24 deprecation timeline: https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/
- Forgejo composite vs JS actions discussion (ruled out composite): captured in the Claude.ai design conversation, summary in this brief's "Decisions" section above
- `actions/checkout` repository as a reference for ncc-bundle layout, `dist/` policy, and `lint.yml` rebuild check: https://github.com/actions/checkout

---

# LIVE SECTION

*Maintained by Claude Code during the milestone. The journal is not a marketing report — it serves review and post-mortem debug.*

## Specs read

*To be checked off before any production code is written.*

- [ ] `mlugg/setup-zig` — full source — read YYYY-MM-DD HH:MM
- [ ] GitHub Actions JS metadata syntax docs — read YYYY-MM-DD HH:MM
- [ ] Forgejo Actions docs — read YYYY-MM-DD HH:MM

## Execution journal

*One entry per logical work sequence. Chronological. 1-3 lines per entry.*

- YYYY-MM-DD HH:MM — <summary>

## Acted deviations

*Modifications of the FROZEN SECTION made during the milestone after a Claude.ai round-trip. If empty at the end of the milestone: nominal case.*

- <commit SHA> — <deviation summary and rationale>

## Blockers encountered

*Blockers that required a Claude.ai round-trip. If 2+ distinct blockers: re-scope signal.*

- <blocker summary> — resolved by <commit SHA> or <reference to Claude.ai conversation>

## Closing notes

*To be filled at Status → CLOSED, just before opening the PR.*

- **What worked:**
- **What deviated from the original spec:**
- **What needs explicit review attention:**
- **Final measurements:** (test count, coverage %, bundle sizes for `dist/index.js` and `dist/post.js`, total LOC under `src/`)
- **Residual risks / intentional technical debt:**
