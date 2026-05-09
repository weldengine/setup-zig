# weldengine/setup-zig

Install the Zig compiler in a GitHub Actions or Forgejo Actions workflow, with a parallel mirror race for resilience and cache preservation across runs.

## Quick start

```yaml
- uses: actions/checkout@v4
- uses: weldengine/setup-zig@v1
- run: zig build test
```

By default the action reads `minimum_zig_version` (or `mach_zig_version`) from `build.zig.zon`, falling back to the latest tagged release if no `build.zig.zon` is present.

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `version` | `''` | Explicit version. Examples: `0.16.0`, `0.16.0-dev.42+abcdef012`, `2024.5.0-mach`, `master` (latest nightly), `latest` (latest tagged). Empty = read from `build.zig.zon`, fallback `latest`. |
| `version-file` | `''` | Path to a `build.zig.zon` (relative to `GITHUB_WORKSPACE`). Only used when `version` is empty. **When set explicitly and the file is missing, the action fails** (unlike the implicit default-path lookup, which silently falls back to `latest`). |
| `mirror` | `''` | Override the Zig download mirror. When set, no race and no `ziglang.org` fallback. `https://ziglang.org` is rejected. |
| `source` | `'github-weldengine-setup-zig'` | Identifier appended as `?source=<value>` to mirror requests so operators can attribute traffic. |
| `use-cache` | `'true'` | Whether to preserve `.zig-cache` across runs via `@actions/cache`. The downloaded tarball is cached separately regardless. |
| `cache-key` | `''` | Extra component appended to the `.zig-cache` cache key. Use this to keep matrix cells from sharing a single cache. OS variables can be omitted (the OS is already encoded in the tarball name). |
| `cache-size-limit` | `'2GiB'` | Max size of `.zig-cache` before contents are purged prior to save. Accepts `2GiB`, `500MiB`, `1024MB`, `1.5GB`, plain integers (bytes), or `0` / empty to disable the GC. |
| `enforce-version-range` | `''` | If non-empty, fail when the resolved version does not have this `major.minor` (or `major.minor.patch`) prefix. Example: `0.16` accepts `0.16.0`, `0.16.5`, `0.16.0-dev.500+abc`, rejects `0.15.1`. |

## Outputs

| Output | Description |
| --- | --- |
| `zig-version` | The actual Zig version installed, as reported by `zig version`. |

## How it works

The action resolves the requested version (handling `master`, `latest`, Mach nominated, and `build.zig.zon` lookups), races every community mirror in parallel via `Promise.any` over `fetch()` with a shared `AbortController`, validates each tarball's minisign signature (Ed25519 + BLAKE2b) and trusted-comment filename, last-resorts to `ziglang.org` only when every mirror has failed, extracts the tarball into the runner's tool path, prepends Zig to `PATH`, exports `ZIG_GLOBAL_CACHE_DIR` and `ZIG_LOCAL_CACHE_DIR` to `${GITHUB_WORKSPACE}/.zig-cache`, and (if `use-cache: true`) restores the cache prefix on entry and saves it on post — optionally GCing the cache directory before save when `cache-size-limit` is set.

## Differences from mlugg/setup-zig

This action is a from-scratch TypeScript reimplementation inspired by [`mlugg/setup-zig`](https://codeberg.org/mlugg/setup-zig). The minisign verification module is a near-verbatim port (with explicit attribution in `src/minisign.ts`). Concrete differences:

- **Parallel mirror race with `AbortController`.** Mirrors are fetched concurrently via `Promise.any`; the first valid response wins and the rest are aborted. Mlugg iterates sequentially with random ordering.
- **`runs.using: node24`.** Required by GitHub from June 2026; mlugg still targets `node20`.
- **`dist/` bundled with `@vercel/ncc` and committed.** Single auditable bundle per release.
- **`version-file` input.** Lets monorepos point at a non-root `build.zig.zon`. When set explicitly, a missing file is an error (vs. silent fallback to `latest`).
- **`source` input.** Lets users override the `?source=` query parameter sent to mirrors.
- **`zig-version` output.** Exposes the actually-installed version (post-resolution of `master` / `latest` aliases).
- **`enforce-version-range` input.** Optional safety net that rejects a workflow when the resolved version is outside an expected `major.minor` range.

The `cache-size-limit` input also accepts human-readable strings (`2GiB`, `500MiB`) instead of MiB integers, but this is a syntax convenience rather than a behavioral difference (the `2GiB` default matches mlugg's `2048` MiB default).

## Forgejo / Codeberg compatibility

The action runs unchanged on Forgejo Actions / Codeberg's `codeberg-tiny` and `codeberg-tiny-lazy` runners. Default Codeberg runner images already ship Node 24 as the PATH default, so no `container.image` override is needed (and specifying one would force users to grant additional Codeberg permissions). A reduced-matrix Forgejo workflow is shipped at `.forgejo/workflows/test.yml`.

When using this action from a Forgejo workflow against a GitHub-hosted source, the `uses:` line must include the full URL:

```yaml
- uses: https://github.com/weldengine/setup-zig@v1
```

A future Codeberg mirror is planned (per the Weld engine Phase 1 roadmap, criterion C1.10).

## Acknowledgements

This action is inspired by, and ports the minisign verifier from, [`mlugg/setup-zig`](https://codeberg.org/mlugg/setup-zig) by Matthew Lugg (MIT License). See `LICENSE` for the double-copyright notice and `src/minisign.ts` for the in-source attribution header.
