# @jterrazz/test — the corpus

The manual of this repository: what the framework is, how it is changed, what proves a change, how it is released, and one chapter per subject it holds. The vitrine is the root `README.md`; the brief a session opens first is the root `AGENTS.md`.

| Chapter                                 | Holds                                                                                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| [01 — Architecture](01-architecture.md) | The runner model behind the five constructors, the four source layers and their edges, the four enforcement channels, what the tarball publishes |
| [02 — Developing](02-developing.md)     | The repository's own loop and what a change owes; then install, first API spec, first CLI spec, the vitest preset, `TEST_MODE` / `TEST_UPDATE`   |
| [03 — Testing](03-testing.md)           | The five vitest projects, the spec-tree layout, the end-to-end lint suite, the meta-test channel, goldens and update mode                        |
| [04 — Operating](04-operating.md)       | The npm release: the version bump, the GitHub release that triggers it, what leaves the tree, what a consumer must bring                         |
| [05 — API specs](05-api.md)             | `specification.api()`: options, node vs compose, `.http` request files, inline actions, seeds, intercepts                                        |
| [06 — Jobs specs](06-jobs.md)           | `specification.jobs()`: in-process pipelines, `.trigger()`, provider error cases                                                                 |
| [07 — CLI specs](07-cli.md)             | `specification.cli()`: `.exec()`, `.env()`, fixtures and projects, `<case>.spec.yaml` documents, services, Docker-aware mode                     |
| [08 — Assertions](08-assertions.md)     | The reference: every matcher, grouped by subject, sync/async rules, `toMatch` resolution, diffs                                                  |
| [09 — Tokens](09-tokens.md)             | The `{{token}}` grammar: all 21 tokens, `#ref` captures, `match.*`, update mode                                                                  |
| [10 — Contracts](10-contracts.md)       | `defineContract` / `defineContracts`, the facade layout, selection (`times`, `required`), provider builders                                      |
| [11 — Services](11-services.md)         | `postgres` / `redis` / `sqlite`, the services record, compose conventions, per-worker isolation                                                  |
| [12 — Conventions](12-conventions.md)   | The constitution: the principles, the rule families, the process rules, the naming recap, retro-propagation (K)                                  |
| [13 — Linting](13-linting.md)           | The oxlint plugin (`@jterrazz/test/oxlint`), the conventions checker, and the GENERATED four-channel rule catalogue                              |
| [14 — Website specs](14-website.md)     | `specification.website()`: `.fetch()` / `.visit()`, visit scenarios, the element vocabulary, the `head` golden                                   |
| [15 — Mobile specs](15-mobile.md)       | `specification.mobile()`: `.open()`, simulator resolution, open scenarios, the shared vocabulary, the `screen` golden                            |

The decisions this package alone took stand in [`decisions/`](decisions/), numbered in the order they were taken, the mold `_template.md` beside them. A decision that spans several repositories belongs to the corpus that spans them. The generated API reference is [`reference/`](reference/) — a projection of the source, never authored by hand.

## How to read it

- **01 to 04 are the spine**, and they answer for the repository itself: what it is, how it is changed, what proves a change, how it ships.
- **05 to 07, 14 and 15 follow the five constructors.** Read 02, then the chapter matching what you specify — API, jobs, CLI, website, or mobile.
- **08 to 11 are shared references.** Assertions and the token grammar apply to every facet; contracts apply wherever a facet reaches the network, services wherever it has a database. The constructor chapters link into them heavily.
- **12 and 13 cover enforcement.** 12 is the constitution — the principles and the criteria no machine settles. 13 documents the static channel and carries the generated catalogue, sourced from `src/lint/manifest.ts`. The chapters explain and illustrate; the constitution and the catalogue decide.

Every chapter ends with a **Pitfalls** section — the mistakes the framework is designed to catch — and a **Related** line into its neighbours. All examples use the Given/Then comment convention the framework itself enforces (rule B4).
