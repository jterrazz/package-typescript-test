import { memberPropertyName, walk } from '../ast.js';
import { RULE_DOCS } from '../manifest.js';
import type { AstNode, LintRule, RuleContext } from '../types.js';

/** The scenario-carrying terminal actions: `.visit()` (website) and `.open()` (mobile). */
const SCENARIO_ACTIONS = new Set(['open', 'visit']);

/**
 * CONVENTIONS W1 — a visit (or mobile open) scenario is the When: the
 * visitor interacts, the capture reflects the final state, and assertions
 * live in the Then on the returned result. An `expect()` inside the scenario
 * callback is flagged.
 */
export const w1ScenarioPure: LintRule = {
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
                    if (innerCallee?.type === 'Identifier' && innerCallee.name === 'expect') {
                        context.report({ messageId: 'expectInScenario', node: inner });
                    }
                });
            },
        };
    },
    meta: {
        docs: RULE_DOCS['w1-scenario-pure'],
        messages: {
            expectInScenario:
                'No expect() inside a scenario — the scenario is the When; assert the final state on the returned result in the Then (W1 — see docs/13-linting.md).',
        },
        type: 'problem',
    },
};
