# 03 — Testing

What proves a change here: this package specifies itself with itself. The suites under `specs/` are written with `@jterrazz/test` against fixture apps, the module tests sit beside the modules they cover, and a family of meta-tests runs the framework on its own output. This chapter says which suite answers for what, and what a change owes each of them.

| Ground         | Where                                      | Proves                                                       |
| -------------- | ------------------------------------------ | ------------------------------------------------------------ |
| Module tests   | `src/**/<file>.test.ts`                    | One module's behaviour, beside it (rule I2)                  |
| Product specs  | `specs/<facet>/<domain>/<aspect>.test.ts`  | The framework's own facets, through the public surface       |
| Spec documents | `specs/cli/literate/*.spec.yaml`           | The document format, collected as test files by `literate()` |
| Meta-tests     | `src/lint/*.test.ts`, `src/core/matching/` | The framework applied to itself and to its own projections   |

## The five projects

`test.projects` in `vitest.config.ts` declares five, and which one you can run is decided by what is installed and running on the machine.

| Project        | Collects                                                                 | Needs                                                                       |
| -------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `fast`         | `src/**/*.test.ts` + `specs/cli/**` + `specs/lint/**`                    | Nothing — Docker specs self-skip; the lint specs need `npm run build` first |
| `api`          | `specs/api/**` + `specs/jobs/**`, node mode (in-process Hono)            | Docker                                                                      |
| `api-stack`    | the SAME files with `TEST_MODE=compose`, minus `specs/api/intercepts/**` | Docker compose                                                              |
| `website`      | `specs/website/**`                                                       | playwright + `npx playwright install chromium`; no Docker                   |
| `integrations` | `specs/integrations/**`, sequential (`fileParallelism: false`)           | Docker                                                                      |

```bash
npm test                            # every project — Docker and chromium both required
npx vitest --run --project fast     # the loop: no infrastructure, after npm run build
npx vitest --run --project website  # after npx playwright install chromium
```

`api` and `api-stack` run the same test files and the mode switch lives ONLY in `vitest.config.ts` — that is rule A5 applied to this repository, and it is also the point of the two projects: fast feedback in-process, end-to-end confidence against the real stack, from one set of specs. `api-stack` excludes the intercept domain because `.intercept()` is in-process MSW, which compose mode has no access to.

There is no `specs/mobile/`, and that is a hole this chapter states rather than hides: an iOS simulator is not something CI provisions, so the mobile facet is proven by module tests under `src/core/specification/mobile/` — the simulator resolution, the page-source projection, the ambiguity messages — and by nothing end-to-end.

## How a spec tree is laid out

The layout is the one the conventions enforce on every consumer (rule C1), and this repository is its first consumer. A facet carries its runners at its ROOT and its tests one level down, in domain folders:

```
specs/
├── api/
│   ├── api.specification.ts          # runners at the facet root
│   ├── intercepts.specification.ts
│   └── requests/                     # a domain
│       ├── requests.test.ts
│       ├── _requests/                # ground: complete requests, *.http
│       └── _expected/                # ground: every expected fixture, flat
└── _fixtures/                        # the SHARED pool, reached as $FIXTURES/…
```

A test at a facet root is forbidden and a `*.specification.ts` inside a domain is forbidden; a leading underscore means ground, never a domain. Which of the two legal shapes a given tree takes — its own domain, or sibling tests in a named group folder — is decided by the assets, and that judgement is the process channel's ([12 — Conventions](12-conventions.md)).

The fixture apps the specs drive live in the pool: `app` and `website-app` for the served facets, `cli-app`, `docker-cli`, `checker-cli` and `lint-cli` for the command facets, the `broken-*` trees for the infrastructure failure paths, and `lint-violations/` — a violation/compliant twin per lint rule.

## The lint suite is end-to-end

`specs/lint/**` runs the REAL oxlint binary and the real checker over the fixture projects and goldens their output, grouped by convention family (`runners/`, `chains/`, `files/`, `assertions/`, `imports/`, `architecture/`, `hygiene/`, `checker/`). Because it loads `dist/oxlint.js`, `npm run build` must precede it — the same ordering `npm run lint` depends on.

Its goldens are full snapshots, not greps: `specs/lint/checker/_expected/*.txt` holds the exact lines the checker prints, including the chapter each message points a consumer at. A message that changes its wording moves its golden with it, in the same commit.

## The meta-test channel

Several truths about this package cannot be asserted from outside it, so they are asserted by running it on itself. Each of these exists because a defect class was found once and made unrepeatable (rule K1).

| Meta-test                                               | Holds                                                                                                                                                                                                                                             |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core/matching/match.test.ts`, `structural.test.ts` | Every `{{token}}` matches what it should and refuses what it should not — both directions                                                                                                                                                         |
| `src/lint/plugin.test.ts`                               | Catalogue **freshness** (regenerating reproduces the committed projections byte-for-byte) and **completeness** (every shipped rule carries `meta.docs`, every manifest entry maps to an implementation), plus the standing rule↔fixture inventory |
| `src/lint/docs-typecheck.test.ts`                       | Every framework code block in `docs/*.md` and `README.md` typechecks against the real surface, so a sample cannot outlive the API it calls                                                                                                        |
| `src/lint/env-allowlist.test.ts`                        | No `process.env` read outside `TEST_MODE`, `TEST_UPDATE` and vitest's own `VITEST_POOL_ID` (rule E1)                                                                                                                                              |
| `src/lint/facet-matrix.test.ts`                         | The documented per-facet method matrix still matches the real facet interfaces                                                                                                                                                                    |
| `src/lint/package-exports.test.ts`                      | The subpath exemption is read from the manifest's `exports` map, not from a list a rule remembers                                                                                                                                                 |

The freshness meta-test is the reason a documentation change can turn the suite red: edit the generated catalogue by hand and it fails, correctly. Regenerate instead — the gesture is [02 — Developing](02-developing.md)'s.

## Goldens and update mode

A fixture the framework compares against is regenerated, never hand-tuned:

```bash
TEST_UPDATE=1 npx vitest --run --project fast   # or: npx vitest --run -u
```

Update mode writes **tokens, not values**: a segment already covered by a placeholder survives, and values known to be volatile — the working directory among them — are substituted back into placeholders (rule D5). Run the suite again afterwards; a fixture that does not round-trip on the second run was not a golden, it was a transcript.

Two fixture kinds are exactly wrong to update blindly, and they are the same trap twice: one that is deliberately WRONG (its diff is the behaviour under test) and one that is deliberately MISSING (its error is the behaviour under test). Update mode overwrites both into silence — [08 — Assertions](08-assertions.md) works the case.

## What CI runs

The workflow is `.github/workflows/validate.yaml`, on every push to `main` and every pull request, delegating to the estate's shared `validate.yaml`. It restores `.artifacts/`, then runs `make build`, `make lint` and `make test` in that order, with chromium provisioned because the website specs drive a real browser. The same three targets are what a local run owes before a push; the ordering is not decorative, since lint loads what build produced.

## Pitfalls

- **Running the lint specs on a stale `dist/`.** `specs/lint/**` and `oxlint.config.ts` both load `dist/oxlint.js`. Without `npm run build`, the suite judges the previous build's rules and reports a green that means nothing.
- **Hand-editing a golden under `specs/lint/checker/_expected/`.** Those are full-output snapshots of a real binary. Change the message in the code and regenerate with `TEST_UPDATE=1`; a hand-tuned golden asserts your typing, not the checker's output.
- **Expecting `npm test` to pass with Docker stopped.** Only the `fast` project is infrastructure-free. The Docker-backed specs self-skip inside it, but `api`, `api-stack` and `integrations` fail honestly.
- **Adding a test at a facet root.** `specs/<facet>/<aspect>.test.ts` is refused by `c1-domain-structure` in this repository's default depth — the runner lives at the root, the tests live one level down.

## Related

[01 — Architecture](01-architecture.md) · [02 — Developing](02-developing.md) · [08 — Assertions](08-assertions.md) · [12 — Conventions](12-conventions.md) · [13 — Linting](13-linting.md)
