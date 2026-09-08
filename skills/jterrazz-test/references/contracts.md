# Contracts — the outside world, declared

Operative reference. Prose + examples: [docs/10-contracts.md](../../docs/10-contracts.md). Available on `api`, `jobs` (in-process MSW) and — with the `backend` option — `website`, `mobile` (declared stub backend). One selection queue serves all four.

**Principle: TypeScript is behavior, `.json` is data, `.http` is a document at the boundary of YOUR OWN api (`_requests/`, `_expected/`) — never a mock format.** There is no other intercept form: no `.http` intercept file, no `'adapter/file.json'` response path.

## File layout (rules C4 / C10 / C11)

```
specs/<facet>/<feature>/contracts/
├── newsroom.contracts.ts          PUBLIC facade — default export = the world,
│                                  named exports = scenario factories
├── http/
│   ├── events.ts                  unit contract (default export)
│   ├── events.response.json       served payload (stem = up to the FIRST dot)
│   ├── events.fr.response.json    same owner: events.ts
│   └── article-gone.ts            factory: (id) => Contract | Contract[]
├── openai/
│   ├── classify-article.ts
│   └── classify-article.request.ts   matched data (exact prompt)
└── anthropic/
    └── draft-reply.ts
```

- Root: only `*.contracts.ts` files and the provider dirs `http` / `openai` / `anthropic`. The FOLDER carries the provider; filenames are kebab-case business names.
- A facade default-exports a `defineContracts(...)` composition (or a composition re-export). A unit default-exports `defineContract(...)` or a factory returning one; its `request` builder must name its own folder.
- **Tests import ONLY `*.contracts.ts`** — reaching into a provider folder is an error (C10). Add a named scenario export to the facade instead.
- Every `*.response.json` / `*.request.ts` needs its sibling `<stem>.ts` owner (C11). Shared data has ONE owner — the other contract imports it.
- A unit may import `@jterrazz/test`, its neighbours inside `contracts/`, and **the app's own source** (prefer the real prompt builder over a pinned 550-line string).

## `defineContract`

```typescript
import { defineContract, http } from '@jterrazz/test';

export default defineContract({
    request: http.get('/articles/{{uuid}}'),
    required: true, // optional — fail the chain if never requested
    response: http.json({ id: 'a-1' }),
    times: 3, // optional — omitted = unlimited
});
```

| Field       | Meaning                                                                                 |
| ----------- | --------------------------------------------------------------------------------------- |
| `request`   | `http.*` / `openai.*` / `anthropic.*` builder                                           |
| `response`  | Fixed value, or `(request: MatchableRequest) => ContractResponse` (evaluated per serve) |
| `times?`    | Serves at most `n` times. **Omitted = unlimited** (retries, re-renders replay it)       |
| `required?` | Chain FAILS unless requested ≥ 1 time — exactly `times` times when `times` is set       |

## `defineContracts` + `.with()`

```typescript
import { defineContract, defineContracts, http } from '@jterrazz/test';

// Contracts, lists, and other composites — flattened recursively, order kept.
const newsroom = defineContracts(events, articleById);

export default newsroom;

export const withArticleGone = (id: string) =>
    newsroom.with(
        defineContract({ request: http.get(`/articles/${id}`), response: http.error(410) }),
    );
```

`.with(...)` is **replacement-by-route, then prepend**, immutably:

1. Remove from the base every contract whose route an override claims (same `method` + identical declared url source; `.source` for a RegExp).
2. PREPEND the overrides, keeping their order.

The prepend is why a more specific override (`/articles/gone-1`) wins over a generic route (`/articles/{{uuid}}`) it does not replace.

## Registering

| Form                                | Notes                                                |
| ----------------------------------- | ---------------------------------------------------- |
| `.intercept(contracts)`             | A `defineContracts(...)` composite — the normal case |
| `.intercept(contract)` / `([a, b])` | One contract, or an ordered list                     |
| `.intercept(request, response)`     | Inline pair for one-off plumbing                     |

Repeated `.intercept()` calls **append**. Composition/override semantics live in `defineContracts` / `.with()`, never in call order.

## Selection

**The first contract in list order that matches AND is not exhausted wins.** A request matches on: method (`'*'` ok), url (absolute string/RegExp, or path-form `'/a/{{uuid}}'` matching any origin), declared query + headers as a SUBSET of observed, and the `match` predicate on the body.

A sequence is ordered finite contracts before an unlimited tail: `[{ …, times: 3 }, { … }]`.

## Builders

| Helper                                                                      | Kind     | Notes                                                                        |
| --------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------- |
| `openai.chat(filter?)`                                                      | request  | Chat Completions; filter: `model`, `system`, `user`, `tools`, `temperature`  |
| `openai.responses(filter?, url?)`                                           | request  | Responses API; filter: `model`, `system`, `user`, `tools` (NO `temperature`) |
| `anthropic.messages(filter?, url?)`                                         | request  | Messages API; `url` overrides the endpoint for a gateway                     |
| `http.get/post/put/patch/delete/any(url, filter?)`                          | request  | Any URL or path-form; filter `{ body?, headers?, query? }`                   |
| `openai.reply(data)` / `.error(status)` / `.timeout()` / `.malformed(text)` | response | Envelope / failures                                                          |
| `anthropic.reply(data)` / `.error(status)` / `.timeout()`                   | response | Envelope / failures                                                          |
| `http.json(body, init?)` / `.text(body, init?)`                             | response | `init: { status?, headers?, delay? }`                                        |
| `http.error(status, body?)` / `.empty(status = 204)`                        | response | Failures / no content                                                        |

No `claude` alias — use `anthropic`. `msw` ships as a direct dependency (no separate install).

## Matching: strings are EXACT

A string filter on `openai.*` / `anthropic.*` means **exact equality** — a substring filter silently cross-matches. Looser matching is explicit: a `RegExp`, or `match.includes('substring')` (a code-only matcher — it never joins the `{{token}}` file vocabulary).

`http` filters are filters, so subset is the default: `body` object = deep subset (leaves may be `match.*`), `body` string = containment, `body` RegExp = `test()`; header/query string values stay exact.

## Strict by construction (D7)

Once a chain declares ONE contract, every outgoing request must match a declared, non-exhausted contract. An unmatched or exhausted request FAILS the spec:

```
Unmatched outgoing HTTP request during spec: <METHOD> <url>
```

At chain end, every `required` contract that was never requested fails too, naming its route. A chain with **zero** contracts is not guarded (assumed perimeter).

## Node-only on api (I3)

`api`/`jobs` contracts run through in-process MSW. A compose-mode `specification.api()` runner throws immediately (`intercepts are in-process (MSW) and not available in compose mode`). Keep contract specs in a node-only vitest project (this repo's `api-stack` project excludes `specs/api/intercepts/**`). `specification.jobs()` is always node.
