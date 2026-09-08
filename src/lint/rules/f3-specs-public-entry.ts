import { importSourceVisitor, specsAnchor } from '../ast.js';
import { RULE_DOCS } from '../manifest.js';
import type { LintRule, RuleContext, Visitor } from '../types.js';

const PACKAGE = '@jterrazz/test';
const TOOL_SUBPATH = '@jterrazz/test/oxlint';

/**
 * The framework's own top-level `src/` layers. Deep-importing any of these from
 * a spec couples the spec to internals the public entry exists to hide. These
 * segment names are only meaningful inside the framework repo itself — a
 * consumer app that happens to have `src/app.ts` never reaches one, so its own
 * spec-to-app imports stay allowed (that IS the documented pattern:
 * `server: () => createApp()` importing `../../src/app.js`).
 */
const FRAMEWORK_LAYERS = new Set(['core', 'integrations', 'lint', 'vitest']);

/**
 * CONVENTIONS F3 — from `specs/`, deep-importing the FRAMEWORK's internals is
 * forbidden: a relative path resolving inside the framework repo's
 * `src/{core,integrations,vitest,lint}/`, or any `@jterrazz/test/<subpath>`
 * other than the sanctioned tool-facing `@jterrazz/test/oxlint`. A consumer's
 * imports of its OWN app source are always allowed — that is the pattern.
 *
 * Distinct from F1 (which bans `@jterrazz/test/<subpath>` from any file): F3 is
 * the specs-specific guard that also reaches relative framework-internal paths.
 * Documented exception: specs under `specs/integrations/` may deep-import the
 * integration module they cover (`src/integrations/**`).
 */
export const f3SpecsPublicEntry: LintRule = {
    create(context: RuleContext) {
        const anchor = specsAnchor(context.filename);
        if (anchor === undefined) {
            return {};
        }
        const underIntegrations = anchor.relative[0] === 'integrations';
        const visitor: Visitor = {
            ...importSourceVisitor(({ node, source }) => {
                // Framework subpath imports (overlaps F1, kept specs-specific).
                if (source.startsWith(`${PACKAGE}/`)) {
                    if (source === TOOL_SUBPATH) {
                        return; // The sanctioned tool-facing entry.
                    }
                    context.report({ data: { source }, messageId: 'deepImport', node });
                    return;
                }
                // Relative imports that resolve inside a `src/` tree.
                const marker = source.indexOf('/src/');
                if (marker === -1 && !source.startsWith('src/')) {
                    return;
                }
                const internal = marker === -1 ? source.slice(4) : source.slice(marker + 5);
                const layer = internal.split('/')[0];
                if (!FRAMEWORK_LAYERS.has(layer)) {
                    return; // Consumer's own app source (e.g. src/app.js) — the pattern.
                }
                if (underIntegrations && layer === 'integrations') {
                    return; // Sanctioned: integration specs cover internal adapters.
                }
                context.report({ data: { source }, messageId: 'deepImport', node });
            }),
        };
        return visitor;
    },
    meta: {
        docs: RULE_DOCS['f3-specs-public-entry'],
        messages: {
            deepImport:
                'specs/ must not deep-import framework internals — reach the framework via its public entry (@jterrazz/test, or src/index.js in this repo), not "{{source}}" (F3 — see docs/13-linting.md; only @jterrazz/test/oxlint, and src/integrations/** from specs/integrations/, are exempt).',
        },
        type: 'problem',
    },
};
