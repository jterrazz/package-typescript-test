# Mobile specs — `specification.mobile()`

Operative reference. Prose + examples: [docs/15-mobile.md](../../docs/15-mobile.md). Assertions: [docs/08-assertions.md](../../docs/08-assertions.md). Tokens: [references/tokens.md](tokens.md).

Tests a native app on the iOS simulator — deep-linked screens and tap/fill/see flows through a real XCUITest session (appium). No services, no seeding, no `mode` — this facet is about a device, not a database.

## Runner (in `*.specification.ts`, `afterAll(cleanup)`)

```typescript
export const { mobile, cleanup } = await specification.mobile({
    app: { bundleId: 'com.jterrazz.fakenews' },
    device: { name: 'iPhone 17', os: '26.5' },
});
afterAll(cleanup);
```

Returns `{ mobile, cleanup, udid }` — no `docker`, no `orchestrator`. Checklist:

- `app: { bundleId }` — the installed app; `.open()` launches by bundle id, it does not build or install.
- `device: { name, os?, udid? }` — resolved via `xcrun simctl` and booted when shut down. Zero or several matches refuse with the device listing; narrow with `os:` or pin `udid:`.
- `root` — where `node_modules/.bin/appium` is resolved from (A9 override); auto-discovered when absent.
- `timeouts: { action?, launch? }` in ms — the verb poll budget (default `30_000`) and the WebDriverAgent launch budget (default `240_000`). A DEV bundle whose cold boot outlasts 30 s declares `{ action: 45_000 }` here instead of sleeping in a scenario.
- The appium server is spawned on a free port, polled on `/status`; teardown kills its process group (SIGTERM → SIGKILL, same escalation as the website serve adapter).

## One terminal action

| Method                        | Resolves to    | Notes                                                                                             |
| ----------------------------- | -------------- | ------------------------------------------------------------------------------------------------- |
| `.open(deepLink?, scenario?)` | `ScreenResult` | TERMINATES + relaunches the app (fresh state), applies the deep link, runs the scenario, captures |

One driver session per runner, created **lazily** on the first `.open()` and reused — WebDriverAgent startup is the expensive part, not the relaunch. Every open starts from a deterministic fresh app state; a flow that spans screens belongs in ONE scenario.

## Scenarios — the When (`MobileScenario`)

```typescript
const result = await mobile.open('news://events', async (visitor) => {
    await visitor.tap(button('Enquête Fauci COVID-19'));
    await visitor.see(content('rapports'));
    await visitor.tap(button('Bookmark'));
});
```

- **No `expect()` inside a scenario (W1).** The scenario is pure interaction; assertions live in the Then, on the returned result.
- Visitor verbs: `tap`, `fill`, `see(element)`. Every verb polls until ≥ 1 visible match (default 30 s, raise with `timeouts: { action }`) then enforces exactly-one (W3); `see()` is the ONLY synchronization primitive. There are no sleeps.
- Elements are the **same vocabulary as the website facet** (W2): `button(name)`, `field(label)`, `content(text)`; `testId(id)` is the escape hatch and warns. Substring match by default; `{ exact: true }` matches whole.
- **Landmarks are website-only** — `main()`/`navigation()` on a mobile verb refuse at runtime. A mobile scope is any descriptor: `within(testId('event-list'), button('Bookmark'))`; every scope level must itself be unambiguous.

## Result surface

`ScreenResult`: `screen` (`JsonAccessor` — the projected accessibility tree, the one-golden-per-screen surface), `content` (`TextAccessor` — visible texts, one per line, reading order).

```typescript
expect(result.screen).toMatch('events.screen.json'); // one golden for the whole screen
expect(result.content).toContain('Bookmarked'); // the scalpel
```

The projection collapses XCUITest noise: unlabeled/identifier-less/valueless wrappers dropped (children hoisted), self-repeating elements deduped, `XCUIElementType` prefixes stripped, label-echoing values/identifiers omitted. The tree carries the whole mounted hierarchy (incl. below the fold); `content` only what is visible.

On a scenario failure the error carries a screenshot path; a timeout adds a compact excerpt of the labels currently on screen. The original error is never masked.

## Appium — optional peer dependencies

```bash
npm install -D appium webdriverio && npx appium driver install xcuitest
```

`specification.mobile()` without them throws exactly that guidance. First session per simulator builds WebDriverAgent (~40 s, once); warm sessions are seconds.

## Folder layout

```
specs/mobile/
├── mobile.specification.ts     # runner at the facet ROOT
└── <domain>/
    ├── <aspect>.test.ts
    ├── _expected/                # *.screen.json, … — FLAT
    └── contracts/               # what the declared `backend` stub serves — see contracts.md
```

No `_seeds/` or `_requests/` — no services, no request-file format.
