# @jterrazz/test v9 — Documentation

> **Maintenance note** — This documentation is living: when implementation or usage reveals a new edge case, document it in the relevant chapter in the same change.

`@jterrazz/test` is a declarative testing framework for APIs, background jobs, CLIs, rendered websites, and native mobile apps. You describe a spec — seeds, intercepts, one terminal action — and assert on a precisely typed result with `expect()`. Fixtures are files (`_requests/*.http`, `_expected/*`, `contracts/*.ts`), dynamic values are matched with one unified `{{token}}` grammar, and infrastructure (Postgres, Redis, SQLite, Docker Compose, a real chromium, or an iOS simulator) is started, isolated per vitest worker, and cleaned up for you. Five constructors, and only five: `specification.api()`, `specification.jobs()`, `specification.cli()`, `specification.website()`, `specification.mobile()`.

```typescript
test('creates a user', async () => {
    // Given - empty database
    const result = await api.request('create-user.http');

    // Then - status + headers + body via the fixture file; row in the database
    expect(result.response).toMatch('user-created.http');
    await expect(result.table('users')).toMatchRows({
        columns: ['name'],
        rows: [['Alice']],
    });
});
```

## Table of contents

| Chapter                                       | Covers                                                                                                                       |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| [02 — Developing](02-developing.md) | Install, peer dependencies, first API spec, first CLI spec, vitest projects config, `TEST_MODE` / `TEST_UPDATE`              |
| [05 — API specs](05-api.md)                   | `specification.api()`: options, node vs compose, `.http` request files, inline actions, seeds, intercepts                    |
| [06 — Jobs specs](06-jobs.md)                 | `specification.jobs()`: in-process pipelines, `.trigger()`, provider error cases                                             |
| [07 — CLI specs](07-cli.md)                   | `specification.cli()`: `.exec()`, `.env()`, fixtures and projects, `<case>.spec.yaml` documents, services, Docker-aware mode |
| [08 — Assertions](08-assertions.md)           | The reference: every matcher, grouped by subject, sync/async rules, `toMatch` resolution, diffs                              |
| [09 — Tokens](09-tokens.md)                   | The `{{token}}` grammar: all 21 tokens, `#ref` captures, `match.*`, update mode                                              |
| [10 — Contracts](10-contracts.md)             | `defineContract` / `defineContracts`, the facade layout, selection (`times`, `required`), provider builders                  |
| [11 — Services](11-services.md)               | `postgres` / `redis` / `sqlite`, the services record, compose conventions, per-worker isolation                              |
| [12 — Conventions](12-conventions.md)         | The constitution: principles, the four enforcement channels, process rules, naming recap, retro-propagation (K)              |
| [13 — Linting](13-linting.md)                 | The oxlint plugin (`@jterrazz/test/oxlint`): rule catalogue, `recommendedRules`, the D4 conventions checker                  |
| [14 — Website specs](14-website.md)           | `specification.website()`: `.fetch()` / `.visit()`, visit scenarios, the element vocabulary, the `head` golden               |
| [15 — Mobile specs](15-mobile.md)             | `specification.mobile()`: `.open()`, simulator resolution, open scenarios, the shared vocabulary, the `screen` golden        |

## Decisions

The records of decisions this package alone took are in [`decisions/`](decisions/), numbered in the order they were taken. A decision spanning several repositories is recorded by the corpus that spans them.

## How this documentation is organized

- **Chapters 01–04, 11 and 12** follow the five constructors: read 01, then the chapter matching what you test (API, jobs, CLI, website, or mobile).
- **Chapters 05–08** are shared references — assertions and the token grammar apply to every facet; contracts apply wherever a facet reaches the network (api, jobs, and — with the `backend` option — website and mobile), infrastructure services where it has a database. They are heavily cross-linked from the constructor chapters.
- **Chapters 09–10** cover enforcement. Chapter 09 is the constitution — the principles, the four enforcement channels, and the process rules. Chapter 10 documents the static channel (the `@jterrazz/test/oxlint` plugin and the D4 conventions checker) and carries the **generated four-channel catalogue** — the normative sentence and channel of every mechanized rule, sourced from `src/lint/manifest.ts`. The chapters explain and illustrate; the generated catalogue decides.

Every chapter ends with a **Pitfalls** section (the mistakes the framework is designed to catch) and a **Related** line linking to neighbouring chapters. All examples use the Given/Then comment convention that the framework itself enforces (rule B4).
