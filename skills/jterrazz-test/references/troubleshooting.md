# Troubleshooting — symptom → fix

Operative index. Each fix names the rule and the chapter whose **Pitfalls** section explains it. When a symptom isn't here, read the Pitfalls section of the matching chapter ([05](../../docs/05-api.md)–[13](../../docs/13-linting.md)).

## Assertions & accessors

| Symptom                                                  | Fix                                                                                                               |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `result.stdout.toContain is not a function`              | Accessors are read-only — write `expect(result.stdout).toContain(...)` (D1). [08](../../docs/08-assertions.md)    |
| `result.grep is not a function`                          | `grep` lives on the text handle — `result.stdout.grep(pattern)` (returns a `TextAccessor`), never `result.grep()` |
| A wall of `.grep()` on one shared run                    | Anti-pattern (D11) — one fixture project per use case, snapshot the whole output; grep is the scalpel             |
| An amas of `.response.body` probes / a lone status probe | Golden it: `expect(result.response).toMatch('case.http')` (d12w / d15w). [05](../../docs/05-api.md)               |
| `"fixture ... does not exist"`                           | All expected fixtures live FLAT under `<test-dir>/expected/` (a slash = subfolder). Create with `TEST_UPDATE=1`   |
| Fails on a uuid/timestamp/path that changes              | Tokenize: `{{uuid}}`, `{{iso8601}}`, `{{workdir}}`, `{{uuid#ref}}`; in code `match.*`. [tokens.md](tokens.md)     |
| Noisy stdout comparison                                  | ANSI is already stripped (`.text` stays raw); prefer tokens; `transform` is last-resort (D6)                      |
| `toMatch(/regex/)` throws on an accessor                 | Accessor `toMatch` takes a fixture NAME (D14) — use `expect(x.text).toMatch(/re/)` for a regex                    |

## Runners, services, seeding

| Symptom                                                                                         | Fix                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `specification.app does not exist`                                                              | Only five constructors: `.api()`, `.jobs()`, `.cli()`, `.website()`, `.mobile()` (A2)                                                                                              |
| `seed() targets database "..." not found`                                                       | `database` takes the services RECORD KEY (`{ analyticsDb: ... }` → `'analyticsDb'`), not the compose name                                                                          |
| `N databases are declared — pass { database }` / `redundant database option`                    | A7 cuts both ways: mandatory with ≥ 2 DBs, forbidden with 1                                                                                                                        |
| Service ignores compose image/env                                                               | A handle binds to the compose service named like its key, else kebab-case; use `composeService` only for non-derivable names                                                       |
| `Ambiguous compose binding for service key "..."`                                               | Compose declares both the exact key and its kebab-case form — rename one or set `composeService` (A6)                                                                              |
| cli spec can't find its files                                                                   | Every `.exec()` runs in a fresh temp dir — populate it with `.fixture('$FIXTURES/name/')` or `.fixture('file')`. No `.project()` (C7)                                              |
| cli spec green on one machine, red on another / needs a real `kubectl`, `gh`                    | The chain is escaping the sandbox — mount a stub fixture and pin `PATH: '$WORKDIR/bin:/usr/bin:/bin'` + `HOME: '$WORKDIR'`. [07](../../docs/07-cli.md)                             |
| `database is locked` on a cold sqlite cache / a suite pinned to `fileParallelism: false` for it | Fixed since 14.1.0 — the template build takes an exclusive lock and the losers WAIT. Upgrade, then drop the pin. [11](../../docs/11-services.md#one-worker-builds-the-others-wait) |
| `no such table` in a sqlite spec after switching branch or checkout                             | The template is keyed on the schema and cached at `.artifacts/vitest/sqlite/` — per project since 14.1.0. Delete that folder to force a cold rebuild                               |
| `prismaSchema` green locally, "Could not find Prisma Schema" in CI                              | The cached template hides the cold path — `rm -rf .artifacts/vitest/sqlite` and re-run. [11](../../docs/11-services.md)                                                            |

## Intercepts, docker, modes

| Symptom                                            | Fix                                                                                                       |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `Unmatched outgoing HTTP request during spec: ...` | Strict contracts (D7) — declare the call (or raise its `times`); the error lists every declared route     |
| `.intercept(): ... not available in compose mode`  | Contracts run through in-process MSW (I3) — move the spec to a node-only project; `api-stack` excludes it |
| `jobs.trigger` fails in the compose project        | It doesn't — `specification.jobs()` has no mode, always runs in-process whatever `TEST_MODE` says         |
| `CliResult.container: runner was not configured`   | `.container(name)` needs `docker: { envVar, nameLabel, testRunLabel }` in the cli options                 |
| Leaked containers after a docker-aware spec        | Bind the result with `await using` (B5) so containers are force-removed at scope exit                     |

## Layout & architecture

| Symptom                                                                            | Fix                                                                                                                                                  |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| A `src/` module test needs a real file or real infra                               | It's a specification, not a unit test — move it to `specs/` (I2/I4). Under `src/`, mocks/data are CODE (`mockOf`, `.fixtures.ts`)                    |
| Lint error on runner placement                                                     | Runner → facet root (`specs/<facet>/<name>.specification.ts`); tests → facet/domain depth (C1)                                                       |
| Uppercase test title rejected                                                      | Titles start lowercase (J5) — a prose fragment, not a sentence (titles opening on a non-letter are exempt)                                           |
| A `// Then -` marker ended up inside a `const a = …, b = …` chain after `lint:fix` | `one-var`'s fixer fused the declarations and swallowed the marker — a marker goes between STATEMENTS. [13](../../docs/13-linting.md)                 |
| The second line of a marker was capitalised mid-sentence                           | `capitalized-comments` capitalises every `//` line — a marker is EXACTLY one line; long reasoning goes in a docblock. [13](../../docs/13-linting.md) |
| Rule id / channel lookup                                                           | [references/rules.md](rules.md) (generated) · [docs/13-linting.md](../../docs/13-linting.md)                                                         |
