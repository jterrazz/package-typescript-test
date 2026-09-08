import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

import { TOKEN_KINDS } from '../core/matching/match.js';
import { renderRules, spliceCatalog } from './catalog.js';
import { CHECKER_PASS_IDS as CHECKER_PASS_REGISTRY } from './checker.js';
import { catalog, CHECKER_PASSES, PROCESS_RULES, RULE_DOCS, RUNTIME_RULES } from './manifest.js';
import plugin, { recommendedRules, testing } from './plugin.js';

/**
 * Catalogue meta-test — the docs-as-code contract.
 *
 * `src/lint/manifest.ts` is the single source of truth for the mechanized rule
 * catalogue; `docs/12-conventions.md` is the hand-maintained constitution
 * (principles + non-mechanizable criteria) and `docs/13-linting.md` carries the
 * GENERATED catalogue. This test guards two invariants:
 *
 * - **freshness** — running the generator reproduces the committed
 *   `docs/13-linting.md` catalogue and `skills/jterrazz-test/references/rules.md`
 *   byte-for-byte;
 * - **completeness** — every shipped rule carries `meta.docs`, and every manifest
 *   entry maps to an implementation (a plugin rule / a checker pass) or a
 *   documented review-borne rule.
 *
 * Plus the standing inventory: every plugin rule has an E2E spec + fixture pair.
 */
const ROOT = resolve(import.meta.dirname, '../..');
const read = (path: string): string => readFileSync(resolve(ROOT, path), 'utf8');

const pluginRules = new Set(Object.keys(plugin.rules));

/**
 * The checker-only passes (the non-oxlint static channel, bundled in
 * dist/checker.js) — derived from the checker module's own registry (coordinator
 * decision d) so the meta-test cannot drift from the passes the CLI runs.
 */
const CHECKER_PASS_IDS = new Set<string>(CHECKER_PASS_REGISTRY);

/**
 * Specs/lint E2E files that probe the checker's CLI boundary rather than a
 * single rule/pass (exit codes, argument handling), plus the D11 kitchen-sink
 * — one project tripping every checker pass at once, asserted as a single
 * full-output golden — legitimately outside the rule↔fixture inventory below.
 */
const CLI_CONTRACT_SPECS = new Set(['checker-cli', 'kitchen-sink']);

describe('conventions catalogue — generation freshness (meta-test)', () => {
    test('the docs/10 catalogue is byte-identical to a fresh generation', () => {
        // Given - the committed docs/13-linting.md
        const committed = read('docs/13-linting.md');

        // Then - re-splicing the generated catalogue changes nothing (run `npm run docs`)
        expect(spliceCatalog(committed)).toBe(committed);
    });

    test('the generated skill rule reference is byte-identical to a fresh generation', () => {
        // Given - the committed agent-facing rule reference
        // Then - the generator reproduces it exactly (run `npm run docs`)
        expect(renderRules()).toBe(read('skills/jterrazz-test/references/rules.md'));
    });
});

describe('conventions catalogue — completeness (meta-test)', () => {
    test('every shipped plugin rule carries a statique meta.docs entry', () => {
        // Given - each shipped jterrazz/* rule
        for (const [id, rule] of Object.entries(plugin.rules)) {
            // Then - it attaches its manifest doc as meta.docs (channel statique)
            expect(rule.meta?.docs, `rule ${id} is missing meta.docs`).toBeDefined();
            expect(rule.meta?.docs).toBe(RULE_DOCS[id]);
            expect(rule.meta?.docs?.channel).toBe('statique');
        }
    });

    test('the statique docs cover exactly the shipped plugin rules', () => {
        // Given - the statique docs and the plugin map
        // Then - the two sets are identical (no orphan doc, no undocumented rule)
        expect(Object.keys(RULE_DOCS).sort()).toEqual([...pluginRules].sort());
    });

    test('every checker-channel manifest entry maps to a bundled checker pass', () => {
        // Given - the checker channel of the manifest
        // Then - each entry names a real pass run by dist/checker.js
        expect(CHECKER_PASSES.map((entry) => entry.name).sort()).toEqual(
            [...CHECKER_PASS_IDS].sort(),
        );
    });

    test('runtime and process manifest entries are documented (convention + rationale)', () => {
        // Given - the review-borne / execution-time channels
        for (const entry of [...RUNTIME_RULES, ...PROCESS_RULES]) {
            // Then - each carries non-empty normative text and a rationale (its "implementation"
            // Is the framework runtime or human review — documented here, not a lint rule)
            expect(entry.convention.length, `${entry.name} convention`).toBeGreaterThan(0);
            expect(entry.rationale.length, `${entry.name} rationale`).toBeGreaterThan(0);
        }
    });

    test('every catalogue entry has a unique implementation name', () => {
        // Given - the assembled catalogue
        // Then - no two entries share a name (each maps to a distinct implementation)
        const names = new Set<string>();
        for (const entry of catalog) {
            expect(names.has(entry.name), `duplicate catalogue entry ${entry.name}`).toBe(false);
            names.add(entry.name);
        }
    });
});

describe('testing fragment — standalone oxlint config', () => {
    test('is self-sufficient (no `extends` needed): plugin + every rule + the A4 override', () => {
        // Given - a consumer NOT using @jterrazz/typescript adopts just the conventions
        // Via `export default testing` — the fragment must be a COMPLETE oxlint config
        // Then - it registers the tool-facing plugin, enables every shipped rule, and
        // Ships the one override the A4 idiom needs — without pulling in any base preset
        expect(testing.jsPlugins).toContain('@jterrazz/test/oxlint');
        expect(testing.rules).toBe(recommendedRules);
        expect(Object.keys(testing.rules)).toEqual(
            Object.keys(plugin.rules).map((id) => `jterrazz/${id}`),
        );
        expect(testing.overrides?.[0]?.files).toContain('**/*.specification.ts');
        // A standalone config carries no `extends` — the fragment stands on its own.
        expect('extends' in testing).toBe(false);
    });
});

describe('conventions catalogue — E2E inventory (meta-test)', () => {
    // E2E specs are grouped by CONVENTIONS family (specs/lint/<group>/<id>.test.ts,
    // Their fixtures pooled in $FIXTURES) — collect the rule id from each file.
    const e2eSpecIds = new Set(
        readdirSync(resolve(ROOT, 'specs/lint'), { recursive: true })
            .map((entry) => String(entry).replaceAll('\\', '/'))
            .filter((entry) => entry.endsWith('.test.ts'))
            .map((entry) => entry.slice(entry.lastIndexOf('/') + 1, -'.test.ts'.length)),
    );

    test('every plugin rule has a specs/lint E2E spec and a fixture pair', () => {
        // Given - each shipped rule
        for (const id of pluginRules) {
            // Then - its E2E spec file and violation/compliant fixture twin exist
            expect(e2eSpecIds.has(id), `${id} has no E2E spec`).toBe(true);
            expect(existsSync(resolve(ROOT, 'specs/_fixtures/lint-violations', id))).toBe(true);
            expect(existsSync(resolve(ROOT, 'specs/_fixtures/lint-violations', `${id}-ok`))).toBe(
                true,
            );
        }
    });

    test('every specs/lint E2E spec maps to a plugin rule or a checker pass', () => {
        // Given - each E2E spec id
        for (const id of e2eSpecIds) {
            // Then - it is a shipped rule, a known checker pass, or a CLI-contract probe
            expect(
                pluginRules.has(id) || CHECKER_PASS_IDS.has(id) || CLI_CONTRACT_SPECS.has(id),
                `${id} maps to no rule, pass, or CLI-contract spec`,
            ).toBe(true);
        }
    });

    test('the E2E lint config (oxlint.e2e.json) enables exactly the shipped rule set', () => {
        // Given - the standalone oxlint config the checker E2E specs lint their
        // Violation fixtures with
        const config = JSON.parse(read('specs/_fixtures/lint-cli/oxlint.e2e.json')) as {
            rules: Record<string, unknown>;
        };

        // Then - its rule keys match recommendedRules exactly: no rule ships without
        // An E2E lint pass, and no stale rule lingers in the fixture config
        expect(Object.keys(config.rules).sort()).toEqual(Object.keys(recommendedRules).sort());
    });

    test('the docs/06 token table matches TOKEN_KINDS exactly', () => {
        // Given - the token reference table's first-column cells (`| `{{kind}}` |`)
        const documented = new Set(
            read('docs/09-tokens.md')
                .split('\n')
                .map((line) => /^\|\s*`\{\{(?<kind>[a-z0-9]+)\}\}`\s*\|/u.exec(line)?.groups?.kind)
                .filter((kind): kind is string => kind !== undefined),
        );

        // Then - identical to the frozen vocabulary
        expect([...documented].sort()).toEqual([...TOKEN_KINDS].sort());
    });
});
