# API specs — `specification.api()`

Operative reference. Prose + examples: [docs/05-api.md](../../docs/05-api.md). Assertions: [docs/08-assertions.md](../../docs/08-assertions.md). Tokens: [references/tokens.md](tokens.md). Mocking: [references/contracts.md](contracts.md).

## Runner (in `*.specification.ts`, `afterAll(cleanup)`)

```typescript
export const { api, cleanup } = await specification.api({
    services: { db: postgres() }, // named record → compose service "db"
    server: ({ db }) => createApp({ databaseUrl: db.connectionString }),
    // mode / root: usually omitted
});
afterAll(cleanup);
```

Returns `{ api, cleanup, docker, orchestrator }`. Checklist:

- `services` — named record. Keys type `server`'s param, name the `database:` option, and drive the compose binding: exact name, else kebab-case of the key (`analyticsDb` → `analytics-db`); both present → ambiguity error (A6); `composeService` is the escape hatch.
- `server: (services) => honoApp` — required in node mode, ignored in compose mode (any object with a `request()` method works).
- `mode` (`'node' | 'compose'`) exists ONLY on `.api()`. Resolution: option > `TEST_MODE` env > `'node'`. Keep it OUT of the spec file — the switch lives in `vitest.config.ts` via `env: { TEST_MODE: 'compose' }` (A5).
- `root` auto-discovered (walk up to the NEAREST directory carrying `package.json` or `docker/compose.test.yaml` — the package, not the repository); override only when the convention does not fit. It is the project root, NOT a fixtures root.

### node vs compose (one definition, two projects)

Same test files, mode switched only in `vitest.config.ts`:

```typescript
projects: [
    { test: { name: 'api', include: ['specs/api/**/*.test.ts', 'specs/jobs/**/*.test.ts'] } },
    {
        test: {
            name: 'api-stack',
            include: ['specs/api/**/*.test.ts', 'specs/jobs/**/*.test.ts'],
            exclude: ['specs/api/intercepts/**'], // in-process MSW is node-only (I3/D7)
            env: { TEST_MODE: 'compose' },
        },
    },
];
```

In compose mode `server` is ignored (the app runs in the stack); the services-record keys stay the `database:` vocabulary, so the same seeds and table assertions work in both modes.

## Setup (chainable)

| Method                                          | Description                                                                                                 |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `.seed("file.sql", { database? })`              | Load SQL from `_seeds/` (SQL only). `database` = record key — MANDATORY with ≥ 2 DBs, FORBIDDEN with 1 (A7) |
| `.headers({ "Accept-Language": "fr" })`         | Merge HTTP headers on top of the `.http` file's (chain wins)                                                |
| `.intercept(contracts)` / `(request, response)` | Declare what the outside world replies — see [contracts.md](contracts.md). STRICT (D7)                      |

## Actions (terminal)

| Method                                     | Resolves to  | Notes                                                    |
| ------------------------------------------ | ------------ | -------------------------------------------------------- |
| `.request("create-user.http")`             | `HttpResult` | COMPLETE request from `_requests/<file>` — body sent raw |
| `.get(path)` / `.delete(path)`             | `HttpResult` | Inline                                                   |
| `.post(path, body?)` / `.put(path, body?)` | `HttpResult` | Inline body = plain object, JSON-serialized              |

## Assertions (via `expect()`)

```typescript
expect(result.status).toBe(201);
expect(result.response).toMatch('user-created.http'); // _expected/<name> — status + header SUBSET + body, {{token}}-aware
expect(result.response.body).toEqual({ error: 'User 999 not found' });
await expect(result.table('users', { database: 'db' })).toMatchRows({
    columns: ['name'],
    rows: [['Alice']],
});
await expect(result.table('users', { database: 'db' })).toBeEmpty();
```

- `.response` golden is the default (whole shape, tokens for volatile parts). A lone status probe (`d15w`) or an amas of `.response.body` probes (`d12w`) is a warning — golden it instead.
- `toMatch` always resolves against `_expected/<name>` (flat; a slash makes a subfolder; extension required). Only `.request()` reads `_requests/`.

## `.http` files

```http
### _requests/create-user.http — the COMPLETE request
POST /users
Content-Type: application/json

{ "name": "Alice" }
```

```http
### _expected/user-created.http — status + header SUBSET + body
HTTP/1.1 201 Created
Location: /users/{{uuid#user}}

{ "id": "{{uuid#user}}", "name": "Alice" }
```

## Folder layout

```
specs/api/
├── api.specification.ts        # runner at the facet ROOT
├── intercepts/                 # strict-contract specs (D7) — node-only; api-stack EXCLUDES this
└── <feature>/
    ├── <feature>.test.ts
    ├── _seeds/                  # *.sql ONLY
    ├── _requests/               # *.http — inputs (complete request)
    ├── contracts/              # <name>.contracts.ts facade + <provider>/<name>.ts units + data
    └── _expected/               # ALL expected fixtures, FLAT (incl. response *.http)
```
