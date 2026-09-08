# CLI specs — `specification.cli()`

Operative reference. Prose + examples: [docs/07-cli.md](../../docs/07-cli.md). Assertions: [docs/08-assertions.md](../../docs/08-assertions.md). Tokens: [references/tokens.md](tokens.md).

Runs a command binary against fixture projects in fresh, empty temp directories. Inherently e2e — no node/compose split.

## Runner (in `*.specification.ts`, `afterAll(cleanup)`)

```typescript
export const { cli, cleanup } = await specification.cli(
    resolve(import.meta.dirname, '../../bin/my-cli.sh'),
    { services: { db: postgres() } }, // optional
);
afterAll(cleanup);
```

`specification.cli(bin, { root?, services?, docker?, transform?, env?, serve? })` → `{ cli, cleanup, docker, orchestrator }`. `env` / `serve` are the two registries a [spec document](#spec-documents--casespecyaml) names by word.

- Exercise the **product command**, not a third-party binary — `specification.cli()` on a `node_modules/.bin` binary is a B9 warning. Drive `cli.exec('build')`, `cli.exec('check')`, … and assert via the real output. Suppress with a reason only when the product genuinely IS that binary.
- `transform` is a last-resort escape hatch for output noise not covered by tokens (D6) — a token-equivalent transform is a warning.

## Setup (chainable)

| Method                             | Description                                                                                                                                     |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `.seed("file.sql", { database? })` | SQL from `_seeds/` (A7 rules apply)                                                                                                             |
| `.fixture("file")`                 | Copy the feature-local `_fixtures/file` into the cwd                                                                                            |
| `.fixture("$FIXTURES/name/")`      | Shared `specs/_fixtures/name/`. Trailing `/` (rsync) = spread contents into cwd; no slash = nest under `name/`. Chained calls layer (last wins) |
| `.env({ KEY: "value" })`           | Child env vars. `null` unsets, `$WORKDIR` expands to the cwd, calls merge. Overrides B6 injection                                               |

There is no `.project()` and no seed handler — `.fixture()` is the one file-state verb, `.seed()` is SQL-only (C7).

## Sandbox — the chain reaches nothing real

Reaching a real `kubectl` / `helm` / `gh`, the network, or the operator's `$HOME` is a test escaping the sandbox, not extra realism — D7's rule for HTTP, with no mechanism to enforce it here: the chain states it, in three verbs.

```typescript
await cli
    .fixture('$FIXTURES/cluster-stub/') // bin/<binary> stubs into the temp cwd
    .env({ HOME: '$WORKDIR', PATH: '$WORKDIR/bin:/usr/bin:/bin' }) // stubs first; pin the tail
    .exec('cluster pods');
```

A stub is `_fixtures/<name>/bin/<binary>`: a `case "$*"` script answering by argv, with a catch-all that exits non-zero on any invocation nobody canned. **One fixture per ANSWER of the system** (a cluster populated / empty / unreachable) — a new answer is a new fixture, never a flag on an existing stub. Chained fixtures layer, which is how one is extended.

## Action (terminal) — one execution method, no `.spawn()`

| Method                                | Notes                                                                                                                 |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `.exec("args")`                       | Blocking → `CliResult`                                                                                                |
| `.exec(["build", "start"])`           | Sequential in the same cwd; stops on first non-zero exit                                                              |
| `.exec("dev", { waitFor, timeout? })` | Long-running — resolves at the `waitFor` pattern (exit 0), killed at `timeout` (default 10 s, exit 124)               |
| `.run("case.spec.yaml")`              | Runs a [spec document](#spec-documents--casespecyaml): its ground and EVERY run asserted → the last run's `CliResult` |

## Spec documents — `<case>.spec.yaml`

One scenario per document, **beside the spec** (never under `_expected/`, which holds goldens). The ground first, then the runs.

```yaml
description: refuses to guess when it is run outside the checkout # the vitest title, lowercase, no period
fixture: $FIXTURES/repositories-stub/ # string or list; layers, .fixture() semantics
env: # bare word = a set registered in code; KEY=value inline; $WORKDIR expands
    - frozen
    - SHOPLY_ORIGIN=http://127.0.0.1:9
serve: # servers registered in code; the mapping form adds env to that server
    - mcp: { MCP_STUB_WITHHOLD: get-article }
runs:
    - command: shoply repositories
      exit: 1
      stderr: |
          Error: no directory with home/ and apps/ above the current directory
```

- Document keys are CLOSED (`kind`, `description`, `fixture`, `env`, `serve`, `runs`) and so are a run's (`command`, `stdin`, `timeout`, `waitFor`, `exit`, `stdout`, `stderr`, `files`); anything else is a refusal naming the key and its line (`d4b-spec-shape`). `description:` and `runs:` are mandatory, `command:` and `exit:` are mandatory in every run.
- **`|` keeps the final newline, `|-` drops it** — the comparison is byte-exact against exactly that. An ABSENT `stdout:`/`stderr:` asserts an EMPTY stream. Streams are always block scalars, never quoted strings with `\n` (`d4b-spec-block-scalar`, fixable).
- `{{token}}` works in `stdout`, `stderr` and the `files:` texts (D4), never in `description`, `command` or `exit`. Use `{{string}}` for wording that varies within a LINE; `{{any}}` only for a span that crosses lines — a stream that is ONLY `{{any}}` asserts nothing (`j3w-spec-empty-assertion`).
- `files:` asserts what the run left under the cwd: `{ contains: … }` (one needle or a list), `{ equals: … }`, `absent`, `exists`. Relative paths only. Each run is judged the moment it ends, so a path may be `absent` in one run and present in the next; a mismatch stops the document there.
- `stdin:` is written then closed; `timeout:` is per run; `waitFor:` is the long-running form and is allowed on the LAST run only.
- All runs share ONE cwd and the same servers, and **every** run is asserted — unlike `.exec([...])`, a non-zero exit does not stop the sequence.
- On a mismatch the diff marks only the real cause: a token line that matched renders as equal, and the stack carries one frame — the run's `command:` line.
- `TEST_UPDATE=1` rewrites each run's `exit`, `stdout` and `stderr`, and nothing else: the ground, the commands, `files:`, comments and key order all come back byte-identical.
- Keys are written in the canonical order (`d4b-spec-key-order`, fixable); the file is `<case>.spec.yaml` with `<case>` in kebab-case, never the bare name of its directory (`c12-spec-file-name`). The whole document family is in [rules.md](rules.md).

The JSON Schema ships at `@jterrazz/test/schema` (`schema/spec.schema.json`) — point an editor at it:

```yaml
# yaml-language-server: $schema=./node_modules/@jterrazz/test/schema/spec.schema.json
```

Registration, once per app:

```typescript
await specification.cli(bin, {
    env: { frozen: { HOME: '$WORKDIR', TZ: 'UTC' } },
    serve: {
        mcp: {
            command: 'bun specs/harness/mcp-server.ts',
            // cwd = the PROJECT root (A9: nearest package.json above the spec file) —
            // In a workspace that is apps/<pkg>/, not the repo root
            env: 'SHOPLY_MCP_ORIGIN', // the var the URL is bound to in every run
            ready: /listening on port (?<port>\d+)/, // group 1 = the port the server announces
            url: (port) => `http://127.0.0.1:${port}/mcp`,
        },
    },
});
```

Every served child is seeded with `TEST_WORKDIR` — the resolved working directory, the same path `{{workdir}}` holds — after `fixture:` has been copied, so a stub answers out of files the document laid down (`$TEST_WORKDIR/answers/<system>/<file>`). The mapping form overrides it like any other key.

Three doors, one engine:

| Door       | How                                                                                                                                                      |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **plugin** | `literate({ specification: './specs/cli/cli.specification.ts' })` from `@jterrazz/test/vitest` in `vitest.config.ts` — the document IS the test file     |
| **bridge** | `const result = await cli.run('case.spec.yaml')` from a `.test.ts` — runs the whole document, returns the LAST run's `CliResult` for one extra assertion |
| **chain**  | unchanged — reach for it for containers, parallel fan-out, host shell-outs, structural JSON, database state                                              |

`cli.run(file, { frozen: true })` opts a deliberately-wrong document out of the update rewrite (the document's mirror of `toMatch(name, { frozen: true })`).

## Assertions

```typescript
expect(result.exitCode).toBe(0);
expect(result.stdout).toContain('Build completed'); // scalpel probe
expect(result.stdout).toMatch('help.txt'); // golden — _expected/help.txt, {{token}}-aware
expect(result.file('dist/index.js').exists).toBe(true);
await expect(result.directory('out')).toMatch('scaffold'); // _expected/scaffold/ (directory)
await expect(result.filesystem).toMatch('upgraded'); // whole cwd
```

- Text reaches you via a `TextAccessor` (`result.stdout` / `.stderr` / container logs / `file().grep()`). `.grep(pattern)` returns a `TextAccessor` (chainable, snapshot-able) — there is NO `result.grep()`.
- Golden the whole surface per scoped use case (D11); `.grep()` / `toContain` for targeted presence/absence only. ANSI is stripped before comparison (`.text` stays raw).

## Services → auto-injected child env (B6)

With `services`, connection URLs are injected into the child: `<KEY>_URL` (CONSTANT_CASE, camelCase-aware — `analyticsDb` → `ANALYTICS_DB_URL`), plus `DATABASE_URL` (exactly one SQL DB) and `REDIS_URL` (exactly one redis). `.env()` overrides; `null` removes. Do NOT re-declare an injected URL with `.env()` (B6 warning).

## Docker-aware CLIs

For a CLI that spawns containers, declare `docker: { envVar, nameLabel, testRunLabel }`; the runner injects a unique test-run id, the binary must stamp `testRunLabel=<id>` on its containers.

```typescript
await using result = await cli.fixture('$FIXTURES/two-shops/').exec('deploy alpha'); // B5: bind with `await using`
const shop = result.container('alpha'); // lazy — queries docker only on access
expect(shop.exists).toBe(true); // property reads are SYNC
await expect(shop).toBeRunning(); // the async matcher
expect(shop.file('/app/shoply.yaml').content).toContain('name: alpha');
```

`await using` (B5) force-removes leaked containers at scope exit. Absent names return `exists === false` (no throw); a test that never calls `.container()` never touches Docker.

## Folder layout

```
specs/cli/
├── cli.specification.ts        # runner(s) at the facet ROOT
└── <domain>/                   # a product command/area — the folder follows the assets
    ├── <aspect>.test.ts        # 1..n test files per domain
    ├── <case>.spec.yaml        # spec documents, BESIDE the tests (never under _expected/)
    ├── _fixtures/               # domain-local, copied into the cwd via .fixture('name')
    ├── _seeds/                  # *.sql ONLY
    └── _expected/               # snapshots, FLAT ('help.txt', 'config.json', 'tree-name/')
```
