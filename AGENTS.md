# Agent brief — `@jterrazz/test`

A declarative testing framework for HTTP APIs, background jobs, CLIs, rendered websites and native mobile apps, plus the oxlint plugin and checker that enforce its conventions. This file **routes**; it never restates what the corpus already says.

## Mental model

- **Five constructors, and only five.** `specification.api()`, `.jobs()`, `.cli()`, `.website()`, `.mobile()` — each returns a handle, each chain is zero or more setups closed by exactly ONE terminal action, and every assertion goes through vitest's `expect()`. A sixth subject is a decision before it is a constructor.
- **Four layers with declared edges.** `core/` (no external imports), `integrations/<dep>/` (one folder per dependency), `vitest/` (all runner coupling), `lint/` (no runtime imports). The map is stated as `FRAMEWORK_LAYERS` in `oxlint.config.ts` and enforced from there.
- **The code owns the rules.** A mechanized rule's normative sentence lives in `src/lint/manifest.ts` beside its implementation, and the catalogue is GENERATED from it. Add a rule to the manifest, never to a chapter.
- **The package specifies itself with itself.** `specs/` is written with `@jterrazz/test` against fixture apps, and a family of meta-tests runs the framework on its own output.
- **The build precedes the lint.** `oxlint.config.ts` and the lint specs load `./dist/oxlint.js`, so `npm run build` comes first — always.

## Where knowledge lives (route here first)

The corpus is `docs/` + `README.md`, mapped by [`docs/README.md`](docs/README.md). Do not duplicate it — link to it.

| Working on…                                       | Read                                           |
| ------------------------------------------------- | ---------------------------------------------- |
| The layers, the runner model, the channels        | `docs/01-architecture.md`                      |
| The loop, which file a change opens, what it owes | `docs/02-developing.md`                        |
| The projects, the spec tree, the meta-tests       | `docs/03-testing.md`                           |
| The npm release and what ships                    | `docs/04-operating.md`                         |
| A facet: api · jobs · cli · website · mobile      | `docs/05` · `06` · `07` · `14` · `15`          |
| Matchers, the `{{token}}` grammar                 | `docs/08-assertions.md` · `docs/09-tokens.md`  |
| Contracts, services and compose                   | `docs/10-contracts.md` · `docs/11-services.md` |
| The principles, and what review must judge        | `docs/12-conventions.md`                       |
| Rule ids, channels, the generated catalogue       | `docs/13-linting.md`                           |

Decisions this package alone took are in `docs/decisions/`. The agent-facing projection of the corpus is `skills/jterrazz-test/` — a routing layer, not a second copy.

## Setup & commands

```bash
npm install                       # or make install
npm run build                     # MUST precede lint and the fast project
npm run lint                      # typescript check + the conventions checker
npm test                          # every project — needs Docker and chromium
npm run docs                      # regenerate the three committed projections
npx vitest --run --project fast   # the loop, no infrastructure
```

## Standing rules

- **A discovery grows a guard, in the same change** (rule K1) — a static rule, a meta-test, or a runtime refusal, or an explicit note of why no channel can hold it.
- **Never edit a generated file.** `docs/reference/`, the catalogue between the `GENERATED:catalog` markers of `docs/13-linting.md`, `skills/jterrazz-test/references/rules.md` and `schema/spec.schema.json` all come from `npm run docs`. A hand edit fails the sync check and the freshness meta-test.
- **Four things land with the change that makes them true** — the guard, the regenerated projections, the chapter the behaviour falsified, and the skill when the public surface moved. Each is stated once, in `docs/02-developing.md` § What a change owes.
- **A rule belongs in the code, a principle in the constitution.** `src/lint/manifest.ts` for the first, `docs/12-conventions.md` for the second; neither ever holds a copy of the other.
