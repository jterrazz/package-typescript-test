import { importSourceVisitor, isUnderSpecs } from '../ast.js';
import { RULE_DOCS } from '../manifest.js';
import type { LintRule, RuleContext, Visitor } from '../types.js';

const TEST_FILE = /\.(?:test|fixtures|specification)\.[cm]?[jt]sx?$/;
const CONFIG_FILE = /(?:^|[/\\])[\w.-]*\.config\.[cm]?[jt]s$/;
const TEST_IMPORT = /\.(?:test|fixtures)(?:\.[cm]?[jt]sx?)?$/;
const TOOL_SUBPATH = '@jterrazz/test/oxlint';

/**
 * CONVENTIONS F2 — production code never imports a test artefact. In a
 * non-test file (not `*.test.ts` / `*.fixtures.ts` / `*.specification.ts`,
 * not under `specs/`, not a tool config), importing `vitest`,
 * `@jterrazz/test`, a `*.test.*` module or a `*.fixtures.*` module is flagged.
 *
 * Sanctioned exception: `@jterrazz/test/oxlint`, the tool-facing, zero-runtime
 * lint entry (F1) — a shared oxlint preset legitimately imports it from prod
 * code.
 *
 * This repo's `src/vitest/` layer (the framework's own runner coupling, I1)
 * disables the rule via a config override.
 */
export const f2NoTestImportsInProd: LintRule = {
    create(context: RuleContext) {
        const file = context.filename;
        if (TEST_FILE.test(file) || CONFIG_FILE.test(file) || isUnderSpecs(file)) {
            return {};
        }
        const visitor: Visitor = {
            ...importSourceVisitor(({ node, source }) => {
                if (source === TOOL_SUBPATH) {
                    return;
                }
                if (source === 'vitest' || source.startsWith('vitest/')) {
                    context.report({ data: { source }, messageId: 'testImport', node });
                } else if (source === '@jterrazz/test' || source.startsWith('@jterrazz/test/')) {
                    context.report({ data: { source }, messageId: 'testImport', node });
                } else if (TEST_IMPORT.test(source)) {
                    context.report({ data: { source }, messageId: 'testImport', node });
                }
            }),
        };
        return visitor;
    },
    meta: {
        docs: RULE_DOCS['f2-no-test-imports-in-prod'],
        messages: {
            testImport:
                'Production code must not import the test artefact "{{source}}" — test imports are only legal from specs/, *.test.ts, *.fixtures.ts or *.specification.ts (F2 — see docs/13-linting.md).',
        },
        type: 'problem',
    },
};
