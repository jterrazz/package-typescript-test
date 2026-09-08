# 14 — Website specs (`specification.website`)

`specification.website()` tests a rendered website — its raw HTTP surface (redirects, robots.txt, headers) and its rendered surface (title, head metadata, JSON-LD, console, and full user scenarios) — through a real chromium instance. It starts the site itself, or targets one already running.

Use it when the subject under test is a browser-rendered page. For a JSON/HTTP API surface use [api](05-api.md); for a binary use [cli](07-cli.md).

## Creating the runner

Exactly one of `server` (start the site locally) or `url` (target a running site) is required — passing both, or neither, throws immediately.

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
// targeting a deployed preview instead of starting one
export const { cleanup, website } = await specification.website({
    url: 'https://preview-1234.my-site.pages.dev',
});
```

### Options

| Option     | Description                                                                                                                                                                 |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server`   | `{ command, ready?, port?, timeout? }` — start the site as a child process. Exactly one of `server` / `url`                                                                 |
| `url`      | Target an already-running site (deployed, preview, dev server). Exactly one of `server` / `url`                                                                             |
| `backend`  | `{ env, port? }` — start a declared stub backend and inject its URL into the server child. Requires `server` mode — see [Declared backend](#declared-backend)               |
| `external` | `'allow' \| 'block'` — cross-origin policy for `.visit()`. Default `'block'` with `server`, `'allow'` with `url` — see [Cross-origin policy](#cross-origin-policy-external) |
| `root`     | **Project-root override** (rule A9): the cwd of the `server` command. Auto-discovered from the calling file when absent. Not a fixtures root                                |

`server` itself takes:

| `server` field | Description                                                                                        |
| -------------- | -------------------------------------------------------------------------------------------------- |
| `command`      | Shell command that starts the site. Receives the chosen port as the `PORT` env var                 |
| `ready`        | Path polled until it answers with any HTTP status — a 404 still counts as "listening". Default `/` |
| `port`         | Fixed port. Default: a free OS-assigned port, injected as `PORT`                                   |
| `timeout`      | Readiness budget in milliseconds. Default 30 000                                                   |

The chosen port is injected as `PORT` — the command reads it the same way it would in production. If the process never answers on `ready` within `timeout`, or exits first, `specification.website()` fails with the command's captured output attached. On teardown the child is terminated by process group (SIGTERM, escalating to SIGKILL after a 2 s grace) — the same escalation as the [cli](07-cli.md) exec adapter, so a framework's own child processes don't outlive the run.

The handle destructures to `{ website, cleanup, url }` (rule A3) — no `docker`, no `orchestrator`: a browser is not a container. `url` is the resolved base URL — the one the server started on, or the `url` option with its trailing slash trimmed.

## Two terminal actions: `.fetch()` and `.visit()`

### `.fetch(path)` — one raw HTTP exchange

`.fetch(path)` performs a single request and never follows redirects — the redirect itself is the result, not something to chase:

```typescript
test('surfaces a permanent redirect without following it', async () => {
    // Given - the legacy path
    const result = await website.fetch('/old');

    // Then - the 308 IS the result, with its target readable
    expect(result.status).toBe(308);
    expect(result.location).toBe('/');
});

test('serves robots.txt as plain text', async () => {
    // Given - the robots surface
    const result = await website.fetch('/robots.txt');

    // Then - the whole file matches one golden
    expect(result.headers['content-type']).toBe('text/plain');
    expect(result.body).toMatch('robots.txt');
});
```

`FetchResult` accessors:

| Member            | Type                  | Description                                                |
| ----------------- | --------------------- | ---------------------------------------------------------- |
| `result.status`   | `number`              | HTTP status — 3xx surfaces exactly as sent, never followed |
| `result.location` | `string \| undefined` | The `location` header, or undefined                        |
| `result.headers`  | flat map              | Response headers, lower-cased keys                         |
| `result.body`     | `TextAccessor`        | Raw response body — `toMatch('robots.txt')`, `.grep()`     |
| `result.json`     | `JsonAccessor`        | Response body parsed as JSON                               |

### `.visit(path, scenario?)` — a rendered page

`.visit()` renders the page in a real chromium and resolves with the captured document. There is **one browser process per runner**, launched lazily on the first `.visit()` — a spec file that only calls `.fetch()` never pays the browser-launch cost. Each visit gets a fresh, isolated browser context.

```typescript
test('captures the full head surface of a rendered page', async () => {
    // Given - the fixture homepage
    const result = await website.visit('/');

    // Then - one golden covers title, canonical, alternates, and metas
    expect(result.status).toBe(200);
    expect(result.head).toMatch('home.head.json');
});
```

## Visit scenarios — the When

A scenario is the interaction that happens **before** the capture — the visit's When. The capture always reflects the **final** page state, after the scenario ran:

```typescript
test('subscribes through the form and captures the final state', async () => {
    // Given - a visitor on the homepage
    const result = await website.visit('/', async (visitor) => {
        // When - they fill the form and subscribe
        await visitor.fill(field('Email'), 'visitor@site.test');
        await visitor.click(button('Subscribe'));
        await visitor.see(content('Thanks for subscribing'));
    });

    // Then - the capture reflects the page after the interaction
    expect(result.content).toContain('Thanks for subscribing');
    await expect(result.errors).toBeEmpty();
});
```

**No `expect()` inside a scenario (rule W1).** A scenario is pure interaction — assertions live in the Then, on the returned result. Splitting interaction from assertion keeps the setup → action → result grammar intact, and keeps scenarios replayable independent of what they're checked against.

Visitor verbs — every action auto-waits (playwright actionability); there are no sleeps anywhere in the framework:

| Verb                      | Description                                                                         |
| ------------------------- | ----------------------------------------------------------------------------------- |
| `click(element)`          | Click the element                                                                   |
| `fill(element, value)`    | Fill a form field                                                                   |
| `press(key)`              | Press a key (e.g. `'Enter'`)                                                        |
| `select(element, option)` | Select an option in a select field                                                  |
| `check(element)`          | Check a checkbox or radio                                                           |
| `hover(element)`          | Hover the element                                                                   |
| `goto(path)`              | Navigate to another path of the site under test                                     |
| `see(element)`            | **The only synchronization primitive** — retries until visible, times out otherwise |

Elements are **user-facing by construction** (rule W2) — there is no CSS/XPath surface:

| Element         | Locates by                                       |
| --------------- | ------------------------------------------------ |
| `button(name)`  | accessible name, button role                     |
| `link(name)`    | accessible name, link role                       |
| `field(label)`  | form label                                       |
| `heading(name)` | accessible name, heading role                    |
| `content(text)` | any element containing the text                  |
| `testId(id)`    | `data-testid` — the escape hatch (rule W2 warns) |

The vocabulary is shared with the mobile facet — `button`, `field`, `content`, `testId`, `within` work identically in an `.open()` scenario ([15 — Mobile specs](15-mobile.md)); the landmarks below are website-only.

## Designating exactly one element

**A descriptor must match exactly one element (rule W3).** When several match, the framework refuses the action instead of taking the first one:

```
Ambiguous element: link("Articles") matched 3 elements on http://site.test/ambiguous.

A spec must designate exactly one element. Acting on the first match would let
this test keep passing while the visitor interacts with something else.

Matched:
  1. <a href="/articles">Articles</a>  in <nav>
  2. <a href="/articles">Read Articles</a>  in <main>
  3. <a href="/articles">Articles</a>  in <footer>

Disambiguate with one of:
  • scope it       within(navigation(), link("Articles"))   [also here: contentinfo()]
  • exact name     link("Articles", { exact: true })   [leaves 2 of 3]
  • other element  a heading(), button() or field() may name one thing where this does not

Docs: docs/14-website.md#designating-exactly-one-element (CONVENTIONS W3)
```

Taking "the first match" is the failure this rule exists to prevent: the spec stays green while the visitor acts on a different element, and nothing ever reports it. Ambiguity is an authoring mistake, not something DOM order should arbitrate.

### `within(scope, target)` — the preferred fix

Search inside a landmark, the way a person would say _"the Articles link **in the nav**"_:

```typescript
await visitor.click(within(navigation(), link('Articles')));
```

Scopes compose outside-in, and any descriptor works as one — including `testId()` when a container has no landmark role to stand on:

```typescript
await visitor.click(within(main(), within(region('Series'), link('Part 2'))));
await visitor.click(within(testId('row-3'), button('Delete')));
```

The scope is checked first: if it is the ambiguous level, the refusal names **it** rather than the target, so the fix lands on the right descriptor.

The landmarks are the ARIA landmark set and nothing more — a closed vocabulary keeps `within()` from becoming a second selector language. Each takes an optional accessible name, for pages carrying several of the same region:

| Landmark               | Matches                               |
| ---------------------- | ------------------------------------- |
| `banner()`             | the page header                       |
| `navigation(name?)`    | a `<nav>` — name it when several      |
| `main()`               | the primary content                   |
| `complementary(name?)` | an `<aside>`, a sidebar               |
| `contentinfo()`        | the page footer                       |
| `region(name)`         | a `<section>` with an accessible name |
| `form(name)`           | a named form landmark                 |
| `search()`             | the search landmark                   |

### `{ exact: true }` — when two names genuinely overlap

Name matching is a **substring** by default, mirroring playwright: `link('Articles')` also matches "Read Articles". When the overlap is the whole problem, match the name whole:

```typescript
await visitor.click(link('Articles', { exact: true }));
```

Every named descriptor accepts it — `button`, `link`, `field`, `heading`, `content`, and the named landmarks.

Prefer scoping. `exact` fixes an accidental substring collision; it says nothing about _where_ on the page the element is, so it leaves a spec that still breaks the day the same label appears twice.

Navigating within a scenario changes what the capture describes:

```typescript
test('navigates to another page and captures where it landed', async () => {
    // Given - a visitor on the homepage
    const result = await website.visit('/', async (visitor) => {
        // When - they follow the articles link
        await visitor.click(link('Articles'));
    });

    // Then - the result is the destination page
    expect(result.url).toContain('/articles');
    expect(result.content).toContain('All articles');
});
```

## Result surface — `PageResult`

| Member              | Type                  | Description                                                                     |
| ------------------- | --------------------- | ------------------------------------------------------------------------------- |
| `result.status`     | `number`              | HTTP status of the main document response                                       |
| `result.url`        | `string`              | Final URL — after redirects and any scenario navigation                         |
| `result.title`      | `TextAccessor`        | `document.title`                                                                |
| `result.head`       | `JsonAccessor`        | `{ title, canonical, alternates, metas }` — the one-golden-per-page SEO surface |
| `result.jsonLd`     | `JsonAccessor`        | Every `application/ld+json` block, parsed, as one array                         |
| `result.meta(name)` | `string \| undefined` | Content of a named meta — `.meta('description')`, `.meta('og:image')`           |
| `result.canonical`  | `string \| null`      | The canonical `<link>` href, or null                                            |
| `result.alternates` | flat map              | Hreflang alternates, keyed by language code                                     |
| `result.links`      | array                 | `<link>` elements of the head, in DOM order                                     |
| `result.content`    | `TextAccessor`        | Rendered body text (`document.body.innerText`)                                  |
| `result.html`       | `TextAccessor`        | Full serialized DOM (`document.documentElement.outerHTML`)                      |
| `result.console`    | `TextAccessor`        | Every console message, one `[type] text` line per message                       |
| `result.errors`     | `TextAccessor`        | Console messages of type `error` only                                           |

## The `head` golden — one per page

`result.head` is the **stable, assertion-friendly projection** of the document head — title, canonical, hreflang alternates, and named metas collapsed into one object. It is the one golden a page needs for its SEO surface:

```typescript
test('exposes canonical, alternates, and named metas directly', async () => {
    // Given - the fixture homepage
    const result = await website.visit('/');

    // Then - the accessors read the head without a golden…
    expect(result.canonical).toBe('https://site.test/');
    expect(result.alternates['x-default']).toBe('https://site.test/');
    expect(result.meta('og:title')).toBe('Fixture — Home');

    // …or snapshot the whole surface at once
    expect(result.head).toMatch('home.head.json');
});
```

Structured data gets the same treatment — every `ld+json` block on the page, in one golden:

```typescript
test('parses every json-ld block into one array', async () => {
    const result = await website.visit('/');

    expect(result.jsonLd).toMatch('home.jsonld.json');
});
```

## Console assertions

The console splits into the full stream and the error-only stream — the same shape as `stdout`/`stderr` on a cli result:

```typescript
test('keeps a clean page silent on both streams', async () => {
    // Given - the healthy homepage
    const result = await website.visit('/');

    // Then - no console output at all
    await expect(result.console).toBeEmpty();
    await expect(result.errors).toBeEmpty();
});

test('separates console errors from the full stream', async () => {
    // Given - a page that logs and errors
    const result = await website.visit('/noisy');

    // Then - the full stream carries both, the error stream only the error
    expect(result.console).toMatch('noisy.console.txt');
    expect(result.errors).toContain('boom');
});
```

## Declared backend

A site under test usually talks to an API. The `backend` option starts a small **stub backend** (plain `node:http`, no extra dependency) BEFORE the server command and injects its URL into the server child's environment under `backend.env` — the site reads it the same way it would in production:

```typescript
// specs/website/website.specification.ts
export const { cleanup, website } = await specification.website({
    server: { command: 'npm run start', ready: '/' },
    backend: { env: 'API_URL' },
});

afterAll(cleanup);
```

| `backend` field | Description                                                                       |
| --------------- | --------------------------------------------------------------------------------- |
| `env`           | Env var receiving the stub's URL in the server child (e.g. `'API_URL'`)           |
| `port`          | Fixed port — pins a stable stub URL across runs. Default: a free OS-assigned port |

`backend` requires `server` mode — with `url` it refuses (the type already forbids the combination): a deployed site cannot be pointed at a local stub. The **ownership boundary**: the framework owns the server child, so it injects the env var itself — that is the whole wiring.

What the stub serves is declared per chain, as [contracts](10-contracts.md) — the feature's `contracts/` facade, exactly the form `api`/`jobs` use:

```typescript
import newsroom from './contracts/newsroom.contracts.js';

test('renders the events feed from the declared backend', async () => {
    // Given - the backend under contract for this chain
    const result = await website.intercept(newsroom).visit('/events');

    // Then - the page rendered what the stub declared
    expect(result.content).toContain('Enquête Fauci COVID-19');
    await expect(result.errors).toBeEmpty();
});
```

The stub **resets between chains** the way databases do: one chain = one terminal action, and its contracts replace the previous chain's wholesale. Selection is the shared one: the first declared contract that matches and is not exhausted wins, and a contract with no `times` is unlimited — so a page re-fetching the same endpoint (re-render, retry) replays it.

Strictness is the analog of `external: 'block'`: a request matching no declared contract is answered **501** (a JSON body naming the path and listing the declared routes) and **recorded** — when the `.visit()` completes, the action **throws** an error enumerating every unmatched request (method, path, count). The failure evidence (screenshot on a scenario error) is captured first, as always. A chain with **zero** intercepts leaves the stub unguarded — the same boundary as MSW never mounting without an `.intercept()`.

Two pieces of plumbing are handled for you:

- **CORS** — the stub answers the `OPTIONS` preflight and stamps permissive `Access-Control-Allow-*` headers on every response, so client-side fetches from the site's origin just work.
- **`external: 'block'`** — the stub's origin is allow-listed automatically; declared-backend fetches are never aborted as third-party noise.

## Cross-origin policy (`external`)

`external: 'block'` aborts every request leaving the site under test during a `.visit()` — analytics beacons, third-party CDNs, ad scripts never fire, so a visit stays deterministic. `'allow'` lets them through.

The default follows the mode: `'block'` with `server` (you own the deployment, third-party noise is not the point), `'allow'` with `url` (a deployed site legitimately loads third-party assets). Override with the top-level `external` option when a spec needs the opposite of its mode's default.

## Setup: `.headers()`

`.headers({...})` sets HTTP headers for both terminal actions — the raw `.fetch()` exchange and the browser context behind `.visit()`. Repeated calls merge. The main use case is a User-Agent override, e.g. asserting on what an AI crawler sees:

```typescript
test('sends chain headers on the raw exchange', async () => {
    // Given - an AI crawler user agent
    const result = await website.headers({ 'User-Agent': 'GPTBot/1.0' }).fetch('/robots.txt');

    // Then - the exchange succeeds like any other client
    expect(result.status).toBe(200);
    expect(result.body).toContain('Allow: /');
});
```

## Evidence on failure

When a scenario throws — an element never becomes visible, a `see()` times out — the error carries a full-page screenshot of the state the scenario died in, referenced by its temp path in the error message. The original error is never masked; the screenshot is attached evidence, not a replacement.

## Playwright — optional peer dependency

Playwright is not a hard dependency: `.fetch()`-only spec files never need it. `.visit()` imports it lazily, and needs it installed:

```bash
npm install -D playwright && npx playwright install chromium
```

Calling `.visit()` without playwright installed throws exactly that guidance — there is nothing else to search for.

Provisioning the environment is not this package's job. In CI, the shared validate workflow does it: `browsers: true` (jterrazz-actions) installs cached chromium, versioned from the caller's lockfile, between Build and Test. On a workstation, `j install` provisions `playwright-browsers` once.

## Folder layout

```
specs/website/
├── website.specification.ts    # runner at the facet ROOT (rule C1)
└── <domain>/
    ├── <aspect>.test.ts
    ├── _expected/                # ALL expected fixtures, FLAT (*.head.json, *.jsonld.json, *.console.txt, …)
    └── contracts/               # what the declared backend serves — with the `backend` option
        ├── newsroom.contracts.ts
        └── http/…
```

No `_seeds/` or `_requests/` — `specification.website()` has no `services` option and no request-file format; `.fetch()`/`.visit()` calls are inline, and the golden is always `_expected/<name>`.

## Pitfalls

- **Passing both `server` and `url`, or neither.** The options type makes the invalid combinations inexpressible — the compiler rejects them before anything runs.
- **Using `expect()` inside a scenario callback.** Forbidden (rule W1) — the scenario is the When; assertions belong on the result the `.visit()` promise resolves to.
- **Reaching for `testId()` as the default locator.** It exists as an escape hatch (rule W2 warns) — prefer `button`/`link`/`field`/`heading`/`content`, the same vocabulary a user's accessibility tree exposes.
- **Reaching for `testId()` to escape an ambiguity.** It silences the refusal without answering it: the test stops asserting the role and the accessible name, which is most of what a user-facing element was buying. Scope it with `within()` instead — that is the fix rule W3 is pointing at.
- **Assuming a name matches whole.** It is a substring by default: `link('Articles')` also matches "Read Articles". Pass `{ exact: true }` when that is what you meant.
- **Calling `.visit()` without playwright installed.** The error names the exact fix — `npm install -D playwright && npx playwright install chromium` — there is no silent fallback.
- **Expecting `.fetch()` to follow redirects.** It never does — the 3xx status and `location` header ARE the result; chase the target with a second `.fetch()` if the spec needs to.
- **Assuming `external` defaults the same way in both modes.** It flips with the constructor mode: `'block'` with `server`, `'allow'` with `url` — pass it explicitly to override.
- **Reading `result.head` field-by-field instead of snapshotting it.** It is designed as the one golden per page (`toMatch('home.head.json')`) — use the direct accessors (`canonical`, `alternates`, `meta()`) only for a single targeted probe.
- **Calling `.intercept()` without the `backend` option.** It throws immediately, naming the fix: add `backend: { env: '…' }` to the `specification.website()` options — a chain's `.http` exchanges need a stub to serve them.
- **Combining `backend` with `url` mode.** The type forbids it and the runtime refuses: a deployed site reads its API URL at its own deploy time — there is nothing a local stub could inject into.

## Related

[02 — Developing](02-developing.md) · [08 — Assertions](08-assertions.md) · [09 — Tokens](09-tokens.md) · [15 — Mobile specs](15-mobile.md)
