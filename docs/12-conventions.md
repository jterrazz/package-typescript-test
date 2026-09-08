# 12 — Conventions: the constitution

This chapter is the **constitution**: the principles, the non-mechanizable criteria, and the design rationales behind the conventions. It is hand-maintained and stable.

The **mechanized per-rule catalogue** does not live here — it is **generated from the code** (`src/lint/manifest.ts`, where each rule carries its own normative text) into the [13 — Linting](13-linting.md) catalogue and the agent-facing [`skills/jterrazz-test/references/rules.md`](../skills/jterrazz-test/references/rules.md).

This is the **docs-as-code inversion**: the code is the source of truth for the mechanized rules (a rule and its normative text live together, so they cannot drift), and this constitution is the source of truth for the principles. There is **no duplication** — a machine-checkable rule is written once, in the code. The broader repo-layout doctrine this follows — a written corpus, thin injection layers, a compiler that projects; committed projections against CI-built presentations — is `jterrazz-studio`'s repo-structure chapter, its canonical home for every language.

Guiding aim: **most enforcement is programmatic, not manual review.**

Which CHANNEL holds a given rule — static, checker, runtime, process, and the meta-test and type channels that double them — is not this chapter's: it is [01 — Architecture](01-architecture.md), where the shape of the enforcement machinery is drawn. What follows is what the rules SAY and what a reviewer must judge.

## The rule families

The catalogue is organized by family. Each family's usage is illustrated in the chapters; the generated catalogue in [13 — Linting](13-linting.md) carries the normative sentence and channel of every rule.

| Group | Scope                                                                | Explained in                                                          |
| ----- | -------------------------------------------------------------------- | --------------------------------------------------------------------- |
| A     | Runner creation (constructors, services, root)                       | [02](02-developing.md), [05](05-api.md), [11](11-services.md)         |
| B     | Spec chains (setups, terminal actions, Given/Then, `job` vocabulary) | [05](05-api.md), [06](06-jobs.md), [07](07-cli.md)                    |
| C     | Files & folders per feature                                          | [02](02-developing.md), [08](08-assertions.md), [10](10-contracts.md) |
| D     | Assertions, tokens, snapshots, strict contracts                      | [08](08-assertions.md), [09](09-tokens.md), [10](10-contracts.md)     |
| E     | Framework environment variables                                      | [02](02-developing.md)                                                |
| F     | Imports (single package root) & production protection                | [02](02-developing.md)                                                |
| W     | Website & mobile specs (scenarios, user-facing elements)             | [14](14-website.md), [15](15-mobile.md)                               |
| G     | Infrastructure (compose, isolation, docker-aware)                    | [07](07-cli.md), [11](11-services.md)                                 |
| H     | Naming recap                                                         | below                                                                 |
| I     | Source-code architecture (four layers, sibling module tests)         | below · [01](01-architecture.md) for this repo's own layer map        |
| J     | Hygiene (no `.only`/`.skip`, no arbitrary sleeps)                    | [13](13-linting.md)                                                   |
| K     | Retro-propagation — every defect class grows its own guard           | below                                                                 |

## The reach of the conventions

The framework and the conventions do not have the same scope, and confusing the two is the commonest misreading of this constitution. `specification.*` — with its seeds, fixtures, contracts, goldens and containers — is for specifying a **surface**: an HTTP API, a background job, a CLI, a rendered page, a native screen. A plain unit test of a pure function, or a frontend component test, has no such surface and needs none of it.

The conventions bind **every test file of the repository**, that plain unit test included, whether or not `@jterrazz/test` is imported in it. A test is a test: it sits beside the module it covers (I2), it narrates its Given then its Then (B4), it keeps its doubles out of `src/` (I4), and it stays honest under the J hygiene rules — no committed `.only`/`.skip`, an assertion in every test, no two literal titles alike in a file. Only J2, the arbitrary-sleep ban, is narrowed to `specs/**`, where waiting is a real temptation. Every one of these is mechanized, so its normative sentence lives in the catalogue ([13 — Linting](13-linting.md)) and not here.

The reason for the wide reach: a repository has **one** way to write a test, so a reader moving between a sibling module test and a spec of a surface reads the same shape and the tooling has a single target. A rule that applied only to framework tests would leave the majority of test files — the plain ones — unguarded.

## Process rules (review-borne)

Three rules cannot be mechanized — they turn on judgement no single channel can settle. They are listed in the catalogue for completeness, but their full rationale lives here.

### C1 — the folder follows the assets

The grouping criterion: a test that owns **its own** asset directories (`_fixtures/`, `_expected/`, `_seeds/`, …) gets **its own** domain folder; tests **without local assets** (or sharing the `$FIXTURES/` pool) group as sibling `<aspect>.test.ts` files inside a named **group** folder. Both shapes are legal — the assets decide, and a nascent single-test domain is legitimate. The static rule `c1-domain-structure` checks only placement; which of the two shapes is right is the review call.

Placement itself is **declared**, because a spec tree may legitimately have a shape this package cannot know:

```jsonc
"jterrazz/c1-domain-structure": ["error", { "depth": "facet-domain" }] // the default
```

| `depth`          | The tree                                                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `'facet-domain'` | the default and the historical rule — `specs/<facet>/<domain>/<aspect>.test.ts`, `*.specification.ts` at the facet root                                             |
| `'facet'`        | the assets decide the folder — a test at the facet root (`specs/<facet>/<aspect>.test.ts`) OR one domain down, never deeper; `*.specification.ts` at the facet root |
| `'mirror'`       | the tree mirrors a structure outside itself (a command tree, a source tree): a test at any depth ≥ 1, named `<dir>/<dir>.test.ts`                                   |
| `'off'`          | no placement check — for a tree whose shape is guarded by something stronger and project-specific                                                                   |

A project states the shape it has — `facet` when asset-less tests sit beside their siblings at the facet root, `mirror` when the tree mirrors something outside itself — and keeps a checked shape, instead of switching the rule off and keeping none.

One clause of the rule is not the project's to declare, and holds in every mode, `off` included: **a folder whose name carries a leading underscore is ground, never a domain**, so no spec lives inside one. Depth is a shape a tree may choose; the ground/member split is the naming law recapped under [H](#h--naming-recap).

Ground is not always inert. It may be **code** the specs stand on — the build of the subject under test, a harness the runner spawns — and code carries its unit test as a sibling under [I2](#i--architecture). So the clause lets exactly one pairing through: `<module>.test.ts` NEXT to the `<module>.ts` it is named after, inside the ground it belongs to. A test with no module beside it, or a `*.specification.ts`, is a spec that wandered in and is still reported — which is why the clause needs no `off`, and why no project has to switch off a rule it cannot switch off.

### D11 — golden-file, not a cluster of greps

A tool's output (a linter, a compiler, a product CLI) is asserted as a **full snapshot per scoped use case**. Each case gets **its own fixture project** (its small valid/invalid files) — the fixture IS the Given, no shared `beforeAll` state — and the assertion is the whole snapshot (`expect(result.stdout).toMatch('<use-case>.txt')` + `exitCode`), volatile parts covered by tokens, generated with `TEST_UPDATE=1`.

`.grep()` / `toContain` remain the **scalpel** — targeted probes, never the default mode. They are legitimate only for:

- **(a)** assertions of **absence**;
- **(b)** output **cut at an arbitrary instant** (`waitFor`, a long-running process);
- **(c)** **container-log probes**;
- **(d)** asserting **rule ids** in the E2E lint specs (avoiding coupling to a third-party binary's exact format);
- **(e)** probes into **third-party-formatted** output.

Every other use is converted to a full snapshot. A single "kitchen-sink" project + full snapshot serves as the whole-surface regression net (it churns — that is its job). The static channel cannot tell a legitimate grep from a lazy one, hence the process channel. The mechanized boundary for API responses (an amas of raw `.response.body` probes, or a lone HTTP-status probe) is caught by `d12w`/`d15w`; the negative-fixture guard is `d13w` (wrapped forms) plus a process rule for helper-routed residue.

### K1 — retro-propagation

Every defect class discovered (review, bug, migration) grows, **in the same change**, the guard that stops it recurring — a static rule, a meta-test, or a runtime error — or an explicit note of why no channel is possible (e.g. "redundant test" is a human judgement). This is the rule that keeps the other three channels growing instead of decaying. When a defect class is mechanizable, its rule joins `src/lint/manifest.ts` and the catalogue regenerates.

## H — Naming recap

One rule decides every folder of a spec tree: **what a spec stands on carries the underscore; a spec's own folder never does.** The four names are `_fixtures/`, `_expected/`, `_requests/` and `_seeds/` — inert material the framework resolves by path. A facet, a domain, and `contracts/` are members of the row, not ground: a contract is TypeScript a spec imports, so it stays bare. `docker/` sits at the project root, outside any row of specs, and is untouched by the rule.

Two further rules decide WHERE a fixture lives, and they are the same question asked twice. **The pool is for what several leaves share**: a directory of `specs/_fixtures/` that exactly one spec directory reaches for belongs beside that leaf, as `<leaf>/_fixtures/<name>/` (C14, autofixed by `jterrazz-test-check --fix`). **A leaf's own ground is reached only from that leaf**: a `.fixture()` path that climbs out of the referring spec's `_fixtures/` is an error, and the sharing it wants is what the pool declares (C15).

| Thing           | Rule                                                                                                                        |
| --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Specs root      | `specs/` (`api/`, `jobs/`, `cli/`, `website/`, `mobile/`, `integrations/`, `lint/`, `_fixtures/`)                           |
| Specification   | `specs/<facet>/<name>.specification.ts` (at the facet root)                                                                 |
| Instances       | `api`, `jobs`, `cli`, `website`, `mobile` — enforced by the destructuring (A3)                                              |
| Test file       | `specs/<facet>/<domain>/<aspect>.test.ts`                                                                                   |
| Spec document   | `<case>.spec.yaml`, beside the spec it belongs to — never under `_expected/` ([07](07-cli.md#spec-documents--casespecyaml)) |
| Module test     | `<file>.test.ts`, sibling of `<file>.ts` (under `src/`)                                                                     |
| Module fixtures | `<file>.fixtures.ts`, sibling of the `.test.ts` (typed exports)                                                             |
| Contracts       | `contracts/<name>.contracts.ts` (facade) · `contracts/<provider>/<name>.ts` (unit, provider ∈ http\|openai\|anthropic)      |
| Contract data   | `contracts/<provider>/<name>[.<qualifier>].response.json` (served) · `<name>.request.ts` (matched)                          |
| Requests        | `_requests/<name>.http` (inputs)                                                                                            |
| Seeds           | `_seeds/<name>.sql` (database state)                                                                                        |
| Fixtures        | `_fixtures/<name>` (file state) — the leaf's own; the shared pool is `specs/_fixtures/`, reached by `$FIXTURES/`            |
| Snapshots       | `_expected/<name>` (all expected, flat, extension included — incl. response `.http`)                                        |
| Service keys    | derive the compose service: exact name, else kebab-case (unless explicit `composeService:`)                                 |
| Framework env   | `TEST_MODE`, `TEST_UPDATE`                                                                                                  |

## I — Source-code architecture

Family I governs the source tree rather than the spec tree, and it splits in two.

**The layer map is the project's to declare.** `i1-layer-boundaries` ships **inert**: this package cannot know another repository's architecture, so the rule enforces nothing until the project states its own layers in `oxlint.config.ts`. What THIS repository declares there, and why each sanctioned edge exists, is [01 — Architecture](01-architecture.md) — a consumer's own map is its own chapter's, written the same way.

**The test-file rules need no declaration.** I2 (a module's test is its sibling) and I4 (no `vi.mock`, `__mocks__/`, `__fixtures__/` or data-asset imports under `src/`) hold in any repository that adopts this preset — they are part of the floor described above, not of the layer map. A module's typed fixtures are a sibling `<file>.fixtures.ts`, as the naming recap says.

## Maintaining the constitution

- A new **mechanizable** rule is added to the **code** (`src/lint/manifest.ts` + its implementation), not here — then `npm run docs` regenerates the catalogue. The freshness meta-test fails if the committed catalogue is no longer byte-identical.
- A new **principle** or a non-mechanizable criterion is added here, in its family section or as a process rule.
- Never duplicate a mechanized rule in this constitution: the code is its single source of truth.

## Pitfalls

- **Treating these docs as the spec.** They explain and illustrate; this constitution and the generated catalogue ([13 — Linting](13-linting.md)) decide. When you find a discrepancy in the docs, fix the docs in the same change — [02 — Developing](02-developing.md) § What a change owes.
- **Editing the generated catalogue by hand.** The [13 — Linting](13-linting.md) catalogue and `skills/jterrazz-test/references/rules.md` are GENERATED from `src/lint/manifest.ts` — a hand edit is overwritten by the next `npm run docs` and fails the freshness meta-test. Change the rule's text in the code; regenerate.
- **Adding a mechanized rule to the constitution.** A machine-checkable rule lives in the code (its `meta.docs` / the manifest), not in this chapter. The constitution holds principles and non-mechanizable criteria only.

## Related

[01 — Architecture](01-architecture.md) · [02 — Developing](02-developing.md) · [03 — Testing](03-testing.md) · [08 — Assertions](08-assertions.md) · [13 — Linting](13-linting.md)
