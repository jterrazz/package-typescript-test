# @jterrazz/test

Declarative testing framework for APIs, jobs, CLIs, websites, and mobile apps. Five constructors — `specification.api()`, `specification.jobs()`, `specification.cli()`, `specification.website()`, `specification.mobile()` — and specs that read as sentences: given → action → assertions. The vitest test name is the spec's description; all assertions go through `expect()` with auto-registered, subject-typed matchers.

```bash
npm install -D @jterrazz/test vitest
```

Everything a spec needs imports from `@jterrazz/test`. The exceptions are the two TOOL subpaths, which no spec ever imports: `@jterrazz/test/oxlint` (the zero-runtime lint plugin and its config fragment, loading no test runtime) and `@jterrazz/test/vitest` (what `vitest.config.ts` imports — the `defineSpecConfig()` preset and the `literate()` plugin).

## Quick start

### API testing (HTTP)

```typescript
// specs/api/api.specification.ts
import { afterAll } from 'vitest';
import { postgres, specification } from '@jterrazz/test';
import { createApp } from '../../src/app.js';

export const { api, cleanup } = await specification.api({
    services: { db: postgres() }, // → compose service "db"
    server: ({ db }) => createApp({ databaseUrl: db.connectionString }),
});

afterAll(cleanup);
```

```typescript
// specs/api/users/users.test.ts
import { expect, test } from 'vitest';
import { api } from '../api.specification.js';

test('creates a user', async () => {
    // Given - the complete request from _requests/create-user.http
    const result = await api.request('create-user.http');

    // Then - status + headers + body from _expected/user-created.http; row in db
    expect(result.response).toMatch('user-created.http');
    await expect(result.table('users')).toMatchRows({
        columns: ['name'],
        rows: [['Alice']],
    });
});
```

### CLI testing

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
// specs/cli/build/build.test.ts
import { expect, test } from 'vitest';
import { cli } from '../cli.specification.js';

test('builds the project', async () => {
    // Given - sample app project spread into the cwd
    const result = await cli.fixture('$FIXTURES/sample-app/').exec('build');

    // Then - ESM output, no CJS
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Build completed');
    expect(result.file('dist/index.js').exists).toBe(true);
    expect(result.file('dist/index.cjs').exists).toBe(false);
});
```

A CLI session can also BE the spec file. A `<case>.spec.yaml` document states one scenario — its ground, then its runs — and executes either as a test file of its own (the `literate()` vite plugin) or through `cli.run('case.spec.yaml')`:

```yaml
description: refuses to build without a manifest
runs:
    - command: build
      exit: 1
      stderr: |
          Error: no my-cli.yaml in the current directory
```

Same engine as the chain, same `{{token}}` grammar, same `TEST_UPDATE=1` — which rewrites each run's exit code and streams, and nothing else. A JSON Schema ships at `@jterrazz/test/schema` so an editor validates as you type. Full grammar: [docs/07-cli.md](docs/07-cli.md#spec-documents--casespecyaml).

### Website testing (browser)

```typescript
// specs/website/website.specification.ts
import { specification } from '@jterrazz/test';
import { afterAll } from 'vitest';

export const { cleanup, website } = await specification.website({
    server: { command: 'node specs/_fixtures/website-app/server.mjs', ready: '/' },
});

afterAll(cleanup);
```

```typescript
// specs/website/visit/head.test.ts
import { expect, test } from 'vitest';
import { website } from '../website.specification.js';

test('captures the full head surface of a rendered page', async () => {
    // Given - the fixture homepage
    const result = await website.visit('/');

    // Then - one golden covers title, canonical, alternates, and metas
    expect(result.status).toBe(200);
    expect(result.head).toMatch('home.head.json');
});
```

### Mobile testing (iOS simulator)

```typescript
// specs/mobile/mobile.specification.ts
import { specification } from '@jterrazz/test';
import { afterAll } from 'vitest';

export const { cleanup, mobile } = await specification.mobile({
    app: { bundleId: 'com.jterrazz.fakenews' },
    device: { name: 'iPhone 17', os: '26.5' },
});

afterAll(cleanup);
```

```typescript
// specs/mobile/events/feed.test.ts
import { expect, test } from 'vitest';
import { mobile } from '../mobile.specification.js';

test('shows the events feed behind its deep link', async () => {
    // Given - the events screen
    const result = await mobile.open('news://events');

    // Then - one golden covers the whole projected accessibility tree
    expect(result.screen).toMatch('events.screen.json');
});
```

Actions are **terminal**: `.request()`, `.get()`, `.trigger()`, `.exec()`, `.fetch()`, `.visit()`, `.open()` execute the spec and resolve to a precisely typed result. There is no `.run()`, no label, and no `.spawn()`.

## The five constructors

One constructor per tested interface, each returning a record destructured with its canonical name:

| Constructor                       | Returns                                  | Terminal actions                                             |
| --------------------------------- | ---------------------------------------- | ------------------------------------------------------------ |
| `specification.api(options)`      | `{ api, cleanup, docker, orchestrator }` | `.request(file)`, `.get()`, `.post()`, `.put()`, `.delete()` |
| `specification.jobs(options)`     | `{ jobs, cleanup, orchestrator }`        | `.trigger(name)`                                             |
| `specification.cli(bin, options)` | `{ cli, cleanup, docker, orchestrator }` | `.exec(args, { waitFor?, timeout? }?)`                       |
| `specification.website(options)`  | `{ website, cleanup, url }`              | `.fetch(path)`, `.visit(path, scenario?)`                    |
| `specification.mobile(options)`   | `{ mobile, cleanup, udid }`              | `.open(deepLink?, scenario?)`                                |

### `specification.api({ services, server, mode?, root? })`

One definition, two execution modes — the switch lives in `vitest.config.ts`, never in the specification file:

- **`node`** (default): starts the declared services via testcontainers and runs the app in-process (Hono). Fastest feedback loop.
- **`compose`**: runs `docker compose up` on `docker/compose.test.yaml` and sends real HTTP to the app service (`server` is ignored). Proves the shipped artifact.

Resolution: `options.mode` > `TEST_MODE` env var > `'node'`. Only `.api()` has a mode.

```typescript
// vitest.config.ts — the mode switch lives HERE
import { defineSpecConfig } from '@jterrazz/test/vitest';

export default defineSpecConfig({
    test: {
        projects: [
            { test: { name: 'http', include: ['specs/api/**/*.test.ts'] } },
            {
                test: {
                    name: 'http-stack',
                    include: ['specs/api/**/*.test.ts'],
                    env: { TEST_MODE: 'compose' },
                },
            },
        ],
    },
});
```

`services` is a named record. Keys type the `server` factory parameters, name databases for `.seed()`/`.table()` (`{ database: 'analyticsDb' }`), and drive the compose binding — a handle with no `composeService` option links to the compose service named exactly like its key, else the kebab-case conversion of the key (`analyticsDb` → `analytics-db`). If both names exist the binding is ambiguous and throws; `composeService` is the escape hatch for non-derivable names.

### `specification.jobs({ services, jobs, root? })`

Background jobs run in-process by definition — no HTTP server, no mode:

```typescript
export const { jobs, cleanup } = await specification.jobs({
    services: { db: postgres() },
    jobs: ({ db }) => [nightlyReport(db)], // (services) => JobHandle[], or a static array
});

// In a test:
const result = await jobs.seed('pending.sql').trigger('nightly-report');
```

A `JobHandle` is `{ name: string; execute: () => Promise<void> }`.

### `specification.cli(bin, { root?, services?, docker?, transform?, env?, serve? })`

Runs a command binary against fixture projects in fresh temp directories. `env` (named environment sets) and `serve` (named servers) are the registries a [`<case>.spec.yaml`](docs/07-cli.md#spec-documents--casespecyaml) names by word. With `services`, connection URLs are injected into the child env automatically: `<KEY>_URL` per record key (CONSTANT_CASE at camelCase boundaries — `analyticsDb` → `ANALYTICS_DB_URL`), plus `DATABASE_URL` (exactly one SQL database) and `REDIS_URL` (exactly one redis). `.env()` overrides; `null` unsets.

```typescript
export const { cli, cleanup } = await specification.cli('my-migrate-tool', {
    services: { db: postgres() },
});

// DATABASE_URL / DB_URL are already in the child env:
const result = await cli.seed('legacy-schema.sql').exec('up');
```

### `specification.website({ server?, url?, backend?, external?, root? })`

Tests a rendered website: `.fetch(path)` for a raw HTTP exchange (redirects never followed), `.visit(path, scenario?)` for a page rendered in a real chromium. Exactly one of `server` (start the site locally — a free port injected as `PORT`, polled on `ready`) or `url` (target a running site) is required. `backend: { env, port? }` (server mode only) additionally starts a declared stub backend and injects its URL into the server child under `env`; each chain declares what it serves with `.intercept(contracts)`, the same contracts form `api`/`jobs` use.

```typescript
export const { website, cleanup } = await specification.website({
    server: { command: 'node specs/_fixtures/website-app/server.mjs', ready: '/' },
});

// Raw exchange — status + headers, redirects surface as 3xx
const redirect = await website.fetch('/old');

// Rendered page, optionally driven by a scenario (the When)
const page = await website.visit('/', async (visitor) => {
    await visitor.click(link('Articles'));
});
```

The handle destructures to `{ website, cleanup, url }` — no `docker`, no `orchestrator`. `.visit()` needs playwright (`npm install -D playwright && npx playwright install chromium`) — an optional peer dependency, only loaded when a spec actually renders a page. Full reference: [docs/14-website.md](docs/14-website.md).

### `specification.mobile({ app, device, backend?, root? })`

Tests a native app on the iOS simulator through a real XCUITest session (appium): `.open(deepLink?, scenario?)` terminates and relaunches the app (deterministic fresh state), applies the deep link, runs the scenario, and captures the final screen — the projected accessibility tree plus the visible texts. The simulator is resolved by `device: { name, os?, udid? }` via `xcrun simctl` (refusing on zero or several matches) and booted when shut down; the appium server is spawned from the caller project on a free port.

```typescript
export const { mobile, cleanup, udid } = await specification.mobile({
    app: { bundleId: 'com.jterrazz.fakenews' },
    device: { name: 'iPhone 17', os: '26.5' },
});

// A screen behind its deep link, driven by a scenario (the When)
const result = await mobile.open('news://events', async (visitor) => {
    await visitor.tap(button('Enquête Fauci COVID-19'));
    await visitor.see(content('rapports'));
});
```

The handle destructures to `{ mobile, cleanup, udid }` (plus `backendUrl` with `backend: { port? }` — a declared stub backend whose URL the CALLER wires into its own bundler env; the framework never touches Metro). The element vocabulary is the website facet's, unchanged — `button`, `field`, `content`, `testId`, `within` — landmarks excepted (an iOS screen has no ARIA regions; they refuse at runtime). Requires the app installed on the simulator plus the optional peers: `npm install -D appium webdriverio && npx appium driver install xcuitest`. Full reference: [docs/15-mobile.md](docs/15-mobile.md).

### Root auto-discovery

When `root` is absent, the framework walks up from the specification file to the **nearest** directory carrying `package.json` or `docker/compose.test.yaml`. In a workspace that is the member being tested, not the repository root above it. Pass `root` only when the convention does not fit. `root` is strictly the **project root** (compose detection + local-bin resolution, or the cwd of a `specification.website()` server command) — it is not a fixtures root; `.fixture()` resolves its own paths.

## vitest config — `defineSpecConfig()`

`@jterrazz/test/vitest` is the subpath `vitest.config.ts` imports, never a spec. Beside `literate()` it exports the shared preset: what you pass is a plain vite/vitest config merged **over** its defaults, and `literate:` adds the plugin.

```typescript
import { defineSpecConfig } from '@jterrazz/test/vitest';

export default defineSpecConfig({
    literate: { specification: './specs/cli/cli.specification.ts' },
    test: { include: ['specs/**/*.test.ts'] },
});
```

| Sets                               | To                                                     |
| ---------------------------------- | ------------------------------------------------------ |
| `cacheDir`                         | `.artifacts/vitest`                                    |
| `test.coverage.reportsDirectory`   | `.artifacts/vitest/coverage` (bring your own provider) |
| `test.testTimeout` / `hookTimeout` | `30_000`                                               |
| `test.exclude`                     | vitest's defaults **+** `**/_fixtures/**`              |

Nothing else: `fileParallelism`, `reporters`, `environment` and every `include` stay yours. Inline `projects` inherit the same defaults (vitest gives a project nothing from the root), arrays are concatenated rather than replaced, and scalars you state win. Full walkthrough, including migrating a hand-rolled config: [docs/02-developing.md](docs/02-developing.md#vitest-config-the-preset).

Every artefact a run produces lands under `.artifacts/<tool>/` — one `.gitignore` line, one `rm -rf`. Per-run scratch (a CLI spec's temp cwd, a browser profile) stays in the OS temp dir.

## Builder API

### Setup (chainable)

| Method                                  | Facets       | Description                                                                                                 |
| --------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------- |
| `.seed("file.sql", { database? })`      | all          | Load SQL from `_seeds/` — `database` is the record key (mandatory with ≥ 2 databases, forbidden with 1)     |
| `.fixture("file")`                      | cli          | Copy the feature-local `_fixtures/file` into the working directory                                          |
| `.fixture("$FIXTURES/name/")`           | cli          | Spread the shared `specs/_fixtures/name/` project into the cwd (trailing `/` = contents; layers)            |
| `.env({ KEY: "value" })`                | cli          | Set env vars on the child (`null` unsets, `$WORKDIR` expands, calls merge)                                  |
| `.headers({ "Accept-Language": "fr" })` | api, website | Set HTTP request headers (merge on top of `.http` file headers, or on the browser context)                  |
| `.intercept(contracts)`                 | all but cli  | Declare the world: a `defineContracts(...)` composite — MSW on api/jobs, the stub backend on website/mobile |
| `.intercept(contract)` / `([a, b])`     | all but cli  | A single contract, or an ordered list                                                                       |
| `.intercept(request, response)`         | all but cli  | Inline pair, for one-off plumbing                                                                           |

### Actions (terminal)

| Method                                     | Facet   | Resolves to    | Description                                                                              |
| ------------------------------------------ | ------- | -------------- | ---------------------------------------------------------------------------------------- |
| `.request("create-user.http")`             | api     | `HttpResult`   | Send the COMPLETE request from `_requests/<file>` (method, path, headers, raw body)      |
| `.get(path)` / `.delete(path)`             | api     | `HttpResult`   | Inline requests for simple cases                                                         |
| `.post(path, body?)` / `.put(path, body?)` | api     | `HttpResult`   | Inline body: plain object, JSON-serialized                                               |
| `.trigger("name")`                         | jobs    | `BaseResult`   | Execute a registered job                                                                 |
| `.exec("args")`                            | cli     | `CliResult`    | Run the command                                                                          |
| `.exec(["build", "start"])`                | cli     | `CliResult`    | Sequence in the same cwd; stops on first non-zero exit                                   |
| `.exec("dev", { waitFor, timeout? })`      | cli     | `CliResult`    | Long-running: resolves at the pattern, killed at `timeout` (default 10 s)                |
| `.run("case.spec.yaml")`                   | cli     | `CliResult`    | Run a `<case>.spec.yaml` — its ground and EVERY run asserted; the last one returns       |
| `.fetch(path)`                             | website | `FetchResult`  | One raw HTTP exchange — redirects surface as 3xx, never followed                         |
| `.visit(path, scenario?)`                  | website | `PageResult`   | Render the page in a shared chromium; with a scenario, the capture is the final state    |
| `.open(deepLink?, scenario?)`              | mobile  | `ScreenResult` | Relaunch the app fresh on the simulator; with a scenario, the capture is the final state |

One chain = one terminal action; databases reset at the start of every chain. Every cli spec runs in a fresh, empty temp directory.

## Assertions — everything through `expect()`

Accessors are **read-only**; the framework registers subject-typed matchers on vitest's `expect` automatically. `await` is required exactly where IO happens (tables, trees, containers).

```typescript
// HTTP
expect(result.status).toBe(201);
expect(result.response).toMatch('user-created.http'); // _expected/<name> — status + header subset + body
expect(result.response.body).toEqual({ error: 'User 999 not found' });

// Tables (async — queries the database)
await expect(result.table('orders', { database: 'db' })).toMatchRows({
    columns: ['id', 'status', 'created_at'],
    rows: [[match.uuid(), 'pending', match.iso8601()]],
});
await expect(result.table('orders', { database: 'db' })).toBeEmpty();

// Streams (ANSI stripped by default; .text stays raw)
expect(result.stdout).toContain('Build completed');
expect(result.stdout).toMatch('help.txt'); // _expected/help.txt — {{token}}-aware
expect(result.json).toMatch('config.json'); // _expected/config.json
expect(result.json.value).toMatchObject({ name: 'shoply' });

// Files & trees
expect(result.file('my-shop/shoply.yaml').content).toContain('name: my-shop');
await expect(result.directory('my-shop')).toMatch('shop-scaffold'); // _expected/shop-scaffold/
await expect(result.filesystem).toMatch('upgraded-shop'); // whole cwd

// Containers (docker-aware cli)
await expect(result.container('alpha')).toBeRunning();
```

`toMatch` always resolves against `_expected/<name>` — every subject, no exceptions (only `.request()` reads `_requests/`). The folder is flat: a slash in the name creates a subfolder; the extension is part of the name and required, except for tree snapshots which are directories.

**Updating snapshots:** `TEST_UPDATE=1` or `vitest -u`. Update mode writes **tokens**, not values — segments covered by an existing placeholder are preserved, and `{{workdir}}` is substituted automatically.

## Dynamic values — one `{{token}}` grammar

The same vocabulary works in `_expected/*.http` (body AND headers), `_expected/*.json`, text snapshots, and tree-snapshot file contents — and in code via `match.*`:

`uuid` `ulid` `iso8601` `date` `time` `duration` `number` `int` `float` `semver` `sha` `hex` `base64` `port` `ip` `url` `email` `path` `workdir` `string` `any`

Each token is capturable via `{{type#ref}}`: the first occurrence captures, later occurrences must be equal (scope: one spec). Code-side: `match.ref('order')`, `match.ref('intent', { not: 'order' })`, `match.regex(/…/)`.

```http
### _expected/order-created.http
HTTP/1.1 201 Created
Content-Type: application/json
Location: /orders/{{uuid#order}}

{
    "id": "{{uuid#order}}",
    "total": "{{number}}",
    "createdAt": "{{iso8601}}"
}
```

See [docs/09-tokens.md](docs/09-tokens.md) for the canonical accepted form of every token.

## Contracts

Everything the outside world replies is a **contract** — a request to match and a response to serve, declared together. A feature owns a `contracts/` folder: a public `<name>.contracts.ts` facade (default export = the world, named exports = its scenarios) over internal `<provider>/<name>.ts` units, `provider ∈ { http, openai, anthropic }`.

```typescript
// contracts/openai/classify-product.ts
import { defineContract, openai } from '@jterrazz/test';

export default defineContract({
    request: openai.responses({ user: /Product Classification/, tools: ['classify'] }),
    response: openai.reply({ category: 'ELECTRONICS', confidence: 0.97 }),
});
```

```typescript
// contracts/pipeline.contracts.ts
import { defineContracts, http } from '@jterrazz/test';

import classifyProduct from './openai/classify-product.js';
import exchangeRates from './http/exchange-rates.js';

const pipeline = defineContracts(classifyProduct, exchangeRates);

export default pipeline;

export const withRatesDown = () =>
    pipeline.with({ request: http.get('/rates'), response: http.error(503) });
```

```typescript
const result = await jobs.intercept(pipeline).trigger('nightly-report');
```

Selection is first-match, one queue for every facet: `times` bounds how often a contract serves (omitted = unlimited, so retries and re-renders replay it), `required: true` fails the chain if it was never requested. Provider string filters are **exact** — the loose forms are explicit (`RegExp`, `match.includes('…')`). Failure simulation: `openai.error(429)`, `anthropic.timeout()`, `openai.malformed('not json')`. MSW ships as a direct dependency — no separate install. Full chapter: [docs/10-contracts.md](docs/10-contracts.md).

## Docker-aware CLIs

For CLIs that spawn containers, declare `docker: { envVar, nameLabel, testRunLabel }`. The runner injects a unique test-run id into the child env; the tested binary must label its containers with `testRunLabel=<id>`. Results expose lazy `.container(name)` accessors — and must be bound with `await using` so leaked containers are force-removed at scope exit:

```typescript
test('deploy spawns a labelled container', async () => {
    // Given
    await using result = await cli.fixture('$FIXTURES/two-shops/').exec('deploy alpha');

    // Then - property reads are sync; only the matcher is async
    const shop = result.container('alpha');
    expect(shop.exists).toBe(true);
    await expect(shop).toBeRunning();
    expect(shop.file('/app/shoply.yaml').content).toContain('name: alpha');
});
```

## Service factories

| Factory      | Options                          | Connection string                     |
| ------------ | -------------------------------- | ------------------------------------- |
| `postgres()` | `composeService`, `image`, `env` | `postgresql://user:pass@host:port/db` |
| `redis()`    | `composeService`, `image`        | `redis://host:port`                   |
| `sqlite()`   | `init` or `prismaSchema`         | `file:/…/….sqlite`                    |

`docker/compose.test.yaml` is the single source of truth for test infrastructure; `docker/<service>/init.sql` runs when the corresponding service starts. Parallel isolation is automatic per vitest worker: postgres clones a schema, redis assigns a database index, sqlite copies the template file, compose mode gets a dedicated project.

`sqlite()` caches its schema template inside the project — `.artifacts/vitest/sqlite/template-<key>.sqlite` — so two checkouts never share one, and workers racing for a cold cache wait for the one that is building rather than all building at once. Details: [docs/11-services.md](docs/11-services.md#where-the-template-lives).

## Mocking utilities

```typescript
import { mockOf, mockOfDate } from '@jterrazz/test';
```

| Export        | Description                                                  |
| ------------- | ------------------------------------------------------------ |
| `mockOf<T>()` | Deep mock of any interface (wraps `vitest-mock-extended`)    |
| `mockOfDate`  | Freeze/reset the global Date via `.set(date)` and `.reset()` |

## Conventions

Normative rules live in the constitution ([docs/12-conventions.md](docs/12-conventions.md)); the generated per-rule catalogue is [docs/13-linting.md](docs/13-linting.md). A facet (`specs/<facet>/`) carries its runner(s) at its root and holds domain folders; the folder follows the assets:

```
specs/<facet>/                  # api | jobs | cli | integrations | lint
├── <facet>.specification.ts    # runner(s) at the facet ROOT (rule C1)
└── <domain>/                   # a product command/area — 1..n test files
    ├── <aspect>.test.ts
    ├── _seeds/          # *.sql ONLY — database state
    ├── _requests/       # *.http — inputs: COMPLETE request (method, path, headers, body)
    ├── contracts/      # <name>.contracts.ts facade + <provider>/<name>.ts units + their .response.json / .request.ts data
    ├── _fixtures/       # domain-local files/dirs copied into the cwd (cli) — shared pool lives at specs/_fixtures/
    └── _expected/       # ALL expected fixtures, FLAT (incl. response *.http) — a slash in the name creates a subfolder
```

A test with its OWN asset dirs gets its own domain folder; tests without local assets group as sibling `<aspect>.test.ts` files inside a named group folder (the folder follows the assets). `.fixture(path)` is the one verb that copies into the cwd: domain-local (`_fixtures/…`) or shared (`$FIXTURES/…` → `specs/_fixtures/…`), with rsync trailing-slash semantics and layering. `.seed()` is SQL-only.

Every test contains `// Given -` and `// Then -` comments (always both; `// When -` only if the action is not obvious — the chain IS the when). User-facing framework env vars: `TEST_MODE` and `TEST_UPDATE` — the only ones you set; the framework also reads vitest's `VITEST_POOL_ID` for per-worker isolation.

### Convention enforcement — the shipped lint plugin

These conventions are not just prose: the package ships an oxlint plugin (`@jterrazz/test/oxlint`) with ~40 AST rules, plus a `jterrazz-test-check` binary (the conventions checker) that reads the data fixtures and cross-file relationships oxlint cannot. Wire the plugin into your `oxlint.config.ts` and run `jterrazz-test-check specs` in CI — the full four-channel catalogue (each rule, its channel and rationale) is generated into [docs/13-linting.md](docs/13-linting.md).

## Requirements

- **Docker** - testcontainers for node mode, docker compose for compose mode; not needed for `sqlite()`, plain cli specs, website specs, or mobile specs
- **vitest** - peer dependency
- **playwright** - optional peer dependency, only needed for `.visit()`: `npm install -D playwright && npx playwright install chromium`
- **appium + webdriverio** - optional peer dependencies, only needed for `specification.mobile()`: `npm install -D appium webdriverio && npx appium driver install xcuitest` — plus Xcode, a simulator, and the app installed on it
- **msw** - bundled as a direct dependency (powers `.intercept()`); no separate install
- **hono** (or any web framework) - supplied by your project for in-process apps; the adapter only needs an object with a `request()` method, so it is not a peer

## Docs

- Guide (chapters): [docs/README.md](docs/README.md) — getting started, API/jobs/CLI/website/mobile specs, assertions, tokens, contracts, services, conventions, linting
- API reference: committed under [docs/reference/](docs/reference/) — compiled from source by `npm run docs`
- Agent skill: [skills/jterrazz-test/](skills/jterrazz-test/) — mental model, per-facet references, generated rule reference
