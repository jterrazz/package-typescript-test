# 01 — Architecture

What this package IS: one runner model behind five constructors, four source layers with declared edges, and four channels through which its conventions are enforced. The chapters that follow explain how to USE each facet; this one draws the lines they sit inside.

| The shape                  | Held below                                                                     |
| -------------------------- | ------------------------------------------------------------------------------ |
| The runner model           | [The runner model](#the-runner-model) — constructor, handle, chain, result     |
| The source layers          | [The four layers](#the-four-layers) — `core`, `integrations`, `vitest`, `lint` |
| How a convention is held   | [The four enforcement channels](#the-four-enforcement-channels)                |
| What ships out of the tree | [What the tree publishes](#what-the-tree-publishes)                            |

The rules themselves — what each family says, what a reviewer must judge — are the constitution, [12 — Conventions](12-conventions.md); their normative sentences are the generated catalogue, [13 — Linting](13-linting.md).

## The runner model

Every facet is the same four steps. A **constructor** takes options and returns a **handle**; the handle opens a **chain** of zero or more setups closed by exactly one terminal action; the action executes and resolves to a **typed result**; the result is asserted through vitest's `expect()`. Nothing else is public — there is no imperative escape hatch, because a spec that can do anything proves nothing in particular.

Five constructors exist and the list is closed (`src/core/specification/shared/specification.ts`):

| Constructor               | Handle destructures to                   | Subject under test                               |
| ------------------------- | ---------------------------------------- | ------------------------------------------------ |
| `specification.api()`     | `{ api, cleanup, docker, orchestrator }` | An HTTP API — in-process, or a compose stack     |
| `specification.jobs()`    | `{ jobs, cleanup, orchestrator }`        | A background pipeline, triggered by name         |
| `specification.cli()`     | `{ cli, cleanup, docker, orchestrator }` | A command binary in a fresh temp directory       |
| `specification.website()` | `{ website, cleanup, url }`              | A rendered page — fetched, or driven in chromium |
| `specification.mobile()`  | `{ mobile, cleanup, udid }`              | A native screen on an iOS simulator              |

The asymmetry in that column is the model, not an oversight: `jobs` never spawns a container, so it is handed no `docker`; `website` and `mobile` drive a browser and a simulator rather than an orchestrated stack, so they carry neither.

A runner is created **once per suite**, in a `*.specification.ts` file, and imported by the test files beside it. That split is what makes the container lifecycle affordable — one Postgres per suite, not one per test — and it is why `afterAll(cleanup)` belongs in the specification file and nowhere else.

### The seam under the chain

`SpecificationBuilder` (`src/core/specification/shared/builder.ts`) holds the chain for every facet; each facet contributes its own setups and its own terminal actions on top. The infrastructure a chain needs is reached through **ports** — `src/core/ports/` declares eight of them (`browser`, `cli`, `container`, `database`, `device`, `isolation`, `server`, `service`) — and an integration implements one. So the chain knows "a database exists"; it never knows Postgres.

Two seams are opened lazily rather than imported: `playwright` for `.visit()` and `appium`/`webdriverio` for `.open()` are optional peer dependencies, loaded by the one module that owns them. A project that tests no page installs neither.

## The four layers

The source tree is four layers with declared, one-directional edges. The map is not the linter's to assume — `i1-layer-boundaries` ships inert — so this package declares its own as `FRAMEWORK_LAYERS` in `oxlint.config.ts`, and that declaration is the enforced statement of what follows.

| Layer           | May import                                                                   | Holds                                                                                                                                                                                    |
| --------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/`         | itself, plus the docker/hono/yaml integrations and two `vitest/` helpers     | The model: the specification builder and its facets, the results and their accessors, the `{{token}}` engine, the `.http` and `<case>.spec.yaml` grammars, the contract queue, the ports |
| `integrations/` | its OWN external dependency, plus `core/`                                    | One folder per dependency: `postgres`, `redis`, `sqlite`, `testcontainers`, `compose`, `docker`, `hono`, `playwright`, `appium`, `msw`, `openai`, `anthropic`, `yaml`                    |
| `vitest/`       | `vitest`, `vitest-mock-extended`, `mockdate`, `core/`, `integrations/docker` | ALL runner coupling: the `expect()` matchers, update-mode detection, `mockOf`/`mockOfDate`, the config preset and the `literate()` plugin                                                |
| `lint/`         | itself, plus a short list of PURE `core/` modules                            | The tool-facing channel: the oxlint plugin, the conventions checker, the catalogue manifest and generator                                                                                |

Three of those edges carry their reason in the declaration itself. `core/` reaches `integrations/docker` because that adapter has no dependency of its own to leak. `lint/` reaches exactly the pure modules the runner also uses — the token list, the ground names, the root walk, the `<case>.spec.yaml` parser — so that the file the lint accepts is the file the runner runs, from ONE parser. And `vitest/` is the only place the word `vitest` appears outside a test: swapping the runner would be a rewrite of that folder and of nothing else.

`src/index.ts` is the composition root and names no layer. It wires the container integrations into the registry seam and re-exports the public surface; being the composition root is exactly why it is exempt from the layer map.

## The four enforcement channels

A convention this package states is held by a **channel**, and every mechanized rule names exactly one of four. The guiding aim is that most enforcement is programmatic, not review-borne.

- **static** — the `jterrazz/*` oxlint plugin (one file per rule under `src/lint/rules/`, AST analysis), plus the `conventions` checker binary (`dist/checker.js`) for the data fixtures oxlint never visits.
- **checker** — passes of that same binary reading what an AST cannot: the `{{token}}` grammar of `_requests/` and `_expected/` fixtures, the `<case>.spec.yaml` document family, and cross-file analyses that cross a `*.specification.ts` with its tests or walk a whole feature tree.
- **runtime** — the framework refuses incorrect usage as it executes, where static analysis abstains (a non-literal argument) or cannot reach (the network, a container lifecycle).
- **process** — the judgement no single channel settles: asset-driven grouping, golden-file discipline, retro-propagation.

Two further channels double several of these without being nameable per-rule. The **meta-test** channel runs the framework on itself — [03 — Testing](03-testing.md) owns it. The **type** channel covers what the type system guarantees with no rule at all, such as the read-only accessors of a result.

The channel a rule sits on is not prose here: it is a field of `src/lint/manifest.ts`, the single source of truth from which the catalogue in [13 — Linting](13-linting.md) is generated. A rule and its normative sentence live together in the code, so the two cannot drift.

## What the tree publishes

The bundle is built by `tsdown` into `dist/` and its shape follows how each entry is consumed. `index` and `vitest`, plus the `checker`/`catalog` CLIs, are ESM-only — vitest is ESM-only and the CLIs are invoked as `node dist/*.js`. The `oxlint` plugin ships dual, because oxlint loads it from a consumer project that may itself be CommonJS.

The public import surface is one root and two tool subpaths, and that is rule F1 rather than a convention of taste: `@jterrazz/test` for everything a spec uses, `@jterrazz/test/oxlint` for the lint plugin, `@jterrazz/test/vitest` for what `vitest.config.ts` needs. The exemption is derived from the manifest's own `exports` map (`src/lint/package-exports.ts`), so a subpath is exempt the moment it is published and stops being exempt the moment it is withdrawn.

Two committed projections leave the code and land in the corpus: the API reference under `docs/reference/` (typedoc, through `typescript docs`) and the rule catalogue spliced into [13 — Linting](13-linting.md) and `skills/jterrazz-test/references/rules.md`. A third, `schema/spec.schema.json`, is generated from the document grammar's own constants and ships in the tarball. All three are regenerated by one gesture and sync-checked — see [02 — Developing](02-developing.md).

## Pitfalls

- **Reaching for a dependency from `core/`.** A new external package belongs in a folder of `integrations/` that imports it and nothing else; `core/` importing it directly is the one boundary this package cannot afford to blur, and `i1-layer-boundaries` refuses it.
- **Adding a sixth constructor.** The five are the closed vocabulary the conventions, the linter and the documentation are all shaped around. A new SUBJECT to specify is a design decision, and it earns a record in [`decisions/`](decisions/) before it earns a constructor.
- **Writing a rule's normative sentence into a chapter.** It belongs in `src/lint/manifest.ts` beside the implementation; a chapter that restates it is the second copy the whole design exists to prevent.

## Related

[02 — Developing](02-developing.md) · [03 — Testing](03-testing.md) · [12 — Conventions](12-conventions.md) · [13 — Linting](13-linting.md)
