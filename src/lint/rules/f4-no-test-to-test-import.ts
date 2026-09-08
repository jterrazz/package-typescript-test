import { importSourceVisitor } from '../ast.js';
import { RULE_DOCS } from '../manifest.js';
import type { LintRule, RuleContext, Visitor } from '../types.js';

const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;
const TEST_IMPORT = /\.test(?:\.[cm]?[jt]sx?)?$/;

/**
 * CONVENTIONS F4 — a `*.test.ts` never imports another `*.test.ts`. Shared
 * test data belongs in a `*.fixtures.ts` neighbour (F5), shared runners in a
 * `*.specification.ts` file (A1).
 */
export const f4NoTestToTestImport: LintRule = {
    create(context: RuleContext) {
        if (!TEST_FILE.test(context.filename)) {
            return {};
        }
        const visitor: Visitor = {
            ...importSourceVisitor(({ node, source }) => {
                if (TEST_IMPORT.test(source)) {
                    context.report({ data: { source }, messageId: 'testToTest', node });
                }
            }),
        };
        return visitor;
    },
    meta: {
        docs: RULE_DOCS['f4-no-test-to-test-import'],
        messages: {
            testToTest:
                'A test file must not import another test file ("{{source}}") — share data via a *.fixtures.ts neighbour or a *.specification.ts runner (F4 — see docs/13-linting.md).',
        },
        type: 'problem',
    },
};
