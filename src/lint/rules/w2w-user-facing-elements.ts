import { memberPropertyName, walk } from '../ast.js';
import { RULE_DOCS } from '../manifest.js';
import type { AstNode, LintRule, RuleContext } from '../types.js';

/** The scenario-carrying terminal actions: `.visit()` (website) and `.open()` (mobile). */
const SCENARIO_ACTIONS = new Set(['open', 'visit']);

/**
 * CONVENTIONS W2 — elements are user-facing (`button`, `link`, `field`,
 * `heading`, `content`); `testId()` is the escape hatch and gets a warning
 * where it appears inside a visit or mobile open scenario.
 */
export const w2wUserFacingElements: LintRule = {
    create(context: RuleContext) {
        return {
            CallExpression(node: AstNode) {
                const callee = node.callee as AstNode | undefined;
                const member = callee ? memberPropertyName(callee) : undefined;
                if (member === undefined || !SCENARIO_ACTIONS.has(member)) {
                    return;
                }
                const args = node.arguments as AstNode[] | undefined;
                const scenario = args?.[1];
                if (
                    scenario?.type !== 'ArrowFunctionExpression' &&
                    scenario?.type !== 'FunctionExpression'
                ) {
                    return;
                }
                walk(scenario, (inner: AstNode) => {
                    if (inner.type !== 'CallExpression') {
                        return;
                    }
                    const innerCallee = inner.callee as AstNode | undefined;
                    if (innerCallee?.type === 'Identifier' && innerCallee.name === 'testId') {
                        context.report({ messageId: 'testIdElement', node: inner });
                    }
                });
            },
        };
    },
    meta: {
        docs: RULE_DOCS['w2w-user-facing-elements'],
        messages: {
            testIdElement:
                'Prefer a user-facing element (button, link, field, heading, content) over testId() — the escape hatch hides what the user actually sees (W2 — see docs/13-linting.md).',
        },
        type: 'suggestion',
    },
};
