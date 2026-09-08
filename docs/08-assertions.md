# 08 — Assertions: the reference

Every assertion goes through `expect()` (rule D1). The framework auto-registers its matchers into vitest and types them **by subject**: a table subject only offers table matchers, a stream subject only stream matchers — the wrong pairing is a compile error. Result accessors are read-only; there are no assertion methods on accessors (`result.stdout.toContain(…)` does not exist — the methods live on `expect()`).

This chapter is the exhaustive matrix: every matcher, for every valid subject, with its sync/async rule and its resolution target.

## The two global rules

### Sync vs async (rule D2)

`await expect(…)` is used **only** for matchers that perform IO:

| IO matcher subjects                         | Why                        |
| ------------------------------------------- | -------------------------- |
| `result.table(…)`                           | Runs a SQL query           |
| `result.filesystem` / `result.directory(…)` | Walks the disk             |
| container subjects                          | Talks to the Docker daemon |

Everything else is synchronous — `await`-ing it is harmless but wrong-by-convention; _not_ awaiting an IO matcher means the assertion never runs.

### `toMatch` resolution (rule D3)

`.request(file)` reads `_requests/<file>`. Everything else is expected output: `expect(...).toMatch(name)` **always** resolves against `_expected/<name>`, for every subject — `response`, `stdout`, `stderr`, `json`, `directory`, `filesystem`. There is no per-subject resolution.

`_expected/` is flat: `toMatch('help.txt')` → `_expected/help.txt`. A slash in the name creates a subfolder: `toMatch('build/verbose.txt')` → `_expected/build/verbose.txt` (rule C5). The extension is part of the name and mandatory (`'help.txt'`, never `'help'`) — except for tree snapshots, which are directories: `toMatch('shop-scaffold')` → `_expected/shop-scaffold/` (rule C6).

All file-based comparisons understand the [`{{token}}` grammar](09-tokens.md); all code-side dynamic values use `match.*`.

## Scalars — native `expect`

Plain values take vitest's native matchers. No framework matcher exists (or is needed) for them.

| Subject                             | Type           | Example                                                                                                      |
| ----------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------ |
| `result.status`                     | `number`       | `expect(result.status).toBe(201)`                                                                            |
| `result.exitCode`                   | `number`       | `expect(result.exitCode).toBe(0)`                                                                            |
| `result.filesystem.cwd`             | `string`       | `expect(result.filesystem.cwd).toContain('/tmp/')`                                                           |
| `result.response.body`              | parsed body    | `expect(result.response.body).toEqual({ error: 'User 999 not found' })`                                      |
| `result.json.value`                 | parsed JSON    | `expect(result.json.value).toMatchObject({ name: 'shoply' })`                                                |
| `result.stdout.grep(pattern)`       | `TextAccessor` | `expect(result.stdout.grep('broken.yaml')).toContain('missing price')`                                       |
| `result.file(path).exists`          | `boolean`      | `expect(result.file('dist/index.js').exists).toBe(true)`                                                     |
| `result.file(path).content`         | `string`       | `expect(result.file('shoply.yaml').content).toContain('name: my-shop')`                                      |
| `result.stdout.text`                | `string`       | `expect(result.stdout.text).toBe('')` — raw capture, never stripped                                          |
| `result.containerIds`               | `string[]`     | `expect(result.containerIds).toHaveLength(1)`                                                                |
| `await result.filesystem.files()`   | `string[]`     | `expect(await result.filesystem.files()).toContain('shoply.lock')`                                           |
| `await cli.run('<case>.spec.yaml')` | `CliResult`    | the document asserts itself; the LAST run's result comes back — [07](07-cli.md#spec-documents--casespecyaml) |

## `result.response` — HTTP response (api)

| Matcher             | Sync/async | Resolves against   | Example                                                |
| ------------------- | ---------- | ------------------ | ------------------------------------------------------ |
| `toMatch('x.http')` | sync       | `_expected/x.http` | `expect(result.response).toMatch('user-created.http')` |

Checks, in order: the status line, the listed headers (**subset** — unlisted response headers are unconstrained, rule C3), then the body. Placeholders apply in headers _and_ body, with `#ref` captures shared across both:

```http
HTTP/1.1 201 Created
Location: /orders/{{uuid#order}}

{ "id": "{{uuid#order}}" }
```

On mismatch the failure shows which part diverged. A status mismatch is a three-line message naming the fixture:

```
Response status mismatch (user-created.http)
  expected: 201
  received: 500
```

A header mismatch has the same shape (`Response header mismatch (name)`, with `header:` / `expected:` / `received:` lines; a missing header shows `received: (absent)`). A body mismatch prints a line-by-line structural diff (`Response mismatch (name)`, `- Expected` / `+ Received`) of the expected body — with matchers and tokens rendered as their placeholder text (`{{uuid#order}}`) — against the actual body. The diff is literal: it does not annotate captured ref values, and a failed `{{uuid#order}}` re-occurrence surfaces only as the two differing lines.

`.not`: `expect(result.response).not.toMatch('user-created.http')` passes when any part diverges. Rarely useful — prefer positive fixtures.

## `result.table(name, { database }?)` — database tables (api, jobs, cli)

Always `await expect(…)` (IO). `database:` is **mandatory when the services record declares ≥ 2 databases, forbidden with exactly 1** (rule A7).

| Matcher                          | Sync/async | Example                                                                |
| -------------------------------- | ---------- | ---------------------------------------------------------------------- |
| `toMatchRows({ columns, rows })` | async      | see below                                                              |
| `toBeEmpty()`                    | async      | `await expect(result.table('orders', { database: 'db' })).toBeEmpty()` |

```typescript
await expect(result.table('orders', { database: 'db' })).toMatchRows({
    columns: ['id', 'status', 'total_cents', 'created_at'],
    rows: [[match.uuid(), 'pending', match.number(), match.iso8601()]],
});
```

Cell values are literals or [`match.*`](09-tokens.md) matchers — including `match.ref(name)` to capture a generated value in one table and require equality in another, and `match.ref(name, { not: other })` to require inequality:

```typescript
await expect(result.table('orders', { database: 'db' })).toMatchRows({
    columns: ['id'],
    rows: [[match.ref('order')]],
});
await expect(result.table('payment_intents', { database: 'db' })).toMatchRows({
    columns: ['id', 'order_id'],
    rows: [[match.ref('intent', { not: 'order' }), match.ref('order')]],
});
```

A failing `toMatchRows` prints the expected grid against the actual rows for the selected columns, cell by cell — matcher cells render as their placeholder text (`Matcher.toString()`): `match.uuid()` shows as `{{uuid}}`, `match.ref('order')` as `{{ref#order}}`, `match.ref('intent', { not: 'order' })` as `{{ref#intent!order}}`, `match.regex(/…/)` as `{{regex:…}}`. A failing `toBeEmpty` reports how many rows it found (the count, not the rows themselves). `.not` inverts both (`.not.toBeEmpty()` = at least one row).

## `result.stdout` / `result.stderr` — stream subjects (cli, container `exec`)

Streams are compared **after ANSI stripping** (rule D6); the raw capture stays available as `.text`.

| Matcher               | Sync/async | Resolves against  | Example                                                           |
| --------------------- | ---------- | ----------------- | ----------------------------------------------------------------- |
| `toMatch('x.txt')`    | sync       | `_expected/x.txt` | `expect(result.stdout).toMatch('help.txt')`                       |
| `toContain('needle')` | sync       | —                 | `expect(result.stderr).toContain("Unknown command 'frobnicate'")` |

`toMatch` on a stream is a full-text snapshot; the fixture may contain any [token](09-tokens.md) (`{{semver}}`, `{{duration}}`, `{{workdir}}`, …). Token matching decides **pass or fail** only: `textEquals` resolves the placeholders to determine whether the output matches. The rendered failure, though, is a **literal** line-by-line diff (`Output mismatch (name)`, `- Expected` / `+ Received`) of the fixture text against the stripped output — tokens are not resolved in the diff, so a fixture line `Done in {{duration}}` is printed verbatim on the expected side whenever any line diverges, even if the duration itself matched.

> `toMatch` on **any accessor subject** (`result.stdout`, `result.json`, `result.response`, `result.directory`, `result.filesystem`) takes a **fixture name with its extension** (`'help.txt'`), never a regex. Passing a `RegExp` — the instinct carried over from vitest-native `toMatch` — throws immediately, naming the subject and pointing at the escape hatch: for a raw-regex assertion, reach through to the text with `expect(result.stdout.text).toMatch(/re/)`.

`toContain` failures print the needle and the (stripped) haystack in a diff-style layout so the near-miss is visible. `.not.toContain(…)` asserts absence.

```typescript
// .grep() returns a TextAccessor — chainable and snapshot-able, so the same
// Token grammar and _expected/ resolution apply as on the stream itself.
expect(result.stdout.grep('products/ok.yaml')).not.toContain('error'); // absence probe
expect(result.stdout.grep('products/broken.yaml')).toMatch('broken-block.txt'); // snapshot a block
```

## `text(value)` — any string as a stream subject

`text(value)` wraps an arbitrary string in the same `TextAccessor` streams surface, anchored on the calling test's directory via the same caller-detection the runners use. It promotes an ad-hoc string — most often a thrown **error message**, a checker line, or a report — into a first-class snapshot subject: ANSI is stripped before comparison (raw stays on `.text`), the [`{{token}}`](09-tokens.md) grammar applies to the fixture, and `.grep()` composes exactly as on a captured stream.

The product surface of a test framework **is** its error messages and reports; golden them in full instead of reconstructing them with a cluster of `toContain` probes.

| Matcher               | Sync/async | Resolves against  | Example                                            |
| --------------------- | ---------- | ----------------- | -------------------------------------------------- |
| `toMatch('x.txt')`    | sync       | `_expected/x.txt` | `expect(text(message)).toMatch('parse-error.txt')` |
| `toContain('needle')` | sync       | —                 | `expect(text(message)).toContain('did you mean')`  |

```typescript
import { text } from '@jterrazz/test';

// Capture a rejection message cleanly, then golden the whole thing.
async function catchMessage(assertion: () => unknown): Promise<string> {
    try {
        await assertion();
    } catch (error: any) {
        return error.message;
    }
    throw new Error('expected the assertion to throw, but it passed');
}

const message = await catchMessage(() => expect(result.response).toMatch('wrong-body.http'));
// Volatile fragments (paths, durations, ids) go through tokens: {{path}}, {{duration}}, {{uuid}}…
expect(text(message)).toMatch('errors/wrong-body-error.txt');
```

## `result.json` — parsed stdout (cli)

| Matcher             | Sync/async | Resolves against   | Example                                      |
| ------------------- | ---------- | ------------------ | -------------------------------------------- |
| `toMatch('x.json')` | sync       | `_expected/x.json` | `expect(result.json).toMatch('config.json')` |

Deep-equal against the JSON fixture; the fixture may embed tokens (`"id": "{{uuid}}"`). Failure prints a structural object diff (missing keys, extra keys, per-key value mismatches). For partial checks, read `.value` and use native `toMatchObject`.

## `result.file(path)` — single files in the cwd (cli)

A pure read accessor — no framework matcher; assert on its properties with native `expect`:

| Property   | Type      | Example                                                                         |
| ---------- | --------- | ------------------------------------------------------------------------------- |
| `.exists`  | `boolean` | `expect(result.file('my-shop/.env').exists).toBe(false)`                        |
| `.content` | `string`  | `expect(result.file('my-shop/shoply.yaml').content).toContain('name: my-shop')` |

## `result.directory(name)` — tree snapshots (cli)

| Matcher          | Sync/async | Resolves against               | Example                                                              |
| ---------------- | ---------- | ------------------------------ | -------------------------------------------------------------------- |
| `toMatch('dir')` | **async**  | `_expected/dir/` (a directory) | `await expect(result.directory('my-shop')).toMatch('shop-scaffold')` |

Compares the tree rooted at `<cwd>/name` against the fixture directory `_expected/shop-scaffold/` — structure _and_ file contents (contents honour tokens). Failure is a structured diff in three groups: `added` (on disk, not in fixture), `removed` (in fixture, not on disk), `changed` (content mismatch, with a per-file diff). No extension on the argument — tree snapshots are directories (rule C6).

## `result.filesystem` — the whole cwd (cli)

| Matcher / accessor | Sync/async | Resolves against | Example                                                            |
| ------------------ | ---------- | ---------------- | ------------------------------------------------------------------ |
| `toMatch('dir')`   | **async**  | `_expected/dir/` | `await expect(result.filesystem).toMatch('upgraded-shop')`         |
| `.files()`         | async read | —                | `expect(await result.filesystem.files()).toContain('shoply.lock')` |

Same semantics as `result.directory(…)`, rooted at the cwd itself. `.files()` returns the sorted recursive file list — a read, so follow it with native matchers.

## Container subjects (docker-aware cli)

Available when the runner declares `docker: { envVar, nameLabel, testRunLabel }`; results must be bound with `await using` (rule B5). `result.container(name)` looks a container up by its `nameLabel` value — lazily: no Docker call happens until you touch it. Absent containers return `exists: false` instead of throwing.

The runner handle itself also exposes a `docker(containerId)` reader (returned by `specification.api()` and `specification.cli()`, not `specification.jobs()`): given a raw container id, it lazily runs `docker inspect` and returns the **same** `ContainerAccessor` type — so it works with `await expect(spec.docker(id)).toBeRunning()` and every read accessor below. An unknown id yields an accessor with `exists: false` rather than throwing.

| Subject / matcher                                     | Sync/async | Example                                                                                           |
| ----------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------- |
| `container.exists` (read)                             | sync       | `expect(result.container('nope').exists).toBe(false)`                                             |
| `expect(container).toBeRunning()`                     | **async**  | `await expect(shop).toBeRunning()`                                                                |
| `container.file(path).content` (read)                 | sync API   | `expect(shop.file('/app/shoply.yaml').content).toContain('name: alpha')`                          |
| `container.exec(cmd)` (read)                          | async read | `const inside = await shop.exec('ls /app')` then `expect(inside.stdout).toContain('shoply.yaml')` |
| `container.stdout` / `.stderr` (logs, stream subject) | sync       | `expect(shop.stdout).toContain('shop ready')`                                                     |

`container.exec()` resolves to a result whose `stdout`/`stderr` are ordinary stream subjects — the same matchers as host streams. `.not.toBeRunning()` asserts a stopped (but existing) container; for a _removed_ container assert `exists` instead.

**The sync container-read exception (as implemented):** container property reads — `exists`, `running`, `status`, `file(path).exists`, `file(path).content`, log streams — are synchronous, backed by one-shot `docker inspect` / `docker exec` shell-outs captured lazily on first access. This is the documented exception to the "await only IO matchers" rule (D2): only the _matchers_ (`toBeRunning`) are async; property reads stay sync so container assertions read exactly like host-side ones.

## Matcher summary

| Matcher       | Valid subjects                                                                                                                                      | Sync/async                                | Fixture root |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ------------ |
| `toMatch`     | `response`, `stdout`, `stderr`, `json`, `directory(…)`, `filesystem`                                                                                | sync, except directory/filesystem (async) | `_expected/` |
| `toMatchRows` | `table(…)`                                                                                                                                          | async                                     | — (inline)   |
| `toBeEmpty`   | `table(…)`                                                                                                                                          | async                                     | —            |
| `toContain`   | `stdout`, `stderr` (host and container-exec streams), container logs                                                                                | sync                                      | —            |
| `toBeRunning` | `container(…)`                                                                                                                                      | async                                     | —            |
| native vitest | every scalar/read accessor (`status`, `exitCode`, `filesystem.cwd`, `.text`, `.value`, `.exists`, `.content`, `grep(…)`, `files()`, `containerIds`) | per vitest                                | —            |

`.not` is supported on every framework matcher.

## Update mode and frozen fixtures

`TEST_UPDATE=1` (or `vitest -u`) rewrites a mismatching `toMatch` fixture from the actual output instead of failing — token-preserving, see [09 — Tokens](09-tokens.md#update-mode-tokens-are-preserved). This is the right default for a **positive** golden, and exactly wrong for a **negative** one: a fixture that is _deliberately wrong_ (its diff is the behaviour under test) or _deliberately missing_ (its error is the behaviour under test) gets silently overwritten, and the assertion stops testing anything.

Pass `{ frozen: true }` to opt a single fixture out — it is then never written in update mode, and a frozen mismatch/missing fixture still throws:

```typescript
// The diff rendering is the subject — freeze the wrong fixture so TEST_UPDATE never rewrites it.
const message = await catchMessage(() =>
    expect(result.response).toMatch('wrong-body.http', { frozen: true }),
);
expect(text(message)).toMatch('errors/wrong-body-error.txt'); // the error golden still updates
```

`{ frozen: true }` works on every fixture subject (`response`, `stdout`, `stderr`, `json`, `directory`, `filesystem`). The rule `d13w-unfrozen-negative-fixture` flags a `toMatch` wrapped in `expect(() => …).toThrow()` / `.rejects` that omits it.

## Common mistakes

- **Calling assertion methods on accessors** — `result.stdout.toContain('x')` is a type error in v9; accessors are read-only (rule D1). Write `expect(result.stdout).toContain('x')`.
- **Missing `await` on IO matchers.** `expect(result.table('users')).toMatchRows(…)` without `await` never queries the database and the test passes vacuously (rule D2).
- **`await`-ing sync matchers.** `await expect(result.stdout).toMatch(…)` runs, but violates D2 — the sync/async split is part of the readable contract.
- **`toMatch('help')` without extension.** The extension is part of the name (rule C6). The only extensionless arguments are tree-snapshot directory names.
- **Expecting a per-subject fixture root.** Every `toMatch` subject — response, stream, JSON, or tree — resolves against `_expected/`; only `.request()` reads from `_requests/` (rule D3).
- **Asserting raw ANSI.** Streams are stripped before comparison; if you truly need the raw bytes, that is what `.text` is for (rule D6).
- **`database:` on a single-database project** (or missing on a multi-database one) — rule A7 cuts both ways.
- **Using `.not.toMatch` as a lazy negative.** It passes for _any_ divergence, including ones you did not intend. Prefer a positive fixture or a targeted `toContain`.
- **A deliberately-wrong fixture without `{ frozen: true }`.** `TEST_UPDATE=1` overwrites it with the real output, destroying the negative case. Freeze any `toMatch` whose mismatch (or missing fixture) is the behaviour under test (rule `d13w-unfrozen-negative-fixture`).

## Related

[05 — API specs](05-api.md) · [07 — CLI specs](07-cli.md) · [09 — Tokens](09-tokens.md) · [12 — Conventions](12-conventions.md)
