# 04 — Operating

This repository ships one thing: the npm package `@jterrazz/test`. Nothing here deploys, nothing here runs as a service, and merging to `main` publishes nothing — a release is a deliberate, separate act. This chapter says what that act is, what leaves the tree when it happens, and what a consumer has to have for the published artefact to work.

## Releasing

A release is three steps, in this order.

1. **Bump and land the version.** The version in `package.json` moves, alone, in a commit whose subject is `chore: <version> — <what changed>`. The commit log is the changelog: this repository carries no `CHANGELOG.md`, by decision, and the release notes plus that subject line are the record.
2. **Create the GitHub release**, tagged at that commit. This is the trigger and the only one — `.github/workflows/release.yaml` listens on `release: types: [created]`.
3. **Watch the gate.** The workflow delegates to the estate's `jterrazz/jterrazz-actions/.github/workflows/release-npm.yaml`, which runs the FULL validate job first — the same build, lint and test the push gate runs, chromium included — and publishes only if it is green.

The publish step is `npm publish --access public --provenance`, on Node 24, with `id-token: write` granted so npm records a provenance attestation linking the tarball to the workflow run that built it. The registry is npm's, stated as `publishConfig` in the manifest.

Because validate runs inside the release workflow, a red suite stops a publication rather than a merge. That is the design: the tree on `main` is always publishable, and nothing decides for you when it is published.

## What leaves the tree

The tarball is what `files` declares and nothing else: `dist/`, minus `dist/catalog.*`, plus `schema/`. The catalogue generator is a development gesture with no consumer — it writes this repository's own projections — so it is built but never shipped.

Four entry points reach a consumer, and they are the whole public contract:

| Entry                   | Resolves to                      | Consumed by                                              |
| ----------------------- | -------------------------------- | -------------------------------------------------------- |
| `@jterrazz/test`        | `dist/index.js` (ESM)            | Every spec — the single import point (rule F1)           |
| `@jterrazz/test/vitest` | `dist/vitest.js` (ESM)           | `vitest.config.ts`: the config preset and `literate()`   |
| `@jterrazz/test/oxlint` | `dist/oxlint.js` / `.cjs` (dual) | The consumer's `oxlint.config.*`, which may be CommonJS  |
| `@jterrazz/test/schema` | `schema/spec.schema.json`        | An editor validating a `<case>.spec.yaml` as it is typed |

One binary ships with them: `jterrazz-test-check`, the conventions checker, pointed at `dist/checker.js`. A consumer wires it into its own lint step.

## What a consumer must bring

The package refuses to guess at its environment, so several things it uses are the consuming project's to install.

- **`vitest` is a required peer.** The framework registers its matchers into vitest; there is no standalone runner.
- **`playwright`, `appium` and `webdriverio` are OPTIONAL peers**, loaded lazily by the one module that owns each. A project that specifies no page and no screen installs none of them.
- **Docker must be running** for the container-backed services and for compose mode. `sqlite()` and plain CLI specs need none.
- **Node 20 or newer**, as `engines` states.

`msw` is a direct dependency, not a peer — outgoing interception is part of the framework rather than a choice a consumer makes.

## The footprint it leaves

Nothing persistent. Inside a consuming project the framework writes only under `.artifacts/` — vite's transform cache, the coverage directory if a provider is installed, and the SQLite schema template it reuses across runs. Everything else it creates is per-RUN scratch in the OS temp directory: the fresh working directory of each CLI spec, the per-worker database copies, the profile directory a browser or a simulator needs. One `rm -rf .artifacts` is a clean slate, and [02 — Developing](02-developing.md) holds the table of what lands where.

Containers are the one resource that outlives a process badly, which is why `afterAll(cleanup)` is a rule and not a suggestion: a suite that forgets it leaks its infrastructure into the next one.

## Pitfalls

- **Pushing the bump and expecting a publish.** `main` is not a release trigger. Without a created GitHub release, the version on npm does not move.
- **Releasing from a red tree.** The workflow will refuse, and it refuses AFTER the tag exists — so the tag has to be re-cut once the fix lands.
- **Adding a file to the tarball by putting it in the repository.** Only what `files` names ships. A new published asset is a manifest change, and a deliberate one.

## Related

[01 — Architecture](01-architecture.md) · [02 — Developing](02-developing.md) · [03 — Testing](03-testing.md)
