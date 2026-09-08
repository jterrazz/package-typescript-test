# 11 — Services: databases, caches, and the compose file

Infrastructure is declared as a **named record** of service factories on the runner. The record keys are your test vocabulary — they name the service in `.seed()` / `.table()` targeting, they type the `server`/`jobs` factory parameters, and they bind to the compose file. `docker/compose.test.yaml` is the single source of truth for what actually runs (rule G1).

## Service factories

All three import from the package root (rule F1):

```typescript
import { postgres, redis, sqlite } from '@jterrazz/test';
```

| Factory      | Backing                                           | Options                                                     | Connection string shape               |
| ------------ | ------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------- |
| `postgres()` | Docker container                                  | `composeService`, `image`, `env`                            | `postgresql://user:pass@host:port/db` |
| `redis()`    | Docker container                                  | `composeService`, `image`                                   | `redis://host:port`                   |
| `sqlite()`   | **No Docker** — a template file copied per worker | `init` (SQL file) or `prismaSchema` (runs `prisma db push`) | `file:/…/….sqlite`                    |

`image` overrides the container image, and `env` (postgres only) overrides the environment variables, for the rare case where the compose file is not the right source — normally both are read from `docker/compose.test.yaml`.

Container-backed factories read their image and environment **from the compose file** — there is no image/env duplication in TypeScript. After the runner starts, each service handle exposes `.connectionString`, which is what you pass to your app:

```typescript
export const { api, cleanup } = await specification.api({
    services: {
        db: postgres(), // → compose service "db"
        analyticsDb: postgres(), // → kebab-derived compose service "analytics-db"
        cache: redis(), // → compose service "cache"
    },
    server: ({ db, analyticsDb, cache }) =>
        createApp({
            databaseUrl: db.connectionString,
            analyticsDatabaseUrl: analyticsDb.connectionString,
            redisUrl: cache.connectionString,
        }),
});
```

## The services record — three jobs for one key

1. **Vocabulary.** The key is how tests target the service: `.seed('x.sql', { database: 'analyticsDb' })`, `result.table('events', { database: 'analyticsDb' })`. Typed — a typo is a compile error.
2. **Typing.** The `server` / `jobs` factory receives the exact same record, fully typed, once everything is started (rule A8).
3. **Compose binding.** The key binds to its compose service deterministically, in two steps (rule A6): first the service named **exactly** like the key, else the **kebab-case** conversion of the key — so `analyticsDb` binds to `analytics-db` with no option. If _both_ names exist in the compose file the binding is ambiguous and the framework throws. `composeService:` is the escape hatch for names the key cannot derive, and setting it equal to the exact key or its kebab-case form is redundant (lint warning):

    ```typescript
    services: {
        db: postgres(), // exact match → "db"
        analyticsDb: postgres(), // kebab-derived → "analytics-db"
        events: postgres({ composeService: 'legacy_event_store' }), // escape hatch — not derivable
    }
    ```

In CLI mode, the record additionally drives env injection into the child process: `<KEY>_URL` per service — the key uppercased to **CONSTANT_CASE** at camelCase boundaries (`analyticsDb` → `ANALYTICS_DB_URL`) — plus `DATABASE_URL` / `REDIS_URL` when unambiguous (rule B6 — see [CLI specs](07-cli.md#auto-injected-connection-urls-rule-b6)).

### The `database:` rule (A7)

With **2 or more databases** in the record, `database:` is mandatory on every `.seed()` and `.table()`. With exactly **one**, it is forbidden (redundant). There is no in-between: the option is either always present or never present within a project.

```typescript
// one database → no database: anywhere
await migrateCli.seed('legacy-schema.sql').exec('up');
await expect(result.table('schema_migrations')).toMatchRows({ … });

// two databases → database: everywhere
await api.seed('catalog.sql', { database: 'db' }).request('new-order.http');
await expect(result.table('events', { database: 'analyticsDb' })).toMatchRows({ … });
```

## `docker/compose.test.yaml` + `init.sql`

```
docker/
├── compose.test.yaml       # source of truth for test infrastructure
├── db/
│   └── init.sql            # schema for the "db" service — runs on service start
└── analytics-db/
    └── init.sql            # schema for the "analytics-db" service
```

- `compose.test.yaml` defines every test service: images, environment, and (in compose mode) the app itself.
- `docker/<service>/init.sql` executes when the corresponding service starts (rule G1) — matched by **compose service name**, so the analytics schema above belongs to `analytics-db/` (the name the record key `analyticsDb` derives to).
- In node mode, testcontainers starts each declared service using the compose file's image/env. In compose mode, the whole file is brought up as a stack. One definition, both modes.

## Per-worker isolation (rule G2)

Vitest runs test files in parallel workers; the framework isolates them automatically — no configuration, no sharding:

| Service      | Isolation strategy                   |
| ------------ | ------------------------------------ |
| `postgres()` | Cloned schema per worker             |
| `redis()`    | Dedicated database index per worker  |
| `sqlite()`   | Template file copied per worker      |
| compose mode | Dedicated compose project per worker |

On top of worker isolation, **every chain resets the databases** (rule B1): a spec starts from seeds, never from a previous spec's leftovers.

## Root auto-discovery (rule A9)

The framework locates the project root by walking **up from the specification file** to the **nearest** directory carrying `package.json` or `docker/compose.test.yaml` — both markers probed at each ancestor, so in a workspace the member being tested wins over the repository root above it. The `root` option is an override for the cases where the convention cannot work (e.g. fixtures deliberately kept outside the package) — pointing `root` at the directory the walk would find anyway is redundant (future lint warning).

## SQLite without Docker

For CLIs (or apps) on SQLite, tests run with zero Docker:

```typescript
export const { cli, cleanup } = await specification.cli('shoply', {
    services: {
        db: sqlite({ init: './schema.sql' }), // schema from a SQL file
        // or: db: sqlite({ prismaSchema: './prisma/schema.prisma' })
    },
});
```

`sqlite()` builds a template database once (from `init` SQL or by running `prisma db push` on `prismaSchema`), then hands each worker its own copy. `.seed()` and `result.table()` work identically to Postgres.

`prismaSchema` is resolved against the **current working directory** and passed to the CLI as `npx prisma db push --force-reset --schema <absolute path>` — the schema is named explicitly, so it does not have to be the one Prisma would discover from a `prisma.config.ts` at the cwd. Declare no `prismaSchema` and the bare invocation runs, leaving discovery to Prisma.

### Where the template lives

The template is a **project** artefact: `<root>/.artifacts/vitest/sqlite/template-<sha8>.sqlite`, under the root A9 discovered ([above](#root-auto-discovery-rule-a9)) and covered by the same `.gitignore` line as everything else in `.artifacts/` ([02 — Developing](02-developing.md#artefacts-live-under-artifacts)).

It used to live in the machine-global OS tmpdir, where two checkouts of one repository shared a single file: whichever ran first built it, the other silently inherited that schema, and a branch that changed the schema poisoned the branch beside it. A path under the project root cannot be reached from another checkout at all. Deleting `.artifacts/` is how you force a cold rebuild.

The file name stays **keyed on the schema** — the digest taken over the kind of schema (`init` / `prismaSchema`), its resolved path and its content. Within one project that is what makes reuse mean "the same schema": edit a schema and the next run builds a new template instead of reading the old one, whose header is perfectly valid and whose tables are wrong.

### One worker builds, the others wait

Workers race for a cold cache, so the build is serialised by a lock beside the template — and a worker that loses the race **waits** for the winner rather than building too. It is taken with an exclusive create, so exactly one worker can win it; the check-then-write it replaced let several believe they had won, and the concurrent `prisma db push` calls that followed died on `database is locked`. A suite kept sequential (`fileParallelism: false`) only for that reason can go parallel again.

Two more properties fall out of it: the winner builds on a private path and **renames** the finished file into place, so a reader never sees a half-built template (the SQLite header is written long before the tables are); and a lock nobody has touched for two minutes is treated as a crashed holder's and broken, so a killed worker cannot wedge the suite.

## Pitfalls

- **Declaring image/env in TypeScript.** Container configuration lives in `compose.test.yaml`; the factories only _bind_ to it. If you need a different image, change the compose file.
- **`composeService` derivable from the record key** — redundant (rule A6); the key already binds by exact name or kebab-case derivation. Reach for it only when the compose name cannot be derived.
- **Naming the `init.sql` folder after the record key.** The folder matches the **compose service name**: key `analyticsDb` binds to `analytics-db`, so its schema reads `docker/analytics-db/init.sql`.
- **Sharing state across specs "because the container is shared".** The container is shared; the data is not — chains reset databases (rule B1), and workers are isolated (rule G2).
- **Passing `root` that auto-discovery would have found.** Redundant override (rule A9).
- **Reading a green local run as proof that `prismaSchema` is wired.** The template is cached across runs, so a checkout that built it once never re-runs `db push` — a schema path that would fail on a fresh clone (or in CI) stays invisible. Delete `.artifacts/vitest/sqlite/` to test the cold path.
- **Counting `sqlite()` + `redis()` as "2 databases" for rule A7.** The rule counts **databases**; with one SQL database and one redis, `database:` stays forbidden on `.seed()`/`.table()` and `DATABASE_URL`/`REDIS_URL` are both unambiguous for CLI injection (rule B6).

## Related

[05 — API specs](05-api.md) · [06 — Jobs specs](06-jobs.md) · [07 — CLI specs](07-cli.md) · [12 — Conventions](12-conventions.md)
