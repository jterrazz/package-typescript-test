# Dynamic values — the `{{token}}` grammar

Operative reference. Prose + the canonical accepted form of every token: [docs/09-tokens.md](../../docs/09-tokens.md).

One vocabulary, one engine — the same tokens work in `_expected/*.http` (body AND headers), `_expected/*.json`, text snapshots, tree-snapshot file contents, and in code via `match.*`. The vocabulary is frozen (shared with the runtime matcher, so the fixture and code channels cannot drift).

## The frozen vocabulary

```
uuid  ulid  iso8601  date  time  duration  number  int  float  semver
sha  hex  base64  port  ip  url  email  path  workdir  string  any
```

- In fixtures: `{{uuid}}`, `{{iso8601}}`, `{{workdir}}`, …
- In code: `match.uuid()`, `match.iso8601()`, `match.number()`, … (used inside `toMatchRows` cells and inline bodies).

## Captures (`#ref`)

`{{type#ref}}` captures on first occurrence; later occurrences of the same ref must be **equal**. Scope = one spec.

```http
Location: /orders/{{uuid#order}}

{ "id": "{{uuid#order}}", "createdAt": "{{iso8601}}" }
```

Code-side: `match.ref('order')`, `match.ref('intent', { not: 'order' })` (inequality), `match.regex(/…/)` (raw regex escape hatch). A capture ref used only once in a spec is a `d9w` warning — a ref earns its name by asserting equality across ≥ 2 occurrences.

- `{{workdir}}` = the EXACT cwd of the current spec (equality, not a pattern).

## Update mode

`TEST_UPDATE=1` (or `vitest -u`) writes **tokens, not values**: segments already covered by a placeholder are preserved, and `{{workdir}}` is substituted automatically. Generate a new golden by writing the fixture with the tokens you want, then running update.

## Rules & pitfalls

- Tokens live only in `_expected/` fixtures. A token in a `_requests/` file is a `d10w` warning — requests are inputs, never matched.
- An unknown `{{token}}` or a malformed capture (`{{uuid#}}`, `{{uuid #id}}`) in an `_expected/` fixture is a checker error (D4).
- Prefer tokens over widening with a regex or a `transform` — `transform` is an escape hatch for noise no token covers (D6).
- `toMatch` on an accessor takes a fixture NAME (with extension), never a RegExp — pass a RegExp only to `expect(x.text).toMatch(/re/)` (D14).
