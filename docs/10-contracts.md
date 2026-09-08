# 10 — Contracts: the outside world, declared

Everything the outside world replies is declared as a **contract**: a request to match and a response to serve, together in one named artifact. There is no second form — no mock format, no fixture-path string, no `.http` intercept file. Contracts are the whole vocabulary, on all four facets that reach the network.

## The principle

> **TypeScript is behavior. `.json` is data. `.http` is a document at the boundary of YOUR OWN api** (`_requests/`, `_expected/`) — never a mock format.

A contract is behavior: it decides what matches and what is served, it can count, it can be required, it can compose. That belongs in TypeScript, where the type checker and the app's own builders are reachable. A 200-line payload is not behavior — it is data, and it goes to a sibling `.json` the contract imports. And `.http` keeps the one role it is good at: a complete, readable document of a request your api receives or a response your api returns.

## `defineContract`

```typescript
import { defineContract, http } from '@jterrazz/test';

export default defineContract({
    request: http.get('/articles/{{uuid}}'),
    response: http.json({ id: 'a-1', title: 'Fauci and the lab leak' }),
});
```

| Field       | Meaning                                                                                                                     |
| ----------- | --------------------------------------------------------------------------------------------------------------------------- |
| `request`   | What outgoing call this contract speaks for — a provider builder (`http.*`, `openai.*`, `anthropic.*`)                      |
| `response`  | The reply: a fixed value, or `(request) => ContractResponse` evaluated per served request                                   |
| `times?`    | How many times it may serve. **Omitted = unlimited** (a re-render or a retry replays it). `n` = exhausted after `n` serves. |
| `required?` | The chain FAILS unless it was actually requested — at least once, or exactly `times` times when `times` is set.             |

### Selection

One engine-agnostic queue serves every facet. An observed request matches a contract when the method matches (`'*'` accepted), the url matches, the declared query params and headers are a **subset** of the observed ones, and the `match` predicate — if any — passes on the body.

**The first contract in list order that matches AND is not exhausted wins.** That single rule covers the two shapes you need:

```typescript
import { defineContracts, http } from '@jterrazz/test';

// A retry sequence: three failures, then an unlimited tail.
export default defineContracts(
    { request: http.get('/quote'), response: http.error(500), times: 3 },
    { request: http.get('/quote'), response: http.json({ quote: 'recovered' }) },
);
```

If every matching contract is exhausted, or nothing matches at all, the spec fails (strict — see [below](#strict-by-construction-rule-d7)). A chain that declares **no** contract is not guarded at all: strictness begins with the first `.intercept()`.

### `times` and `required` — saying what you mean

`times` is how a spec asserts a **call count** without reaching for a spy: `times: 3` on a failing contract plus an unlimited success tail says "the app retries exactly three times before it succeeds". `required: true` is the other half — it turns a declaration nobody exercised into a failure:

```typescript
import { defineContract, http } from '@jterrazz/test';

// If the screen never asks for the 1M range, the spec fails — instead of
// passing green on a chart that silently rendered the default range.
export default defineContract({
    request: http.get('/indicators', { query: { range: '1M' } }),
    required: true,
    response: http.json({ points: [] }),
});
```

Without `required`, a contract nobody calls is invisible: the test passes, and the assertion it was supposed to protect never ran.

## `defineContracts` — it's contracts all the way down

A test imports **one** artifact: the world its feature lives in. `defineContracts` composes contracts, lists, and other composites into it, recursively, order preserved.

```typescript
import { defineContracts, http } from '@jterrazz/test';

const events = defineContracts({
    request: http.get('/events'),
    response: http.json({ items: [] }),
});

// A composite extends a composite — same function, all the way down.
export default defineContracts(events, {
    request: http.get('/articles/{{uuid}}'),
    response: http.json({ id: 'a-1' }),
});
```

### `.with()` — replacement by route, then prepend

`.with(...)` derives a **variant** without mutating the base. Two steps, in this order:

1. Every base contract whose **route** an override claims is removed. Same route = same `method` + the same declared url pattern (string equality of the declared path, `.source` equality for a RegExp).
2. The overrides are **prepended**, keeping their own order.

The prepend is what makes a _more specific_ override work without deleting the generic route it lives beside: `/articles/gone-1` does not claim the route `/articles/{{uuid}}`, so the generic contract survives — but the override is checked first, so the one article that is gone answers 410 while every other article still answers 200.

```typescript
import { defineContract, defineContracts, http } from '@jterrazz/test';

const newsroom = defineContracts(
    { request: http.get('/events'), response: http.json({ items: [] }) },
    { request: http.get('/articles/{{uuid}}'), response: http.json({ id: 'a-1' }) },
);

export default newsroom;

// A scenario: one article is gone, the rest of the world is unchanged.
export const withArticleGone = (id: string) =>
    newsroom.with(
        defineContract({
            request: http.get(`/articles/${id}`),
            response: http.error(410, { error: 'gone' }),
        }),
    );
```

## The facade pattern

The file layout follows the same split: a **public facade** per feature, **internal units** under it.

```
specs/<facet>/<feature>/
├── <feature>.test.ts
└── contracts/
    ├── newsroom.contracts.ts              PUBLIC — default export = the world,
    │                                      named exports = its scenarios
    ├── http/
    │   ├── events.ts                      a unit contract
    │   ├── events.response.json           the payload it serves
    │   ├── events.fr.response.json        a qualified payload — same owner
    │   └── article-gone.ts                a factory: (id) => Contract
    ├── openai/
    │   ├── classify-article.ts
    │   └── classify-article.request.ts    the exact prompt it matches
    └── anthropic/
        └── draft-reply.ts
```

The rules, enforced by [C4, C10 and C11](13-linting.md):

- The **root** holds only `*.contracts.ts` facades and the provider directories `http`, `openai`, `anthropic`. The folder carries the provider — filenames drop it and go back to being business names.
- A facade default-exports a `defineContracts(...)` composition; its **named exports are scenario factories** (`withArticleGone(id)`), so every variant of the world is named next to the world.
- A unit contract is `<provider>/<kebab-name>.ts` and default-exports `defineContract(...)` or a factory returning one. Its `request` builder must name its own folder.
- Data with real mass goes to a sibling `.response.json` (served) or `.request.ts` (matched). The stem before the FIRST dot pairs the data with its contract: `events.fr.response.json` belongs to `events.ts`. An orphan payload is an error.
- **Tests import only `*.contracts.ts`.** Provider folders are internal — reaching into one from a test is an error (C10). A scenario belongs in the facade, not in the test.
- Shared data has ONE owner: a second contract imports `./events.response.json` directly. No copies, no `shared/` folder.

A unit contract may import `@jterrazz/test`, its neighbours inside `contracts/`, **and the app's own source** — importing the app's real prompt builder is preferred over pinning its output, so a domain change surfaces as a type error or a readable diff instead of a silent "unmatched request".

```typescript
// contracts/newsroom.contracts.ts — the facade a test imports
import { defineContracts } from '@jterrazz/test';

import articleGone from './http/article-gone.js';
import events from './http/events.js';

const newsroom = defineContracts(events);

export default newsroom;

export const withArticleGone = (id: string) => newsroom.with(articleGone(id));
```

```typescript
// contracts/http/events.ts — a unit, with its payload beside it
import { defineContract, http } from '@jterrazz/test';

import payload from './events.response.json' with { type: 'json' };

export default defineContract({
    request: http.get('/events'),
    response: http.json(payload),
});
```

## Using them: `.intercept()`

Every facet that reaches the network takes the same three forms:

| Form                                | Use                                                        |
| ----------------------------------- | ---------------------------------------------------------- |
| `.intercept(contracts)`             | A composite — the normal case, one import per feature      |
| `.intercept(contract)` / `([a, b])` | A single contract or a list                                |
| `.intercept(request, response)`     | An inline pair, for one-off plumbing that deserves no name |

```typescript
import { http } from '@jterrazz/test';
import { expect, test } from 'vitest';

import { api } from '../api.specification.js';
import newsroom from './contracts/newsroom.contracts.js';

test('serves the declared world', async () => {
    // Given - a one-off inline pair alongside the feature's world
    const result = await api
        .intercept(newsroom)
        .intercept(http.any(/analytics\.example/), http.json({ ok: true }))
        .get('/report');

    // Then - the report rendered
    expect(result.status).toBe(200);
});
```

Repeated `.intercept()` calls **append**. Composition and override semantics live in `defineContracts` / `.with()`, never in call order.

## Two engines, one queue

| Facets              | Engine                                            | Notes                                                                               |
| ------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `api`, `jobs`       | **MSW**, in-process                               | Node-only: a compose-mode runner refuses `.intercept()` (rule I3)                   |
| `website`, `mobile` | the **declared stub backend** (plain `node:http`) | Started by the runner, its URL injected/exposed; CORS and `OPTIONS` handled for you |

Both consume the **same** selection queue, so a contract behaves identically on either side: first match wins, `times` exhausts, `required` verifies at chain end. The old divergence — consume-once on MSW, sticky-last on the stub — is gone; "sticky" is now just the default (`times` omitted), written down.

The stub resets between chains, the way databases do: one chain = one terminal action, and its contracts replace the previous chain's wholesale.

## Request builders

### `http.*` — any URL

```typescript
import { http } from '@jterrazz/test';

http.get('https://rates.example.com/v1/latest');
http.get('/articles/{{uuid}}'); // path form: any origin, structural segment
http.post('https://api.shoply.dev/orders', {
    body: { user: { role: 'admin' } },
    headers: { 'x-tenant': 'acme' },
    query: { lang: 'en' },
});
```

`http.get | post | put | patch | delete | any(urlOrPath, filter?)`. A **path-form** url (`'/articles/{{uuid}}'`) matches that path on **any origin** — the app's real host does not matter — and `{{token}}` segments match structurally ([09 — Tokens](09-tokens.md)).

The optional `filter` narrows beyond method + URL, and these are **filters**, so subset is the right default:

- `body`: an object is a deep **subset** match whose leaves may be `match.*` matchers; a string is a containment test; a RegExp is a `test()` over the raw text body.
- `headers` / `query`: subset match (header names case-insensitive); a string value is **exact**, a RegExp is `test()`.

### `openai.*` / `anthropic.*`

| Builder                             | Targets                                                         | Filters                                           |
| ----------------------------------- | --------------------------------------------------------------- | ------------------------------------------------- |
| `openai.chat(filter?)`              | Chat Completions API                                            | `model`, `system`, `user`, `tools`, `temperature` |
| `openai.responses(filter?, url?)`   | Responses API (AI-SDK style); `url` overrides the endpoint      | `model`, `system`, `user`, `tools`                |
| `anthropic.messages(filter?, url?)` | Messages API; `url` overrides the endpoint for a custom gateway | `model`, `system`, `user`, `tools`                |

### Matching: strings are EXACT

A string filter on a provider builder means **exact equality**. Looser matching is explicit — a RegExp, or the code-only matcher `match.includes(...)`:

```typescript
import { defineContract, match, openai } from '@jterrazz/test';

// Exact — the app's own builder produces the prompt, so it cannot drift.
const PROMPT = 'Classify the article into one of: TECH, POLITICS, SPORT.';

export default defineContract({
    request: openai.chat({ user: PROMPT }),
    response: openai.reply({ category: 'TECH' }),
});

// Looser, on purpose: per-run data makes an exact prompt impractical.
export const byPrefix = defineContract({
    request: openai.chat({ user: match.includes('Classify the article') }),
    response: openai.reply({ category: 'TECH' }),
});
```

Exactness is the default because a substring filter silently cross-matches: two prompts sharing a preamble both match the first contract, and the spec goes green on the wrong reply. `match.includes` is a code-only matcher, like `match.regex` — the `{{token}}` file vocabulary does not grow.

## Response builders

| Response                                   | Produces                                                                      |
| ------------------------------------------ | ----------------------------------------------------------------------------- |
| `http.json(body, init?)`                   | JSON response — `init: { status?, headers?, delay? }`                         |
| `http.text(body, init?)`                   | `text/plain` response                                                         |
| `http.error(status, body?)`                | HTTP error, optional JSON body                                                |
| `http.empty(status = 204)`                 | Empty response                                                                |
| `openai.reply(data)`                       | `data` wrapped in a valid Chat Completions envelope                           |
| `anthropic.reply(data)`                    | `data` (object or text) wrapped in a Messages envelope                        |
| `openai.error(status)` / `anthropic.error` | Provider HTTP error (e.g. `429` rate limit)                                   |
| `openai.timeout()` / `anthropic.timeout()` | A provider that never answers within the caller's timeout                     |
| `openai.malformed(text)`                   | HTTP 200 whose assistant content is `text` — an unparseable payload to handle |

The point: your contract states the **business payload** (`{ category: 'TECH' }`) and the builder produces the provider's full wire format around it.

### Dynamic responses

A `response` may be a function of the incoming request — `(request: MatchableRequest) => ContractResponse` — evaluated per served request:

```typescript
import { defineContract, http } from '@jterrazz/test';

export default defineContract({
    request: http.post('https://gateway.shoply.dev/v1/echo'),
    response: (request) => http.json({ received: request.body }),
});
```

The `request` handed to it is the same `MatchableRequest` the match ran on: `{ body, headers, url }`, with `body` already parsed when the payload is JSON. Prefer a fixed response whenever the reply is known ahead of time — a dynamic one is for echo endpoints, request-derived ids, and per-call variation.

## Strict by construction (rule D7)

The moment a chain declares one contract, the network is guarded: every outgoing request during the action must match a declared, non-exhausted contract. Anything else fails the spec with an explicit error that rejects the action promise (never an unhandled rejection):

```
Unmatched outgoing HTTP request during spec: POST https://api.openai.com/v1/chat/completions
Declared contracts:
  - POST https://api.openai.com/v1/chat/completions (exhausted)
Every outgoing request of a chain that declares contracts must match one — declare it, or raise `times`.
```

At chain end the same channel verifies `required` contracts: one that was declared and never requested fails the spec, naming its route.

Two scoping notes:

- **A chain with zero contracts does not guard its network** — a deliberate, documented boundary.
- **`.intercept()` is not available in compose mode** on `api`: MSW is in-process, so a compose-mode runner throws immediately. Keep contract specs in a node-only vitest project — this repo does exactly that (`api-stack` excludes `specs/api/intercepts/**`).

## Pitfalls

- **Reaching into a provider folder from a test.** `import events from './contracts/http/events.js'` is an error (C10). Add a named scenario export to the facade instead — that is what facades are for.
- **Pinning a prompt by copying it.** A 550-line prompt pasted into a contract is a fossil. Import the app's real builder, or match a stable prefix with `match.includes` — the contract pins the _interaction_, not the wording.
- **Expecting a substring to match.** Provider string filters are exact. A prompt that "should obviously match" but does not is almost always a whitespace or a template difference — use `match.includes` if that is genuinely what you mean.
- **Writing a call count as a loop.** `for (…) chain.intercept(garbage)` is `times: 8`. The loop hides the number the spec is actually asserting.
- **Relying on declaration specificity instead of order.** Selection is first-match. `.with()` prepends precisely so an override wins without deleting the generic route — outside `.with()`, order is yours to get right.
- **Letting a pipeline hit the network.** An unintercepted call is a test escaping the sandbox, not extra realism. Once one contract is declared, D7 turns a stray call into a failure.
- **Duplicating a payload.** The 45-line article exists ONCE, as a `.response.json`; the second contract imports it.

## Related

[05 — API specs](05-api.md) · [06 — Jobs specs](06-jobs.md) · [14 — Website specs](14-website.md) · [15 — Mobile specs](15-mobile.md) · [12 — Conventions](12-conventions.md)
