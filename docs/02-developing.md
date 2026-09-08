# 01 — Getting started

This chapter takes you from `npm install` to two passing specs: one HTTP API spec backed by a real Postgres container, and one CLI spec running a binary in a fresh temp directory. It also explains the two framework environment variables (`TEST_MODE`, `TEST_UPDATE`) and where the node/compose switch lives.

## Install

```bash
npm install -D @jterrazz/test vitest
```

Peer dependencies:

| Package  | Required | Needed for                                                    |
| -------- | -------- | ------------------------------------------------------------- |
| `vitest` | yes      | Everything — the framework registers its matchers into vitest |

`msw` (outgoing HTTP interception for `.intercept()`) ships as a direct dependency — no separate install. In-process API specs (`specification.api()` in node mode) pass your web app to `server`; the adapter only needs an object with a `request()` method, so bring your own web framework (e.g. `hono`) in your project.

**Docker** must be running for container-backed services (`postgres()`, `redis()`) and for compose mode. `sqlite()` and plain CLI specs need no Docker.

Trying an unreleased branch of the framework: install a `npm pack` tarball, never a `file:` link — a link makes the consumer resolve `vitest`'s types twice, and the matcher augmentation then lands on one copy and not the other, so `toMatch` types while `toBeEmpty` does not.

Everything imports from the single package root — the only importable subpaths are the ones the package's `exports` map publishes for TOOLS (`@jterrazz/test/oxlint` for the lint plugin, `@jterrazz/test/vitest` for what `vitest.config.ts` needs); internal subpaths do not exist (rule F1):

```typescript
import {
    specification,
    postgres,
    redis,
    sqlite,
    defineContract,
    openai,
    anthropic,
    http,
    match,
    mockOf,
    mockOfDate,
} from '@jterrazz/test';
```

## The shape of every test

A **specification file** (`*.specification.ts`, under `specs/`) creates a runner once per suite. A **test file** imports the runner and writes specs. Every spec is one chain: zero or more setups, then exactly one terminal action, resolving to a typed result you assert on with `expect()`.

```
specification.api(…)     → { api, cleanup, docker, orchestrator }
specification.jobs(…)    → { jobs, cleanup, orchestrator }         // no docker — jobs never spawn containers
specification.cli(…)     → { cli, cleanup, docker, orchestrator }
specification.website(…) → { website, cleanup, url }               // no docker, no orchestrator — a browser, not a container
specification.mobile(…)  → { mobile, cleanup, udid }               // no docker, no orchestrator — a simulator, not a container
```

The destructured names are canonical — no aliasing (`{ api: myApi }` is an error, rule A3) — and every specification file registers `afterAll(cleanup)` (rule A4).

## First API spec

```typescript
// specs/api/api.specification.ts
import { afterAll } from 'vitest';
import { specification, postgres } from '@jterrazz/test';
import { createApp } from '../../src/app.js';

export const { api, cleanup } = await specification.api({
    services: {
        db: postgres(), // binds to the compose service named "db"
    },
    server: ({ db }) => createApp({ databaseUrl: db.connectionString }),
    // mode: never hardcoded here — see "TEST_MODE" below
    // root: absent — auto-discovered by walking up to docker/compose.test.yaml
});

afterAll(cleanup);
```

```http
### specs/api/users/requests/create-user.http — the COMPLETE request
POST /users
Content-Type: application/json

{ "name": "Alice" }
```

```http
### specs/api/users/expected/user-created.http — status + header subset + body
HTTP/1.1 201 Created
Content-Type: application/json

{ "id": "{{uuid}}", "name": "Alice" }
```

```typescript
// specs/api/users/users.test.ts
import { expect, test } from 'vitest';
import { api } from '../api.specification.js';

test('creates a user', async () => {
    // Given - empty database
    const result = await api.request('create-user.http');

    // Then - response matches the fixture; row landed in the database
    expect(result.response).toMatch('user-created.http');
    await expect(result.table('users')).toMatchRows({
        columns: ['name'],
        rows: [['Alice']],
    });
});
```

`{{uuid}}` is a placeholder from the unified [token grammar](09-tokens.md) — the response body must contain _a_ UUID there, whatever its value.

## First CLI spec

```typescript
// specs/cli/cli.specification.ts
import { resolve } from 'node:path';
import { afterAll } from 'vitest';
import { specification } from '@jterrazz/test';

export const { cli, cleanup } = await specification.cli(
    resolve(import.meta.dirname, '../../bin/my-cli.sh'),
);

afterAll(cleanup);
```

```typescript
// specs/cli/help/help.test.ts
import { expect, test } from 'vitest';
import { cli } from '../cli.specification.js';

test('shows help', async () => {
    // Given
    const result = await cli.exec('--help');

    // Then - full snapshot of stdout against _expected/help.txt
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch('help.txt');
});
```

```
### specs/cli/help/expected/help.txt — tokens work in text snapshots too
my-cli v{{semver}}
Started at {{iso8601}} in {{workdir}}
Done in {{duration}}
```

Each CLI spec runs in a fresh, empty temp directory. ANSI escape sequences are stripped before comparison by default (rule D6) — you never snapshot color codes.

## vitest config: the preset

`vitest.config.ts` starts from `defineSpecConfig()` — the shared preset, imported from the tool subpath beside `literate()`. What you pass is a plain vite/vitest config merged **over** the defaults, so one call gives you the ecosystem's common ground and you still state whatever you want:

```typescript
// vitest.config.ts
import { defineSpecConfig } from '@jterrazz/test/vitest';

export default defineSpecConfig({
    test: {
        projects: [
            { test: { name: 'fast', include: ['src/**/*.test.ts', 'specs/cli/**/*.test.ts'] } },
            { test: { name: 'api', include: ['specs/api/**/*.test.ts'] } }, // node mode
            {
                test: {
                    name: 'api-stack',
                    include: ['specs/api/**/*.test.ts'],
                    env: { TEST_MODE: 'compose' }, // compose mode
                },
            },
        ],
    },
});
```

`mode` (node vs compose) is a property of `specification.api()` only, and it is **never hardcoded in a specification file** (rule A5) — the switch lives here, via the `TEST_MODE` environment variable. The same HTTP test files run twice: once in-process (fast feedback), once against the real compose stack (end-to-end confidence). Zero switching logic in the specs themselves.

### What the preset sets

| Setting                          | Value                                   | Why                                                                                                   |
| -------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `cacheDir`                       | `.artifacts/vitest`                     | The artefact convention below — vite's transform cache leaves `node_modules/`                         |
| `test.coverage.reportsDirectory` | `.artifacts/vitest/coverage`            | Same folder, one level down. The **provider is yours to install** (`@vitest/coverage-v8`)             |
| `test.testTimeout`               | `30_000`                                | Vitest's 5s never survived a container boot, a `prisma db push` or a `next build`                     |
| `test.hookTimeout`               | `30_000`                                | Same reason, for the `beforeAll` that starts the infrastructure                                       |
| `test.exclude`                   | vitest's defaults + `**/_fixtures/**`   | What a spec stands on is an input, never a suite — a repository must not run its own counter-examples |
| `plugins`                        | `literate()`, when `literate:` is given | Turns every matching `<case>.spec.yaml` into a test file (see [07 — CLI specs](07-cli.md))            |

It deliberately sets **nothing else**. `fileParallelism` is a per-project truth (a container-lifecycle suite is serial, an isolated one is not) and stays yours; so do `reporters`, `environment`, `env`, `globalSetup` and every `include` — a preset that guessed those would be wrong more often than right.

Two behaviours worth knowing:

- **Projects inherit the defaults too.** Vitest resolves each project as its own config and it inherits nothing from the root, so the preset merges the budgets, the exclusions and the cache dir into every inline project. A project declared as a glob string, a promise or a function is handed back untouched.
- **Arrays are ADDITIVE.** Vite's merge concatenates them, so your `exclude` adds to the preset's — you never spread `configDefaults.exclude` again — and your `plugins` join `literate()` rather than replacing it. Scalars (`testTimeout`, `name`, …) are plain overrides: what you state wins.

With `projects`, put `literate()` in the ONE project that collects those documents — its glob has to join that project's include — rather than in the top-level `literate:` key:

```typescript
import { defineSpecConfig, literate } from '@jterrazz/test/vitest';

export default defineSpecConfig({
    test: {
        projects: [
            {
                plugins: [literate({ specification: './specs/cli/cli.specification.ts' })],
                test: { name: 'e2e', include: ['specs/cli/**/*.test.ts'] },
            },
        ],
    },
});
```

### Migrating a hand-rolled config

Swap the import, drop what the preset already says, keep what is yours:

```diff
-import { configDefaults, defineConfig } from 'vitest/config';
-import { literate } from '@jterrazz/test/vitest';
+import { defineSpecConfig, literate } from '@jterrazz/test/vitest';

-export default defineConfig({
+export default defineSpecConfig({
     test: {
-        testTimeout: 30_000,
-        hookTimeout: 30_000,
         projects: [
             {
                 test: {
                     name: 'api',
                     include: ['specs/api/**/*.test.ts'],
-                    exclude: [...configDefaults.exclude, '**/_fixtures/**', 'specs/api/heavy/**'],
+                    exclude: ['specs/api/heavy/**'],
-                    testTimeout: 30_000,
                 },
             },
         ],
     },
 });
```

Then add `.artifacts/` to `.gitignore` and drop `node_modules/.vite` from it if it was listed. A project whose timeouts were LOWER than 30s, or higher, keeps stating them — the preset is a floor to start from, not a ceiling.

## Artefacts live under `.artifacts/`

Every build and test artefact of a project lives under `.artifacts/<tool>/` at the project root — one folder per tool, `dist/` the single exception. One line in `.gitignore` covers all of it, and one `rm -rf .artifacts` is a clean slate.

What this framework writes there:

| Path                                             | Written by                        | Lifetime                        |
| ------------------------------------------------ | --------------------------------- | ------------------------------- |
| `.artifacts/vitest/`                             | vite's transform cache            | Reused across runs              |
| `.artifacts/vitest/coverage/`                    | the coverage provider you install | Rewritten per coverage run      |
| `.artifacts/vitest/sqlite/template-<key>.sqlite` | `sqlite()`'s schema template      | Reused until the schema changes |

What it does **not** write there: the fresh temp directory each CLI spec runs in, the per-worker SQLite copies, the profile dirs a browser or a simulator needs. Those are per-RUN scratch, they stay in the OS temp dir, and moving them into the project would only put a `package.json` above a spec that must not see one.

## Framework environment variables

You set exactly two variables, both prefixed `TEST_` (rule E1). The framework also reads vitest's own `VITEST_POOL_ID` (set by vitest, not you) to isolate each parallel worker's database schema/index:

| Variable      | Values                        | Meaning                                                                                   |
| ------------- | ----------------------------- | ----------------------------------------------------------------------------------------- |
| `TEST_MODE`   | `node` (default) \| `compose` | Execution mode for `specification.api()`. Priority: `mode` param > `TEST_MODE` > `'node'` |
| `TEST_UPDATE` | `1`                           | Rewrite snapshot fixtures from actual output (same effect as `vitest -u`)                 |

```bash
npx vitest --run                      # node mode, assert against fixtures
TEST_MODE=compose npx vitest --run    # compose mode
TEST_UPDATE=1 npx vitest --run        # update fixtures (tokens preserved — see chapter 06)
npx vitest --run -u                   # same as TEST_UPDATE=1
```

In update mode the framework writes **tokens, not values**: segments already covered by a placeholder are preserved, and values it knows to be dynamic (`{{workdir}}`) are substituted automatically (rule D5).

## Directory layout at a glance

```
specs/
├── api/
│   ├── api.specification.ts
│   └── users/
│       ├── users.test.ts          # <aspect>.test.ts inside its domain (rule C1)
│       ├── _seeds/                 # *.sql
│       ├── _requests/              # *.http — complete requests (inputs)
│       ├── contracts/             # <name>.contracts.ts facade + <provider>/<name>.ts units + their data
│       └── _expected/              # all expected fixtures, flat — incl. response *.http (a slash in the name creates a subfolder)
└── cli/
    ├── cli.specification.ts       # runner at the facet root (rule C1)
    └── help/
        └── help.test.ts
```

## Pitfalls

- **Hardcoding `mode: 'compose'` in a specification file.** Forbidden when `server` is defined (rule A5) — put the switch in `vitest.config.ts`. The only exception: a non-Node app (no `server` possible), where `mode: 'compose'` is mandatory and permanent.
- **Renaming the destructured runner** (`const { api: usersApi } = …`). The canonical names `api`, `jobs`, `cli`, `website`, `mobile` are enforced (rule A3).
- **Forgetting `afterAll(cleanup)`.** Infrastructure leaks across suites; rule A4 requires it in every specification file.
- **Importing from a subpath** (`@jterrazz/test/services`). Subpaths do not exist in v9 — everything comes from `@jterrazz/test` (rule F1).
- **Writing `// Given` without `// Then`** (or vice versa). Every test carries both comments (rule B4); `// When` only when the action is not obvious — the chain _is_ the when.

## Related

[05 — API specs](05-api.md) · [07 — CLI specs](07-cli.md) · [08 — Assertions](08-assertions.md) · [12 — Conventions](12-conventions.md) · [14 — Website specs](14-website.md) · [15 — Mobile specs](15-mobile.md)
