import { memberPropertyName, stringValue } from '../ast.js';
import { RULE_DOCS } from '../manifest.js';
import type { AstNode, LintRule, RuleContext } from '../types.js';

/** Stable kebab-case job identifier: `nightly-report`, `send-welcome-emails`. */
const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * CONVENTIONS B8 — a job `name` passed to `.trigger()` is a stable kebab-case
 * identifier; it is a contract between the app and its tests. Only string
 * literals are checked — dynamic names are out of static reach.
 */
export const b8KebabTrigger: LintRule = {
    create(context: RuleContext) {
        return {
            CallExpression(node: AstNode) {
                const callee = node.callee as AstNode | undefined;
                if (callee === undefined || memberPropertyName(callee) !== 'trigger') {
                    return;
                }
                const args = (node.arguments as AstNode[] | undefined) ?? [];
                const name = stringValue(args[0]);
                if (name !== undefined && !KEBAB_CASE.test(name)) {
                    context.report({ data: { name }, messageId: 'notKebab', node: args[0] });
                }
            },
        };
    },
    meta: {
        docs: RULE_DOCS['b8-kebab-trigger'],
        messages: {
            notKebab:
                'Job name "{{name}}" must be a stable kebab-case identifier (e.g. "nightly-report") — it is a contract between the app and its tests (B8 — see docs/13-linting.md).',
        },
        type: 'problem',
    },
};
