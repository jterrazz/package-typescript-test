# Agent brief - `@jterrazz/test`

Declarative testing framework for APIs, jobs, CLIs, websites, and mobile apps. Five constructors — `specification.api()`, `specification.jobs()`, `specification.cli()`, `specification.website()`, `specification.mobile()` — with terminal actions (`.get()`/`.request()`/`.trigger()`/`.exec()`/`.fetch()`/`.visit()`/`.open()` execute and resolve to typed results) and all assertions via vitest `expect()` custom matchers. Normative rules: the constitution is `docs/12-conventions.md`, the generated per-rule catalogue is `docs/13-linting.md` (mirrored for agents in `skills/jterrazz-test/references/rules.md`); narrative docs in `docs/`, mapped by `docs/README.md`; decisions this package alone took are in `docs/decisions/`.

## Setup

```bash
npm install
```

Requires Docker running for HTTP and adapter tests.

## Commands

| Task                             | Command                           |
| -------------------------------- | --------------------------------- |
| Run all tests                    | `npm test`                        |
| Run fast tests only (no infra)   | `npx vitest --run --project fast` |
| Build the bundle                 | `npm run build`                   |
| Lint + format + typecheck + knip | `npm run lint`                    |
| Auto-fix lint issues             | `npm run lint:fix`                |
| Generate API docs + catalogue    | `npm run docs` (or `make docs`)   |

## Repo layout

```
src/
├── index.ts                       # public entry — the ONLY import point (F1) + composition root wiring the integration registry (I1)
├── core/                          # zero external imports (node builtins allowed) — CONVENTIONS I1; module unit tests are SIBLINGS: `<file>.test.ts` next to `<file>.ts` (I2)
│   ├── specification/
│   │   ├── shared/                # specification.{api,jobs,cli} object, SpecificationBuilder + facets (builder.ts),
│   │   │   │                      #   caller.ts (test-file detection), resolve.ts (root discovery A9 + realpath/`$WORKDIR` expansion), reporter.ts,
│   │   │   │                      #   orchestrator.ts (container lifecycle), registry.ts (integration seam),
│   │   │   │                      #   compose-file.ts (compose types + detection), services.ts (isolation/startup helpers)
│   │   │   └── result/            # BaseResult + read-only accessors (stream, json, filesystem, directory, response, table, grep)
│   │   ├── api/                   # startApi constructor + HttpResult + fetch adapter
│   │   ├── jobs/                  # startJobs constructor
│   │   ├── cli/                   # startCli constructor + CliResult + exec adapter + the `<case>.spec.yaml` engine
│   │   ├── website/               # startWebsite constructor + FetchResult/PageResult + serve adapter (local server) + element vocabulary (SHARED with mobile)
│   │   └── mobile/                # startMobile constructor + ScreenResult + simctl simulator resolution + appium server spawn + page-source projection + mobile ambiguity
│   ├── literate/                  # the `<case>.spec.yaml` grammar (parser + update writer + JSON Schema) — read by the runner AND by the lint checker
│   ├── matching/                  # match.* vocabulary + {{token}} structural comparison engine
│   ├── http-files/                # _requests/*.http + _expected/*.http (responses) parser/serializer
│   ├── contracts/                 # defineContract/defineContracts + contract types + ContractQueue (the ONE selection engine) + generic http provider + provider text filters (no external dep)
│   └── ports/                     # ALL interfaces: database, service, isolation, container, server, command, browser, device
├── integrations/                  # one folder = one external dependency (I1), each imports only its own dep + core
│   ├── postgres/  ├── redis/  ├── sqlite/        # service handles
│   ├── testcontainers/  ├── compose/  ├── yaml/  # container runtimes + the yaml document wrapper (comments and key order survive)
│   ├── docker/                    # docker CLI shell-outs: ContainerAccessor, docker-lookup
│   ├── hono/                      # in-process server adapter
│   ├── playwright/                # chromium browser adapter for specification.website() — optional peer dep, lazily imported
│   ├── appium/                    # XCUITest device adapter (webdriverio) for specification.mobile() — optional peer dep, lazily imported
│   ├── msw/                       # contract registration engine (drives core's ContractQueue)
│   └── openai/  └── anthropic/    # intercept providers
├── vitest/                        # ALL runner coupling: expect() matchers, TEST_UPDATE / -u detection, mockOf, mockOfDate + index.ts, the `@jterrazz/test/vitest` subpath exporting the literate() vite plugin (imported by vitest.config.ts, never by a spec)
└── lint/                          # tool-facing static channel (I1: zero runtime imports): oxlint plugin (dist/oxlint.js) — one file per jterrazz/<rule> under rules/ (each carries its normative text as meta.docs from manifest.ts) + ast/fs-cache helpers, D4 conventions checker (checker.ts + checker-spec.ts document passes + dist/checker.js CLI, `--fix` for the rewritable ones), catalogue manifest + generator (manifest.ts is the SOURCE OF TRUTH for the mechanized catalogue; catalog.ts → dist/catalog.js regenerates the docs/13-linting.md catalogue + skills/jterrazz-test/references/rules.md), catalogue freshness+completeness meta-test (plugin.test.ts)
specs/                             # ONLY product specifications (I2), written with @jterrazz/test
# LAYOUT (rule C1'): specs/<facet>/ carries its runner(s) at the ROOT (specs/<facet>/<name>.specification.ts);
# tests live one level down in DOMAIN folders (specs/<facet>/<domain>/<aspect>.test.ts). Tests at the facet
# root are forbidden; specs inside a domain are forbidden. "The folder follows the assets": a test with its
# OWN asset dirs (_seeds/, _expected/, …) gets its own domain; asset-less tests group as sibling <id>.test.ts in a
# named GROUP folder (e.g. specs/lint/hygiene/j5-lowercase-title.test.ts).
├── api/                           # api facet: api.specification.ts + intercepts.specification.ts at root; domains: assertions, intercepts (D7, node-only), lifecycle, requests, responses, seeding
├── jobs/                          # jobs facet: jobs.specification.ts (factory) + static-jobs.specification.ts (array) at root; domain: triggering
├── cli/                           # cli facet: cli.specification.ts + db/docker/transform/asymmetric-transform/literate runners at root; domains: assertions, directory, docker, env, exec, literate (the .spec.yaml document, run through BOTH doors), seeding, tokens
├── website/                       # website facet: website.specification.ts at root; domains: behavior (visit scenarios), visit (head/jsonLd goldens), fetch (raw exchanges), console (streams) — needs playwright chromium, no Docker
├── integrations/                  # per-dependency tests: container-logs, initiation-errors, orchestrator, postgres, redis — Docker required, sequential
├── lint/                          # E2E lint facet: lint.specification.ts + checker.specification.ts at root; tests grouped by CONVENTIONS family: runners/ chains/ files/ assertions/ imports/ architecture/ hygiene/ checker/ (needs npm run build first)
└── _fixtures/                     # SHARED fixture pool (reached via .fixture('$FIXTURES/…')): app, cli-app, docker-cli, broken-* infra fixtures, and lint-violations/ (per-rule violation+ok twins for the E2E lint specs)
```

## Test runner modes

`test.projects` in `vitest.config.ts` defines five projects (vitest 4 removed workspace files):

| Project        | Includes                                                                             | Infra                                                                | Tests           |
| -------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | --------------- |
| `fast`         | `src/**/*.test.ts` (sibling module tests) + `specs/cli/**` + `specs/lint/**`         | none (docker specs self-skip; lint specs need `npm run build` first) | 773             |
| `api`          | `specs/api/**` + `specs/jobs/**` — node mode, in-process Hono + testcontainers       | Docker                                                               | 52              |
| `api-stack`    | same files, `env: { TEST_MODE: 'compose' }`, **excludes** `specs/api/intercepts/**`  | Docker compose                                                       | 38 (+1 skipped) |
| `website`      | `specs/website/**`                                                                   | none — needs playwright + `npx playwright install chromium`          | 10              |
| `integrations` | `specs/integrations/**` — container lifecycle, sequential (`fileParallelism: false`) | Docker                                                               | 54              |

`api` and `api-stack` run the **same test files**; the mode switch lives ONLY in `vitest.config.ts` (CONVENTIONS A5). `api-stack` excludes `specs/api/intercepts/**` because `.intercept()` is in-process MSW and unavailable in compose mode (I3/D7) — the one skipped stack test reflects that boundary. The framework reads exactly two env vars: `TEST_MODE` and `TEST_UPDATE` (E1). Counts are indicative — run `npx vitest --run --project <name>` to confirm.

## Conventions

- **Docs-as-code split.** `docs/12-conventions.md` is the hand-maintained **constitution** — principles, the enforcement channels, non-mechanizable criteria, process rules (C1 grouping, D11 golden-file, K1 retro-propagation), design rationales — organized by family (A runners, B chains + `job` vocab, C files/folders, D assertions/tokens, E env, F imports, G infra, H naming, I architecture, J hygiene, K retro-propagation). The **mechanized per-rule catalogue is GENERATED from the code** (`src/lint/manifest.ts`) into the `docs/13-linting.md` catalogue + `skills/jterrazz-test/references/rules.md` — never edit those by hand; add a mechanized rule to the manifest + its implementation, then `npm run docs`. No duplication: a machine-checkable rule is written once, in the code. The broader corpus/projections doctrine lives in `@jterrazz/typescript`'s `docs/06-repo-structure.md`.
- Each mechanized rule names one of **four enforcement channels** — **static** (`jterrazz/*` oxlint plugin + the D4 conventions checker `dist/checker.js`), **checker** (bundled cross-file/token/document passes: C9, B5-by-inference, A7, D4/D4b/D10, and the `<case>.spec.yaml` family), **runtime** (framework refuses misuse: A6, A7, B2, B6, D7, I3), **process** (review-borne: C1, D11, K1) — plus the **meta-test** channel (framework run on itself: every token has a +/- test in `src/core/matching/`; the catalogue stays fresh via `src/lint/plugin.test.ts`). Most enforcement is programmatic, not manual review.
- Lint config (`@jterrazz/typescript` - oxlint + oxfmt + knip + tsgo); the tsconfig typechecks `src/` AND `specs/` (fixtures excluded) — keep it that way, it's what catches result-typing regressions
- **Self-lint**: `oxlint.config.ts` loads `./dist/oxlint.js` via `jsPlugins`, spreads `recommendedRules`, and DECLARES this package's I1 layer map (`FRAMEWORK_LAYERS`) — the rule ships inert, an architecture is the project's to state — so `npm run build` MUST precede `npm run lint`. E2E lint specs live in `specs/lint/**` (one violation/compliant fixture pair per rule under `specs/_fixtures/lint-violations/`), the checker step is chained in `npm run lint`. Docs: `docs/13-linting.md`
- Test writing convention (`// Given -` / `// Then -` comments, always both)
- Directory layout per feature (`_seeds/` SQL-only, `_fixtures/` feature-local, `_requests/` inputs, `contracts/` — a `*.contracts.ts` facade over `<provider>/` units and their data (C4/C10/C11), `_expected/` — all expected fixtures incl. response `.http`, flat, extension in the name); shared fixtures live in `specs/_fixtures/`, reached via `.fixture('$FIXTURES/…')`. One file-state verb `.fixture(path)` (no `.project()`, no `seedHandlers`); `.seed()` is SQL-only (C7)
- Runners are created in `*.specification.ts` files and destructured with canonical names: `{ api, cleanup }`, `{ jobs, cleanup }`, `{ cli, cleanup }` — always `afterAll(cleanup)`
- Accessors are read-only; ALL assertions go through `expect()` — `expect(result.stdout).toContain(...)`, `expect(result.response).toMatch('created.http')`, `await expect(result.table('users', { database: 'db' })).toMatchRows(...)`
- Dynamic values: the `{{token}}` grammar in fixtures, `match.*` in code (same vocabulary; see `docs/09-tokens.md`)
- Snapshot fixtures update with `TEST_UPDATE=1` (or vitest `-u`) — tokens are preserved, `{{workdir}}` is substituted

## Self-test on changes

This package self-tests via its own framework. Tests under `specs/cli/` use `specification.cli()` against a fixture CLI app; `specs/api/` + `specs/jobs/` + the sibling `src/**/<file>.test.ts` module tests cover the api/jobs facets and the token grammar. When you change `SpecificationBuilder`, the matchers, or the structural engine, these are the canonical regression coverage.

## Docs

- `docs/` — narrative chapters, numbered: `01` getting-started, `02` api, `03` jobs, `04` cli (incl. the `<case>.spec.yaml` document format), `05` assertions, `06` tokens, `07` contracts, `08` services, `09` conventions, `10` linting, `11` website, `12` mobile (each ends with Pitfalls + Related)
- `npm run docs` regenerates the three committed projections: the API reference (`docs/reference/`, typedoc via `typescript docs` — a code → docs cross-layer projection), the rule catalogue (`docs/13-linting.md` + `skills/jterrazz-test/references/rules.md`, spliced from `src/lint/manifest.ts`), and `schema/spec.schema.json` (from the grammar's own constants). All three are sync-checked: `npm run lint` runs `docs --check` (the Docs sync pass) + the catalogue freshness meta-test — both must hold after one `npm run docs`
- Docs are committed and consumed in-repo (chapters under `docs/`, the API reference under `docs/reference/`, agent routing via `skills/jterrazz-test/`); there is no rendered site and nothing is published from `docs/`
- **Standing instruction (rule K1): a discovery — new edge case, defect, behavior change — grows a guard (static rule / meta-test / runtime error) that stops it recurring, in the same change.** A mechanized rule goes into `src/lint/manifest.ts` (+ its implementation), then `npm run docs` regenerates the `docs/13-linting.md` catalogue + `skills/jterrazz-test/references/rules.md`; a new principle or non-mechanizable criterion goes into the `docs/12-conventions.md` constitution. Update `docs/` alongside. When the public API changes, also update `README.md`, `skills/jterrazz-test/SKILL.md` + its `references/`.
