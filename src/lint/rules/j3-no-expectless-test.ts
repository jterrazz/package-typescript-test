import { findTestCallback, isTestCallee, testCalleeHasModifier, walk } from '../ast.js';
import { RULE_DOCS } from '../manifest.js';
import type { AstNode, LintRule, RuleContext } from '../types.js';

/** Does `callback` contain at least one `expect(…)` call? */
function hasExpect(callback: AstNode): boolean {
    let found = false;
    walk(callback, (node) => {
        if (found || node.type !== 'CallExpression') {
            return;
        }
        const callee = node.callee as AstNode | undefined;
        if (callee?.type === 'Identifier' && callee.name === 'expect') {
            found = true;
        }
    });
    return found;
}

/**
 * CONVENTIONS J3 — a test asserts something. A `test('…', () => { … })` whose
 * body contains no `expect(…)` is either dead or a silent no-op.
 *
 * Reuses the shared B4 test-shape helpers. `test.todo(...)` (and any other
 * callback-less form) is skipped — there is nothing to assert yet.
 */
export const j3NoExpectlessTest: LintRule = {
    create(context: RuleContext) {
        return {
            CallExpression(node: AstNode) {
                const callee = node.callee as AstNode | undefined;
                if (!isTestCallee(callee)) {
                    return;
                }
                if (testCalleeHasModifier(callee, 'todo')) {
                    return;
                }
                const args = (node.arguments as AstNode[] | undefined) ?? [];
                const callback = findTestCallback(args);
                if (callback === undefined) {
                    return; // Callback-less (todo / declaration) — nothing to assert.
                }
                if (!hasExpect(callback)) {
                    context.report({ messageId: 'noExpect', node });
                }
            },
        };
    },
    meta: {
        docs: RULE_DOCS['j3-no-expectless-test'],
        messages: {
            noExpect:
                'Test has no `expect(…)` — a test must assert something (J3 — see docs/13-linting.md). Use `test.todo` for a pending test.',
        },
        type: 'problem',
    },
};
