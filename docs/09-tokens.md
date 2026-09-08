# 09 — Tokens: dynamic values in fixtures

Real systems generate UUIDs, timestamps, ports, and paths. The framework handles them with **one unified token grammar** (rule D4): the same `{{token}}` vocabulary works in every fixture file, and the same vocabulary is available in code as `match.*`. The vocabulary is fixed — 21 tokens, defined, tested, and documented in the package — and an unknown token in a fixture is an error, not a silent literal.

## Where tokens work

| Fixture kind   | Files                                                                              | Coverage                                                                                                       |
| -------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| HTTP responses | `_expected/*.http`                                                                 | **body and headers**                                                                                           |
| JSON snapshots | `_expected/*.json`                                                                 | any string value                                                                                               |
| Text snapshots | `_expected/*.txt` (and other text files under `_expected/`)                        | anywhere in the text                                                                                           |
| Spec documents | `<case>.spec.yaml`, beside the spec ([07](07-cli.md#spec-documents--casespecyaml)) | both streams of every run, and `files:` assertions — **never the description or the command**, which are prose |

```http
### _expected/order-created.http — tokens in a header AND the body
HTTP/1.1 201 Created
Location: /orders/{{uuid#order}}

{ "id": "{{uuid#order}}", "total": "{{number}}", "createdAt": "{{iso8601}}" }
```

```
### _expected/help.txt — tokens in a TEXT snapshot
shoply v{{semver}}
Started at {{iso8601}} in {{workdir}}
Done in {{duration}}
```

Stream comparisons strip ANSI escape sequences **before** token matching (rule D6), so fixtures never contain color codes — `.text` remains the raw capture.

## The vocabulary — all 21 tokens

Every token matches one value of its family at its position. The normative definitions (the exact accepted grammar for each) are shipped and tested inside the package; the table below states each token's semantics and canonical accepted forms.

### Identifiers

| Token      | Matches                                         | Example value                          |
| ---------- | ----------------------------------------------- | -------------------------------------- |
| `{{uuid}}` | RFC 4122 UUID — `8-4-4-4-12` hexadecimal groups | `3f2c9b6e-8a41-4c8f-9d2a-1b7e5f0c4d3e` |
| `{{ulid}}` | ULID — 26 Crockford base32 characters           | `01J2X3YV5T8Q4R9K7M6N1P0ZSD`           |

### Time

| Token          | Matches                                                       | Example value                |
| -------------- | ------------------------------------------------------------- | ---------------------------- |
| `{{iso8601}}`  | Full ISO 8601 timestamp (date + time, `Z` or offset)          | `2026-07-16T10:32:05.123Z`   |
| `{{date}}`     | Calendar date, `YYYY-MM-DD`                                   | `2026-07-16`                 |
| `{{time}}`     | Wall-clock time, `HH:MM[:SS]` (seconds and fraction optional) | `10:32:05`                   |
| `{{duration}}` | Elapsed-time string as printed by tooling                     | `340ms`, `1.24s`, `2m`, `3h` |

### Numbers

| Token        | Matches                                | Example value |
| ------------ | -------------------------------------- | ------------- |
| `{{number}}` | Any numeric value (integer or decimal) | `109`, `4.5`  |
| `{{int}}`    | Integer only                           | `42`          |
| `{{float}}`  | Decimal with a fractional part         | `0.97`        |

### Versions & hashes

| Token        | Matches                                                            | Example value         |
| ------------ | ------------------------------------------------------------------ | --------------------- |
| `{{semver}}` | Semantic version (`major.minor.patch`, optional pre-release/build) | `9.0.0`, `9.1.0-rc.1` |
| `{{sha}}`    | Commit/content hash digest (hexadecimal, git-style)                | `f690adf…`            |
| `{{hex}}`    | Hexadecimal string                                                 | `deadbeef`            |
| `{{base64}}` | Base64 string (padding included)                                   | `aGVsbG8=`            |

### Network

| Token       | Matches                       | Example value                         |
| ----------- | ----------------------------- | ------------------------------------- |
| `{{port}}`  | TCP/UDP port number (0–65535) | `54321`                               |
| `{{ip}}`    | IP address                    | `127.0.0.1`                           |
| `{{url}}`   | Absolute URL with scheme      | `https://rates.example.com/v1/latest` |
| `{{email}}` | Email address                 | `contact@jterrazz.com`                |

### Paths

| Token         | Matches                                                                                                                                | Example value             |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `{{path}}`    | Filesystem path                                                                                                                        | `/tmp/x/dist/index.js`    |
| `{{workdir}}` | **The exact cwd of the current spec** — the framework knows the temp directory it created, so this is an equality check, not a pattern | `/tmp/shoply-spec-a1b2c3` |

`{{workdir}}` holds the **resolved** cwd — the spelling a child process reports, after any symlink on the way (macOS's `$TMPDIR` sits under `/var`, a link to `/private/var`). The `$WORKDIR` token that `.env()` and a document's `env:` expand is that same resolved path, so a directory the runner hands to the binary comes back in its output matching the token: `.env({ CACHE_DIR: '$WORKDIR/cache' })` is asserted as `{{workdir}}/cache`.

### Generic

| Token        | Matches                                                                                                                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `{{string}}` | Any string value                                                                                                                                                                                  |
| `{{any}}`    | Anything — always-true **as a whole value** (matches any type: object, number, `null`). Embedded in a frame (`A {{any}} Z`) it only widens the middle; the surrounding literal still has to match |

## `#ref` captures

Any token becomes a capture by suffixing `#name`: `{{uuid#order}}`. The **first occurrence captures** the actual value; every subsequent occurrence of the same ref **must be equal** (rule D4). Refs are scoped to the current spec — one namespace shared by all fixture files and code-side `match.ref()` within that spec, resetting between specs.

```http
### _expected/order-created.http — {{uuid#order}} appears 3 times → all must be equal
HTTP/1.1 201 Created
Location: /orders/{{uuid#order}}

{
    "id": "{{uuid#order}}",
    "paymentIntent": { "orderId": "{{uuid#order}}" }
}
```

A ref that re-occurs with a different value fails with both values in the message — the captured one and the conflicting one.

## `match.*` — the same vocabulary in code

Every token has a code mirror for inline assertions (table rows, primarily):

```typescript
import { match } from '@jterrazz/test';

await expect(result.table('orders', { database: 'db' })).toMatchRows({
    columns: ['id', 'status', 'total_cents', 'created_at'],
    rows: [[match.uuid(), 'pending', match.number(), match.iso8601()]],
});
```

`match.uuid()`, `match.ulid()`, `match.iso8601()`, `match.date()`, `match.time()`, `match.duration()`, `match.number()`, `match.int()`, `match.float()`, `match.semver()`, `match.sha()`, `match.hex()`, `match.base64()`, `match.port()`, `match.ip()`, `match.url()`, `match.email()`, `match.path()`, `match.workdir()`, `match.string()`, `match.any()` — plus three code-only forms:

| Code-only                         | Meaning                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------- |
| `match.regex(/…/)`                | Arbitrary pattern — the escape hatch when no token fits                                     |
| `match.ref(name)`                 | Capture on first use, require equality afterwards (same namespace as `{{token#name}}` refs) |
| `match.ref(name, { not: other })` | Additionally require **inequality** with another captured ref                               |

```typescript
// intent.order_id === orders.id, but intent.id ≠ orders.id
await expect(result.table('orders', { database: 'db' })).toMatchRows({
    columns: ['id'],
    rows: [[match.ref('order')]],
});
await expect(result.table('payment_intents', { database: 'db' })).toMatchRows({
    columns: ['id', 'order_id'],
    rows: [[match.ref('intent', { not: 'order' }), match.ref('order')]],
});
```

## Update mode: tokens are preserved

`TEST_UPDATE=1` (or `vitest -u`) rewrites fixtures from actual output — but it writes **tokens, not values** (rule D5):

- Segments already covered by a placeholder are **preserved**: a fixture line `Done in {{duration}}` stays `Done in {{duration}}` after an update, no matter what duration the run printed.
- Values the framework knows to be dynamic are substituted automatically: the spec's cwd becomes `{{workdir}}` in the written fixture without you doing anything.

Example — starting from actual output:

```
shoply v9.1.0
Started at 2026-07-17T09:12:44.031Z in /tmp/shoply-spec-x9y8z7
Done in 0.83s
```

with an existing fixture:

```
shoply v{{semver}}
Started at {{iso8601}} in {{workdir}}
Done in {{duration}}
```

`TEST_UPDATE=1` leaves the fixture byte-identical: every changed segment was already covered by a token. If the CLI adds a new line `Cache dir: /tmp/shoply-spec-x9y8z7/.cache`, the update writes `Cache dir: {{workdir}}/.cache` — `{{workdir}}` is substituted automatically; a timestamp in a _new_ line would be written literally, for you to tokenize by hand (or it will fail on the next run, which is the signal).

The same preservation and `{{workdir}}` substitution apply identically across every fixture kind — text snapshots (`_expected/*.txt`), JSON goldens (`_expected/*.json`), `.http` response bodies (`_expected/*.http`), and the streams of a `<case>.spec.yaml` (whose ground, commands and `files:` an update never rewrites). A cwd embedded in a JSON string value is written back as `{{workdir}}` exactly as it is in a text line, so an updated JSON golden matches the next run's (different) cwd instead of pinning a run-specific temp path.

This is why `transform` on `specification.cli` is only an escape hatch (rule D6): the token grammar plus ANSI stripping covers the standard sources of nondeterminism, and a transform that merely re-implements standard tokens is a future lint warning.

### Frozen fixtures — opting a negative fixture out of the rewrite

Update mode rewrites a mismatching fixture with the actual output. That is exactly wrong for a **deliberately-wrong fixture** — one whose _mismatch_ is the behaviour under test (a spec that asserts the diff, or that a missing fixture errors). Under `TEST_UPDATE=1` an unfrozen negative fixture is silently overwritten with the real output, and the assertion stops testing anything.

Pass `{ frozen: true }` as the second argument to opt a single fixture out:

```typescript
// A deliberately-wrong fixture: its diff rendering is the subject.
expect(() => expect(result.response).toMatch('wrong-body.http', { frozen: true })).toThrow(
    /Response mismatch/,
);
```

A frozen fixture is **never written** in update mode — a frozen mismatch still throws its diff, and a frozen _missing_ fixture still throws "does not exist" (never created). It is available on every fixture subject (`result.response`, `result.stdout`/`result.stderr`, `result.json`, `result.directory`, `result.filesystem`). The static rule `d13w-unfrozen-negative-fixture` flags a `toMatch` wrapped in `expect(() => …).toThrow()` / `.rejects` that omits it.

## Known limitations

The grammar is deliberately small; three edges are worth knowing:

- **No escaping for literal `{{…}}` text.** There is no escape sequence. A `{{uuid}}` written in a fixture is _always_ interpreted as the token — you cannot assert a literal, un-substituted `{{uuid}}` string in expected output. (An unknown name like `{{widget}}` is caught by the conventions checker (rule D4) as an error — the vocabulary is frozen, so an unknown token is never a usable literal escape.) For genuinely custom shapes, use `match.regex()` in code.
- **Update-merge pairs one previous line with one actual line.** Placeholder preservation is by **pattern**: the aligned line is tried first, then what is left over is re-paired by matching each remaining placeholder line against each unresolved actual line, in file order. A mid-file insertion is therefore safe — the shifted `{{duration}}` line is recognised where it landed. What stays out of reach: a previous line is spent **once**, so when the output grows a SECOND line the same placeholder could cover, the first keeps the token and the new one is written as a raw value, for you to tokenize.
- **`{{float}}` cannot require a decimal on a JSON number.** In JSON there is no distinction between `42` and `42.0`, so as a whole JSON value `{{float}}` accepts any finite number (an integer passes). The decimal requirement only holds in **text** contexts (`4.2` matches, `42` does not). This is a JSON limitation, not a token choice.

## Appendix — canonical accepted forms (normative, as implemented)

The exact grammar of each token, one tested regular expression per token
(defined in the package's match module). In embedded positions the pattern is
anchored to its surroundings; as a whole JSON value, numeric tokens also
accept native JSON numbers.

| Token          | Accepted form (regex)                                                         | Notes                                                                                    |
| -------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `{{uuid}}`     | `[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}` | any RFC 4122 variant                                                                     |
| `{{ulid}}`     | `[0-9A-HJKMNP-TV-Z]{26}`                                                      | Crockford base32, uppercase                                                              |
| `{{iso8601}}`  | `\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z\|[+-]\d{2}:\d{2})`             | date + time, `Z` or offset required                                                      |
| `{{date}}`     | `\d{4}-\d{2}-\d{2}`                                                           |                                                                                          |
| `{{time}}`     | `\d{2}:\d{2}(:\d{2}(\.\d+)?)?`                                                | seconds and fraction optional                                                            |
| `{{duration}}` | `\d+(\.\d+)?(ms\|s\|m\|h)`                                                    | strict: `ms`, `s`, `m`, `h` suffixes only                                                |
| `{{number}}`   | `-?\d+(\.\d+)?([eE][+-]?\d+)?`                                                | JSON numbers also accepted as whole values                                               |
| `{{int}}`      | `-?\d+`                                                                       | whole JSON value: `Number.isInteger`                                                     |
| `{{float}}`    | `-?\d+\.\d+`                                                                  | whole JSON value: any finite number                                                      |
| `{{semver}}`   | `\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?`                          |                                                                                          |
| `{{sha}}`      | `[0-9a-f]{7,64}`                                                              | 7–64 lowercase hex chars (short SHA → SHA-512)                                           |
| `{{hex}}`      | `[0-9a-fA-F]+`                                                                |                                                                                          |
| `{{base64}}`   | `[A-Za-z0-9+/]+={0,2}`                                                        |                                                                                          |
| `{{port}}`     | `\d{1,5}`                                                                     | range-checked to 0–65535 (embedded placeholders reject out-of-range values like `99999`) |
| `{{ip}}`       | `(\d{1,3}\.){3}\d{1,3}`                                                       | IPv4 only for now                                                                        |
| `{{url}}`      | `https?://[^\s"'<>]+`                                                         | http(s) schemes only                                                                     |
| `{{email}}`    | `[^\s@"'<>]+@[^\s@"'<>]+\.[^\s@"'<>]+`                                        |                                                                                          |
| `{{path}}`     | `\.{0,2}/[^\s"'<>]*`                                                          | absolute (`/…`) or relative (`./…`, `../…`)                                              |
| `{{workdir}}`  | — (exact string equality with the spec's cwd, realpath form)                  | never matches when the framework does not know the cwd                                   |
| `{{string}}`   | any string; embedded: `[^\n]*?` (single line)                                 |                                                                                          |
| `{{any}}`      | anything; embedded: `[\s\S]*?` (may cross lines)                              |                                                                                          |

## Pitfalls

- **Inventing a token.** The vocabulary is fixed; `{{timestamp}}` in a fixture is an error (rule D4). Use `{{iso8601}}` — or `match.regex()` in code for genuinely custom shapes.
- **Expecting `{{workdir}}` to be a pattern.** It matches the _exact_ cwd of the current spec — a path from another spec's cwd fails.
- **Assuming refs span the suite.** Ref scope is the current spec; `{{uuid#order}}` in two different tests are unrelated captures.
- **Using `{{any}}` where a precise token exists.** `{{any}}` matches garbage too; every widening of a fixture weakens the spec.
- **Reading "always-true" as unframed.** `{{any}}` is only unconditional as the _whole_ value. Embedded (`A {{any}} Z`), the frame around it must still match — and a non-string/number actual cannot satisfy an embedded token at all.
- **Hand-writing values that update mode would tokenize.** Run `TEST_UPDATE=1` first, then tighten: placeholders you wrote once are preserved forever after.
- **Escaping into `transform` for tokenizable noise.** Only application noise _not_ covered by the grammar justifies a transform (rule D6).
- **Leaving a deliberately-wrong fixture unfrozen.** A negative test whose `toMatch` asserts a mismatch (wrapped in `expect(() => …).toThrow()` / `.rejects`) must pass `{ frozen: true }` — otherwise `TEST_UPDATE=1` overwrites the wrong fixture with the real output and the assertion silently stops testing anything (rule `d13w-unfrozen-negative-fixture`).

## Related

[08 — Assertions](08-assertions.md) · [05 — API specs](05-api.md) · [07 — CLI specs](07-cli.md)
