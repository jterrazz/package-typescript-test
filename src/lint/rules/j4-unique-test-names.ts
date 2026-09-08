import { isTestCallee, testCalleeHasModifier, testName } from '../ast.js';
import { RULE_DOCS } from '../manifest.js';
import type { AstNode, LintRule, RuleContext, Visitor } from '../types.js';

/**
 * CONVENTIONS J4 — test names are the sole description of behaviour (B3), so two
 * tests sharing a literal name in one file are a copy-paste smell: one shadows
 * the other in the reporter. Flags the second (and later) occurrence.
 *
 * `.each` / parametrized tests are skipped — their name is a template expanded
 * per row, collisions there are by construction.
 */
export const j4UniqueTestNames: LintRule = {
    create(context: RuleContext): Visitor {
        const seen = new Set<string>();
        return {
            CallExpression(node: AstNode) {
                const callee = node.callee as AstNode | undefined;
                if (!isTestCallee(callee)) {
                    return;
                }
                if (testCalleeHasModifier(callee, 'each')) {
                    return; // Parametrized — one literal name, many rows.
                }
                const name = testName(node);
                if (name === undefined) {
                    return; // Dynamic name — out of static reach.
                }
                if (seen.has(name)) {
                    context.report({ data: { name }, messageId: 'duplicate', node });
                    return;
                }
                seen.add(name);
            },
        };
    },
    meta: {
        docs: RULE_DOCS['j4-unique-test-names'],
        messages: {
            duplicate:
                'Duplicate test name "{{name}}" in this file — the test name is the sole description of behaviour, so it must be unique (J4 — see docs/13-linting.md).',
        },
        type: 'problem',
    },
};
