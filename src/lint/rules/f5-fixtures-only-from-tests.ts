import { importSourceVisitor } from '../ast.js';
import { RULE_DOCS } from '../manifest.js';
import type { LintRule, RuleContext, Visitor } from '../types.js';

const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;
const FIXTURES_IMPORT = /\.fixtures(?:\.[cm]?[jt]sx?)?$/;

/**
 * CONVENTIONS F5 — a `*.fixtures.ts` module is only importable from
 * `*.test.ts` files. Any other importer (prod code, a specification file,
 * another fixtures module) is flagged.
 */
export const f5FixturesOnlyFromTests: LintRule = {
    create(context: RuleContext) {
        if (TEST_FILE.test(context.filename)) {
            return {};
        }
        const visitor: Visitor = {
            ...importSourceVisitor(({ node, source }) => {
                if (FIXTURES_IMPORT.test(source)) {
                    context.report({ data: { source }, messageId: 'fixturesImport', node });
                }
            }),
        };
        return visitor;
    },
    meta: {
        docs: RULE_DOCS['f5-fixtures-only-from-tests'],
        messages: {
            fixturesImport:
                'A *.fixtures.ts module ("{{source}}") is only importable from *.test.ts files (F5 — see docs/13-linting.md).',
        },
        type: 'problem',
    },
};
