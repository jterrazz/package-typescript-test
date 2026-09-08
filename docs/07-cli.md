# 07 — CLI specs (`specification.cli`)

`specification.cli(bin, options)` tests a command-line binary. Every spec runs the binary in a **fresh, empty temp directory**, captures stdout/stderr/exit code, and exposes the resulting filesystem — and, in Docker-aware mode, the containers the binary spawned. The CLI is always a local binary: there is no node/compose mode (rule A5).

Use it when the subject under test is a process invocation. If the process serves HTTP, test that surface with [api](05-api.md).

## Creating the runner

```typescript
// specs/cli/cli.specification.ts
import { resolve } from 'node:path';
import { afterAll } from 'vitest';
import { specification } from '@jterrazz/test';

export const { cli, cleanup } = await specification.cli(
    resolve(import.meta.dirname, '../../bin/shoply.sh'),
);

afterAll(cleanup);
```

### Options

| Option      | Description                                                                                                                                                                                                                                   |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `root`      | **Project-root override** only (rule A9): anchors compose detection + local-bin resolution. It is _not_ a fixtures root — `.fixture()` resolves paths on its own. Auto-discovery applies when omitted                                         |
| `services`  | Named record of infrastructure services (`postgres()`, `redis()`, `sqlite()`) — connection URLs are auto-injected into the child env (rule B6)                                                                                                |
| `docker`    | Opt-in Docker awareness: `{ envVar, nameLabel, testRunLabel }` — see [Docker-aware mode](#docker-aware-mode)                                                                                                                                  |
| `env`       | Named **environment sets** a spec document names by bare word (`env: [frozen]`) — see [Spec documents](#spec-documents--casespecyaml)                                                                                                         |
| `serve`     | Named **servers** a spec document starts (`serve: [mcp]`): `{ command, ready, url, env }` — see [Spec documents](#spec-documents--casespecyaml)                                                                                               |
| `transform` | **Escape hatch only** (rule D6): a normalizer applied to streams before comparison, for application noise not covered by tokens. ANSI stripping is already the default; a transform that only re-implements standard tokens is a lint warning |

## `.exec()` — the single execution method

`.exec(args?, options?)` is the **only** way to run the binary — there is no `.spawn()` (rule B2). It covers short commands, long-running processes, and sequences. Called with **no arguments**, the binary runs bare (no CLI args) — clearer than the `.exec('')` idiom:

```typescript
const result = await cli.exec(); // invoke the binary with no arguments
```

Note the asymmetry with the array form: `.exec()` (no args) is a bare invocation, but `.exec([])` (empty array) throws — a command _sequence_ must name at least one command.

```typescript
test('shows help', async () => {
    // Given
    const result = await cli.exec('--help');

    // Then - full stdout snapshot; ANSI already stripped, dynamics covered by tokens
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch('help.txt');
});
```

### Long-running processes: `waitFor` / `timeout`

```typescript
test('dev server boots', async () => {
    // Given - long-running: resolved on pattern match, killed at timeout otherwise
    const result = await cli
        .fixture('$FIXTURES/base-shop/')
        .exec('dev --port 0', { waitFor: 'Listening on', timeout: 10_000 });

    // Then
    expect(result.stdout).toContain('Listening on');
});
```

- `waitFor` — a pattern; the promise resolves (exit code 0) as soon as it appears in **stdout or stderr** (both streams are watched). If the process exits before matching, the result carries a non-zero exit code (a clean exit-0 without the pattern is reported as `1`).
- `timeout` — milliseconds; the process is killed when it elapses without a match, with exit code `124`. **Default: 10 000 ms** when `waitFor` is set without a `timeout`.
- On resolution (match, exit, or timeout) the child is terminated with `SIGTERM`, escalating to `SIGKILL` after a 2 s grace period if it ignores the first signal.
- Termination targets the **whole process group**, not just the direct shell child: the process is spawned detached (its own group on POSIX) and signalled via the negative pid, so descendants — a `tsdown --watch` grandchild under a `dev` command, a background server the script forked — die with it instead of leaking past the spec. On platforms without group support (Windows), or when the group is already gone, it degrades to the direct child kill.
- Passing either option marks the run as long-running; combining them with the array (sequence) form is an error.

Quoting is identical between the one-shot and `waitFor` forms: both run the full command line through the shell (`spawnSync` vs `spawn`, `shell: true`), so a quoted argument behaves the same either way — there is no naive whitespace split.

### Sequences: array form

```typescript
test('build then start chain stops at first failure', async () => {
    // Given - a sequence in the SAME working directory
    const result = await cli.fixture('$FIXTURES/base-shop/').exec(['build', 'start --check']);

    // Then
    expect(result.exitCode).toBe(0);
});
```

Commands run sequentially in the same cwd; the sequence stops at the first failure. This is still one terminal action — one spec, one `.exec()` (rule B1). An empty array throws (`exec([]) requires at least one command`), and `{ waitFor, timeout }` cannot be combined with the array form.

## Working-directory semantics

Every spec gets a brand-new temp directory (`mkdtemp`) as its cwd. The runner never writes into your fixtures.

That directory lives in the **OS temp dir**, and it stays there on purpose. It is per-RUN scratch — created for one spec, gone when the run ends — not something the project produced, so it does not belong under `.artifacts/` with the caches a next run reuses (see [02 — Developing](02-developing.md#artefacts-live-under-artifacts)). Writing it inside the project would also change what a spec sees: a binary that walks up looking for a `package.json` would find yours instead of nothing.

Two disjoint verbs shape a spec's state (rule C7): **`.fixture()` carries file state** (an isolated tree copied into the cwd), **`.seed()` carries database state** (SQL only). Any "transformation" you need is expressed declaratively, in the _shape_ of the fixture tree.

`.fixture(path)` resolves in one of two ways and copies with rsync's trailing-slash semantics:

| Path                     | Resolves to                                   | Copy effect                                     |
| ------------------------ | --------------------------------------------- | ----------------------------------------------- |
| `'config.toml'`          | `<domain>/_fixtures/config.toml` (leaf-local) | `<cwd>/config.toml`                             |
| `'$FIXTURES/base-shop/'` | `specs/_fixtures/base-shop/` (shared pool)    | **contents spread** into `<cwd>` (trailing `/`) |
| `'$FIXTURES/base-shop'`  | `specs/_fixtures/base-shop/` (shared pool)    | `<cwd>/base-shop/` (dir under its own name)     |

> **⚠️ Trailing slash = spread vs. nest.** For a directory fixture, the trailing `/` is load-bearing — it is exactly rsync's semantics, and it changes where files land:
>
> | Form                          | Copies                    | Result in the cwd            |
> | ----------------------------- | ------------------------- | ---------------------------- |
> | `.fixture('$FIXTURES/shop/')` | **contents** of `shop/`   | `<cwd>/package.json`, …      |
> | `.fixture('$FIXTURES/shop')`  | the `shop/` **directory** | `<cwd>/shop/package.json`, … |
>
> Almost always you want the **trailing slash** (spread the project into the cwd, so the tool runs at the root). Drop it only when the command expects the project one level down.

`$FIXTURES` points at `specs/_fixtures/` (the nearest ancestor `specs/` dir + `_fixtures/`); any other `$…` marker is an error. Chained `.fixture()` calls **layer** in order — a later fixture overwrites files from an earlier one.

| Setup                              | Effect on the cwd                                                    |
| ---------------------------------- | -------------------------------------------------------------------- |
| _(nothing)_                        | Empty directory                                                      |
| `.fixture('$FIXTURES/base-shop/')` | Spread a whole shared project into the cwd                           |
| `.fixture('config.toml')`          | Copy the feature-local `_fixtures/config.toml` into the cwd          |
| `.seed('…')`                       | SQL into a service database (rule A7 governs the `database:` option) |

```typescript
test('scaffolds a new shop', async () => {
    // Given - empty cwd (every spec = fresh mkdtemp)
    const result = await cli.exec('create my-shop');

    // Then - precise files…
    expect(result.exitCode).toBe(0);
    expect(result.file('my-shop/shoply.yaml').exists).toBe(true);
    expect(result.file('my-shop/shoply.yaml').content).toContain('name: my-shop');
    expect(result.file('my-shop/.env').exists).toBe(false);

    // …or a tree snapshot (structured added/removed/changed diff)
    await expect(result.directory('my-shop')).toMatch('shop-scaffold');
});

test('upgrade rewrites the workspace predictably', async () => {
    // Given
    const result = await cli.fixture('$FIXTURES/base-shop/').exec('upgrade');

    // Then - snapshot of the ENTIRE cwd + flat read of the file list
    await expect(result.filesystem).toMatch('upgraded-shop');
    expect(await result.filesystem.files()).toContain('shoply.lock');
});

test('seeds a single fixture file', async () => {
    // Given
    const result = await cli.fixture('legacy-config.toml').exec('migrate-config');

    // Then
    expect(result.file('shoply.yaml').exists).toBe(true);
});
```

Tree snapshots are directories under `_expected/` (`_expected/shop-scaffold/`) — the one `toMatch` argument that takes no extension (rule C6).

## `.env()` — child process environment

```typescript
test('isolates HOME per spec', async () => {
    // Given - HOME on the temp cwd, TZ pinned, stray variable removed
    const result = await cli
        .env({ HOME: '$WORKDIR', TZ: 'UTC', SHOPLY_TOKEN: null })
        .exec('login --offline');

    // Then
    expect(result.file('.shoply/credentials').exists).toBe(true);
});
```

- `'$WORKDIR'` expands to the spec's temp cwd — pin `HOME`, caches, config dirs onto isolated ground.
- `null` **removes** a variable from the child env — shield the spec from the developer's shell.
- Repeated `.env()` calls merge; later keys win.

### Auto-injected connection URLs (rule B6)

When the runner has `services`, the framework injects into the child env, automatically:

| Variable       | Rule                                                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `<KEY>_URL`    | One per record key, uppercased to CONSTANT_CASE at camelCase boundaries: `db:` → `DB_URL`, `analyticsDb:` → `ANALYTICS_DB_URL`, `cache:` → `CACHE_URL` |
| `DATABASE_URL` | Standard alias, only when the record has **exactly one** SQL database                                                                                  |
| `REDIS_URL`    | Standard alias, only when the record has **exactly one** redis                                                                                         |

`.env()` overrides any injected value; `null` removes it. Re-declaring what injection already provides (`.env({ DATABASE_URL: db.connectionString })`) is redundant — future lint warning.

```typescript
// One SQL database → DATABASE_URL and DB_URL both injected, no database: option (rule A7)
export const { cli: migrateCli, cleanup } = await specification.cli('shoply-migrate', {
    services: { db: postgres() },
});

test('migrates a legacy schema', async () => {
    // Given - DATABASE_URL / DB_URL injected automatically into the child env
    const result = await migrateCli.seed('legacy-schema.sql').exec('up');

    // Then
    expect(result.exitCode).toBe(0);
    await expect(result.table('schema_migrations')).toMatchRows({
        columns: ['version'],
        rows: [['20260716']],
    });
});
```

## File state is the shape of a fixture tree

CLI-mode `.seed()` is **SQL only** — it carries database state, nothing else (rule C7). To put files or config trees into the cwd, use `.fixture()` with a fixture laid out exactly as the cwd should look. There is no "seed handler" or path-prefix dispatch.

```typescript
// specs/cli/deploy/fixtures/two-shops/  ← committed, shaped like the target cwd
//   shoply.yaml
//   shops/alpha/config.yaml
//   shops/beta/config.yaml

test('deploys from a shaped workspace', async () => {
    // Given - the tree is spread into the cwd; layering a second fixture would
    // overwrite matching files (last write wins)
    const result = await cli.fixture('two-shops/').exec('deploy alpha');

    // Then
    expect(result.exitCode).toBe(0);
});
```

### Where a fixture lives

The two doors are not interchangeable, and the question that picks between them is **how many leaves read this tree**.

The POOL — `specs/_fixtures/`, reached by `$FIXTURES/` — is for what SEVERAL leaves share. That is the whole of its meaning: an entry there announces "other specs depend on me, change me with care". A tree only one spec directory reaches for is not shared ground, whatever folder it sits in; parked in the pool it collects the pool's caution without earning it, and the one spec that actually owns it is a directory away, invisible to the next reader. It is an error (C15's twin, **C14**), and `jterrazz-test-check --fix` moves it beside its leaf and rewrites the reference.

A LEAF'S OWN ground sits beside it, as `<domain>/_fixtures/<name>/`, and is reached by the plain relative form — `.fixture('config.toml')`, `.fixture('base-shop/')`. It is read from that leaf and nowhere else: a path that climbs out of its own `_fixtures/` (a `../`, a sibling's tree) is the pool by another door, with none of the pool's visibility — the neighbour's author has no way to know you depend on them, edits their ground, and breaks a spec two folders away. That is **C15**; the repair is to promote the tree to the pool, where its sharing is declared.

So: one reader, beside the leaf. Two or more, in the pool. Write it local first — promotion is a `--fix` away, and demotion is the rule the checker enforces.

## The chain never reaches a real system

A CLI spec is sandboxed the way an HTTP spec is, and for the same reason: what a chain proves must come out of its fixture, never out of the machine that happened to run it. A chain that shells out to a real `kubectl`, `helm` or `gh`, opens a network connection, or reads the operator's home directory is **a test escaping the sandbox, not extra realism** — it passes on the one laptop where those tools are installed and configured, fails everywhere else, and either way it proves something about that laptop rather than about the binary under test. The HTTP half of the same rule is D7, in [contracts](10-contracts.md).

The framework supplies the ground; the chain states the sandbox, in three verbs:

| Verb                                           | What it closes                                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `.fixture('$FIXTURES/<name>/')`                | spreads a `bin/` of stub binaries into the spec's temp cwd                                 |
| `.env({ PATH: '$WORKDIR/bin:/usr/bin:/bin' })` | puts those stubs FIRST — the binary finds the stub, never the tool installed on the host   |
| `.env({ HOME: '$WORKDIR' })`                   | moves config dirs, caches and credential stores onto the temp cwd, off the operator's home |

`PATH` is not rewritten for you: `.fixture()` lays the tree down, `.env()` decides what the child is allowed to find. Pin the tail of `PATH` too — inheriting the developer's own `PATH` re-opens the door the stub was there to close.

```typescript
test('reports what the cluster holds', async () => {
    // Given - stubs first on PATH, HOME on the temp cwd: nothing can reach out
    const result = await cli
        .fixture('$FIXTURES/cluster-stub/')
        .env({ HOME: '$WORKDIR', PATH: '$WORKDIR/bin:/usr/bin:/bin', TZ: 'UTC' })
        .exec('cluster pods');

    // Then
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch('pods.txt');
});
```

### The shape of a stub fixture

A stub fixture is a `bin/` holding one script per binary the run must not find for real:

```
specs/_fixtures/cluster-stub/
└── bin/
    ├── kubectl
    └── helm
```

Each script answers **by argv** and refuses everything else. The executable bit survives the copy, so a stub committed `chmod +x` is executable in the cwd:

```bash
#!/bin/sh
# Every invocation this suite cans. Anything else is a chain reaching for an
# answer nobody wrote — fail loudly rather than improvise one.
case "$*" in
  "get pods -A -o json")
    cat <<'JSON'
{"items":[{"metadata":{"name":"api-abc12","namespace":"prod"},"status":{"phase":"Running"}}]}
JSON
    ;;
  *)
    echo "cluster-stub kubectl: unexpected invocation: $*" >&2
    exit 64
    ;;
esac
```

The catch-all matters as much as the canned cases: a stub that shrugs at an unknown invocation hands the chain an empty success, and the spec goes green on a command nobody described.

**One fixture per ANSWER of the system, not one per test.** A cluster with things in it, that same cluster holding nothing, and a cluster whose API server is down are three fixtures, not three settings of one — they are three answers to the same question, and choosing between them is choosing what the chain proves. So a new answer is a NEW fixture, never a flag threaded through an existing stub: fixtures layer (a drift stub over a healthy one), which is how one is extended without being made conditional.

**The data-driven form: the script routes, a FILE answers.** When the answer is a document — a JSON payload, a listing, a manifest — heredocs stop being readable and stop layering: two worlds that differ only in what the cluster holds have to differ in the script. So the `case` maps a question to an answer file under `answers/<system>/`, and the script's whole job is routing:

```bash
#!/bin/sh
# Route argv to the file that answers it. The ANSWERS are the fixture; this
# Script only says which one the question maps to.
answers="${0%/*}/../answers/cluster"
case "$*" in
  "get pods -A -o json") file="$answers/pods.json" ;;
  "get nodes -o json")   file="$answers/nodes.json" ;;
  *) echo "cluster-stub kubectl: unexpected invocation: $*" >&2; exit 64 ;;
esac
[ -f "$file" ] || { echo "cluster-stub kubectl: no answer file at $file" >&2; exit 64; }
cat "$file"
```

Two failures, both exit 64, and they say different things: **no route** names the argv nobody described, **a routed file that is absent** names the path the fixture was supposed to carry. Neither may degrade into an empty success — which is also why **an empty answer is an EMPTY file, never a missing one**: "the cluster holds nothing" is a fixture stating `[]`, and a file that is not there is a fixture that forgot to state anything.

Pick by what the stub is standing in for. **Data-driven** when the answer is a document two worlds may legitimately differ on — that difference is then a fixture layered over another, and the script never changes. **`case`** when the stub simulates an action (a write, an exit code, a banner) or answers one constant: a file per constant is a directory of one-liners, and indirection nobody reads.

A served stub — a `serve:` server in a spec document — routes the same way over `$TEST_WORKDIR`, which is where that document's `fixture:` landed: see [Registration — once per app](#registration--once-per-app).

## Streams, JSON, grep

```typescript
test('fails on unknown command with a useful error', async () => {
    // Given
    const result = await cli.exec('frobnicate');

    // Then
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown command 'frobnicate'");
    expect(result.stdout.text).toBe(''); // .text = raw, never transformed
});

test('emits machine-readable config', async () => {
    // Given
    const result = await cli.exec('config --json');

    // Then
    expect(result.json.value).toMatchObject({ name: 'shoply' }); // read + native matcher
    expect(result.json).toMatch('config.json'); // _expected/config.json
});

test('lints a shop and reports per-file blocks', async () => {
    // Given
    const result = await cli.fixture('$FIXTURES/base-shop/').exec('lint');

    // Then - snapshot the whole surface; grep is the scalpel for targeted probes
    expect(result.stdout).toMatch('lint-output.txt'); // full snapshot, tokens for volatile parts
    expect(result.stdout.grep('products/ok.yaml')).not.toContain('error'); // absence probe
});
```

`result.stdout` / `result.stderr` are `TextAccessor` subjects — the universal text handle (stdout, stderr, container logs, file text): ANSI-stripped for every comparison (rule D6), with `.text` exposing the raw capture. Text operations are **closed** over the type: `.grep(pattern)` returns a `TextAccessor` (not a string), so it chains (`result.stdout.grep(a).grep(b)`) and snapshots (`expect(result.stdout.grep('users.ts')).toMatch('block.txt')`). There is no `result.grep()` — the source is always explicit. `result.json` parses stdout as JSON (`.value` for the parsed object).

**Tool output → snapshot per scoped use case (rule D11).** For linter/compiler/CLI output, prefer a per-use-case fixture project + a full `expect(result.stdout).toMatch('<use-case>.txt')` snapshot (volatile parts covered by `{{duration}}` / `{{workdir}}` / `{{path}}` tokens, generated with `TEST_UPDATE=1`) over a cluster of greps. The fixture is the Given — no shared `beforeAll`. Keep `.grep()` for targeted presence/absence probes in large outputs. The full surface is in [assertions](08-assertions.md).

## Spec documents — `<case>.spec.yaml`

A terminal session is already a specification: a command, its exit code, what it printed, what it left on disk. A **spec document** writes it as that — one scenario per `<case>.spec.yaml`, living **beside the spec** (never under `_expected/`, which holds goldens, not scenarios). Nothing here is new capability: it is the chain's semantics in the shape of a data file an editor can validate.

```yaml
description: refuses to guess when it is run outside the checkout
fixture: $FIXTURES/repositories-stub/
env:
    - frozen
    - SHOPLY_ORIGIN=http://127.0.0.1:9
serve:
    - mcp: { MCP_STUB_WITHHOLD: get-article }
runs:
    - command: shoply repositories
      exit: 1
      stderr: |
          Error: no directory with home/ and apps/ above the current directory
          Hint: run inside the shoply checkout
    - command: shoply repositories --json
      exit: 0
      stdout: |
          {
              "data": []
          }
```

### The ground

Everything above `runs:`. Any key outside the table below is a refusal naming the key and its line.

| Key            | Shape                                       | Meaning                                                                                                                                        |
| -------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `kind:`        | optional, default `cli`                     | The facet the document describes. Reserved for a second facet; `cli` is the only one implemented                                               |
| `description:` | **mandatory**, one line                     | The vitest test title. Lowercase prose, no trailing period                                                                                     |
| `fixture:`     | string or list                              | Identical to `.fixture()`: `$FIXTURES/…` or feature-local, trailing slash = spread, executable bits preserved. A list **layers** in order      |
| `env:`         | string or list                              | Each entry is either a **bare word** naming an env set registered in code, or `KEY=value` inline (`$WORKDIR` expands, as in `.env()`)          |
| `serve:`       | string, list of strings, or `- name: { … }` | Servers registered in code, started once **per file** before the first run and shared by all of them. The mapping form adds env to that server |

### The runs

`runs:` is a list of at least one run, executed **in order**, all in ONE working directory, and **every** one asserted. This is where the format goes past `.exec([...])`, which stops at the first non-zero exit and keeps only the last output: here a non-zero exit does not end the session, because each exit code is part of what the document states.

**A run is judged the moment it ends**, before the next command starts — its exit code, its streams and its `files:` all read at that one instant. So a document states the working directory as it was BETWEEN two commands, not only as the session left it. A run that disagrees throws there and then, and the runs below it do not execute: once the sequence has diverged, what the rest would print is a consequence, not a fact about the program.

| Key        | Shape                         | Meaning                                                                                                                     |
| ---------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `command:` | **mandatory**                 | The argv line, handed to the same adapter as `.exec('…')` — the full line through the shell, so quoting behaves identically |
| `stdin:`   | optional block scalar         | Written to the child, which then reads EOF. Absent keeps today's immediately-closed pipe; a TTY is never given              |
| `timeout:` | optional integer              | Milliseconds before the run is killed (exit code 124)                                                                       |
| `waitFor:` | optional, **last run only**   | Long-running form: resolve as soon as this text appears, as `.exec(args, { waitFor })` does                                 |
| `exit:`    | **mandatory** literal integer | The exit code the command must return                                                                                       |
| `stdout:`  | optional block scalar         | Expected stdout, **byte-exact**. Absent asserts an EMPTY stream                                                             |
| `stderr:`  | optional block scalar         | Expected stderr, byte-exact. Absent asserts an EMPTY stream                                                                 |
| `files:`   | optional mapping              | On-disk assertions under the working directory, read the moment THIS run ends (below)                                       |

**`|` and `|-` are the whole newline story.** A block scalar written `|` keeps the final newline of its text; `|-` drops it. The comparison is byte-exact against that, so a command whose output ends with `\n` is written `|`, and one that ends mid-line is written `|-`. There is no normalisation to remember, and no empty last line to spell.

The whole [token vocabulary](09-tokens.md) works in `stdout`, `stderr` and the `files:` texts — `{{url}}`, `{{int}}`, `{{workdir}}`, `{{any}}`, `#ref` captures — and **never** in `description`, `command` or `exit`, which are prose and data. For wording that varies WITHIN a line (a duration phrase, a hostname, a count in a sentence), reach for `{{string}}`, which stops at the end of the line; keep `{{any}}` for a span that genuinely crosses lines.

### `files:` — what the run left behind

Each key is a path relative to the working directory (never absolute, never escaping it). Each value is one of four forms:

```yaml
files:
    .spwn/agent.yaml: { contains: 'name: bot' } # one needle, or a list of them
    out/report.txt:
        equals: | # exact text, block scalar allowed
            ok
    .spwn/lock: absent # nothing at that path
    out/src: exists # something at that path
```

`contains` and `equals` are token-aware: `{ contains: 'wrote {{path}}' }` finds the line whatever the path turned out to be.

Each run's mapping is read against the working directory **as that run left it**, so a file may be `absent` for one run and there for the next — which is how a lock, a cache or a build output is described:

```yaml
description: the lock appears with the first apply and is released by the second
runs:
    - command: spwn status
      exit: 0
      files:
          .spwn/lock: absent # nothing has claimed the tree yet
    - command: spwn apply --hold
      exit: 0
      files:
          .spwn/lock: { contains: 'pid: {{int}}' } # the same path, one command later
```

Written as one mapping at the end of the session, that pair could not be stated at all: a working directory only ever holds its latest state.

### Registration — once per app

The document names its ground by WORD; the code says what those words mean, in the `specification.cli()` options:

```typescript
// apps/cli/specs/cli/cli.specification.ts, in a workspace
export const { cli, cleanup } = await specification.cli(bin, {
    env: {
        frozen: { HOME: '$WORKDIR', TZ: 'UTC' },
    },
    serve: {
        mcp: {
            // Relative to apps/cli/ — the project root, not the repo root
            command: 'bun specs/harness/mcp-server.ts',
            env: 'SHOPLY_MCP_ORIGIN',
            ready: /listening on port (?<port>\d+)/,
            url: (port) => `http://127.0.0.1:${port}/mcp`,
        },
    },
});
```

A `serve` entry is spawned with the document's extra `KEY: value` merged into its environment, and its **cwd is the project root** — rule A9's root, the nearest ancestor of the specification file carrying a `package.json` or a `docker/compose.test.yaml`. **In a workspace that is the package's own directory, not the repository root**: a spec at `apps/cli/specs/cli/cli.specification.ts` gives `apps/cli/`, so `command` reads `'bun specs/harness/mcp-server.ts'` and not `'bun apps/cli/specs/harness/mcp-server.ts'`. Pass the runner's `root` option to move it.

`ready` is a regex over the child's output whose **first capture group** is the port the server chose (named or not — it is group 1 either way); the framework injects no `PORT`, the server announces one. `url(port)` builds the URL, and `env` names the variable it is bound to in every run's child.

**`TEST_WORKDIR` is seeded into every served child** — the document's working directory in the resolved form `{{workdir}}` holds and `$WORKDIR` expands to. The servers start after `fixture:` has been copied, so a stub reads the world the document laid down (`$TEST_WORKDIR/answers/dashboard/posts.json`) exactly as a stub binary reads `${0%/*}/../answers/`: a scenario is a layer of files, not a flag threaded through the server. The mapping form overrides it like any other key — `- mcp: { TEST_WORKDIR: /elsewhere }` points that one server somewhere else.

### The schema

The document's JSON Schema ships with the package at `schema/spec.schema.json`, published as the `@jterrazz/test/schema` export, and is generated from the grammar's own constants — it cannot describe a shape the parser does not read. Point an editor at it and every key, every type and every closed set is checked as you type:

```yaml
# yaml-language-server: $schema=./node_modules/@jterrazz/test/schema/spec.schema.json
```

A schema says which keys exist, not which ORDER they come in — JSON Schema has no vocabulary for the sequence of an object's members. The canonical order (`kind, description, fixture, env, serve, runs`, and `command, stdin, timeout, waitFor, exit, stdout, stderr, files` inside a run) is the `d4b-spec-key-order` lint pass's, which also rewrites it: `npx jterrazz-test-check specs --fix`. The full document family is in [13 — linting](13-linting.md).

### The three doors, one engine

| Door       | Use it when                                                                                    |
| ---------- | ---------------------------------------------------------------------------------------------- |
| **plugin** | The document IS the test — the common case                                                     |
| **bridge** | The document is the scenario, but one assertion needs code (a directory golden, a grep)        |
| **chain**  | Everything the format cannot say — see [when to reach for code](#when-to-reach-for-code) below |

**The plugin.** `literate()` from `@jterrazz/test/vitest` adds the `.spec.yaml` glob to the test include and transforms each document into a one-test module. The runner then shows the document's path as the test file and `description:` as the title, so a failing scenario opens where it is written:

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import { literate } from '@jterrazz/test/vitest';

export default defineConfig({
    plugins: [literate({ specification: './specs/cli/cli.specification.ts' })],
});
```

`specification` points at the `*.specification.ts` whose exported `cli` runs the documents. It is **stated, never guessed**: a repository may declare several cli runners — different binaries, different service records — and no convention could pick the right one without silently binding a scenario to the wrong command. `include` (default `['**/*.spec.yaml']`) narrows the glob when a tree also holds documents that are _inputs_ to other specs rather than scenarios to run.

**The bridge.** `cli.run('<case>.spec.yaml')` runs the document — its ground, its servers, every run asserted — and resolves with the **last** run's `CliResult`, so code adds what the document cannot express:

```typescript
test('scaffolds a shop and leaves the tree we expect', async () => {
    // Given - the whole session, stated in the document
    const result = await cli.run('scaffold.spec.yaml');

    // Then - one assertion the format has no vocabulary for
    await expect(result.directory('my-shop')).toMatch('shop-scaffold');
});
```

The path is relative to the test file's directory, where the document lives. Setup chained before the call layers **underneath** the document's own ground: a chained `.fixture()` is copied first, the document's `fixture:` entries over it, and its `env:` wins over a chained `.env()`. `{ frozen: true }` opts one document out of the update rewrite — the same guard as `toMatch(name, { frozen: true })`, for a deliberately-wrong document whose failure rendering is the subject of a negative test.

### Failure and update

On a mismatch the failure renders the description, the command, everything the comparison rejected, and where to open the document:

```
Spec mismatch

removes a post and names what is gone

$ posts rm post-recap --yes

Output mismatch (stdout)

- Expected
+ Received
…

files mismatch

  .spwn/lock: expected absent, got a file

specs/cli/removed.spec.yaml:9
Run with TEST_UPDATE=1 to rewrite the runs — the exit code and the streams, and nothing else.
```

A line the comparison ACCEPTED is rendered as equal, with its token — a `{{url}}` that matched is never shown as a `-`/`+` pair against the concrete URL — so the marked lines are the mismatch and nothing else. The stack carries one frame: the run's own `command:` line.

`TEST_UPDATE=1` rewrites **only `exit`, `stdout` and `stderr`, per run**. The ground, the commands and the `files:` assertions are never touched, and neither are comments or key order: the YAML document is edited, not re-emitted. An empty stream loses its key, since absence already asserts emptiness. Placeholders survive by **pattern match**, not by line index, so a token stays a token wherever the line moved to: see [update mode](09-tokens.md#update-mode-tokens-are-preserved).

### When to reach for code

The format states one binary, one working directory, one linear session. Reach for the chain when the spec needs:

- **containers** — `docker`-aware runs, `await using`, `result.container(name)`;
- **parallel fan-out** — several commands that must run at once, or an interleaving;
- **host shell-outs** the binary under test is not — a `git` call, a build step staged by hand;
- **structural JSON** — `result.json` against an `_expected/*.json` golden, where the comparison is by shape rather than by text;
- **database state** — `.seed()` and `result.table(…)`.

A document that starts wanting a conditional is a chain wearing a header. Write it in code.

## Docker-aware mode

For CLIs that spawn Docker containers, declare the `docker` option (rule G3):

```typescript
export const {
    cli: deploy,
    cleanup,
    docker,
} = await specification.cli('shoply', {
    docker: {
        envVar: 'SHOPLY_TEST_RUN', // run id injected into the child env
        nameLabel: 'dev.shoply.shop.name', // label used as the .container(name) key
        testRunLabel: 'dev.shoply.test.run', // label the CLI must put on every container
    },
});
```

The contract with your binary: it must label every container it creates with `testRunLabel = <value of envVar>`. That is how the runner finds — and force-removes — the containers belonging to a run.

A Docker-aware runner **requires `await using`** on every result (rule B5), so leaked containers are cleaned by label filter at scope exit:

```typescript
test('deploy spawns a labelled container', async () => {
    // Given - await using ⇒ containers force-removed at scope exit (rule B5)
    await using result = await deploy.fixture('$FIXTURES/two-shops/').exec('deploy alpha');

    // Then - lazy access (zero Docker calls if you never touch .container)
    const shop = result.container('alpha');
    expect(shop.exists).toBe(true);
    await expect(shop).toBeRunning();

    // Reads INSIDE the container, same vocabulary as on the host
    expect(shop.file('/app/shoply.yaml').content).toContain('name: alpha');
    const inside = await shop.exec('ls /app');
    expect(inside.stdout).toContain('shoply.yaml');
    expect(shop.stdout).toContain('shop ready'); // container logs

    // Absent ≠ crash
    expect(result.container('nope').exists).toBe(false);
    expect(result.containerIds).toHaveLength(1);
});

test('destroy removes the container created in an earlier run', async () => {
    // Given - spawn then destroy: the whole runner shares one run-id scope
    await using first = await deploy.exec('deploy alpha');
    await using second = await deploy.exec('destroy alpha');

    // Then
    expect(second.exitCode).toBe(0);
    expect(second.container('alpha').exists).toBe(false);
});
```

Container accessor surface: `exists`, `running`/`toBeRunning`, `status`, `id`, `file(path)` (content read inside the container), `exec(cmd)` (returns stdout/stderr), `stdout`/`stderr` (container logs). Looking up an absent container returns `exists: false` instead of throwing. `result.containerIds` lists every container captured for the run.

The runner handle also destructures to `{ cli, cleanup, docker, orchestrator }`. The `docker(containerId)` reader is the escape hatch for reading an **arbitrary** container by raw id (e.g. one a follow-up command referenced): it lazily runs `docker inspect` and returns the same `ContainerAccessor` type, so `await expect(docker(id)).toBeRunning()` and the sync reads work identically. Unlike `result.container(name)` it does not need `nameLabel` — it looks up by id directly; an unknown id yields `exists: false`.

## Pitfalls

- **Reaching for `.spawn()`.** It does not exist — `.exec(args, { waitFor, timeout })` is the unified execution method (rule B2).
- **Putting a `<case>.spec.yaml` under `_expected/`.** A spec document is the SCENARIO, not a golden — it lives beside the spec it belongs to. `_expected/` holds what an assertion resolves against.
- **Writing a token in a `description:` or a `command:`.** Those are prose and data; placeholders only work in the streams and the `files:` texts.
- **Quoting a stream instead of writing a block scalar.** `stdout: "a\nb\n"` is a golden no diff can show — `d4b-spec-block-scalar` rejects it and `--fix` rewrites it.
- **Asserting on raw ANSI or absolute paths in snapshots.** ANSI is stripped by default; paths and timestamps belong to `{{workdir}}`, `{{path}}`, `{{iso8601}}` tokens in `_expected/*.txt` — `transform` is a last resort (rule D6).
- **Assigning a Docker-aware result without `await using`.** Error (rule B5) — that is the leak-cleanup mechanism.
- **Re-declaring injected URLs.** `.env({ DATABASE_URL: … })` duplicates rule B6's auto-injection — override only to _change_ it, `null` to remove it.
- **Letting the chain find the real binary.** Mounting a stub fixture without pinning `PATH` (or pinning it with the developer's own `PATH` on the tail) leaves the installed `kubectl`/`gh` reachable — the spec then tests the operator's machine. Pin `PATH` and `HOME` on `$WORKDIR`.
- **Writing into fixture folders from a test.** The cwd is a copy; feature-local `_fixtures/` and the shared `specs/_fixtures/` pool are templates and stay pristine.
- **Reaching for `.project()` or `seedHandlers`.** Both are gone — one verb copies files (`.fixture(path)`, feature-local or `$FIXTURES/`), and `.seed()` is SQL-only (rule C7).
- **Forgetting the extension in `toMatch('help')`.** The extension is part of the name (rule C6) — except for tree snapshots, which are directories.

## Related

[02 — Developing](02-developing.md) · [08 — Assertions](08-assertions.md) · [09 — Tokens](09-tokens.md) · [11 — Services](11-services.md)
