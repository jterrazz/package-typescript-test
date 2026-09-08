import { findProperty, specificationMember } from '../ast.js';
import { RULE_DOCS } from '../manifest.js';
import type { AstNode, LintRule, RuleContext } from '../types.js';

/**
 * CONVENTIONS A5 — `mode` is never hardcoded in a specification file: the
 * node/compose switch lives in `vitest.config.ts` (`env: { TEST_MODE:
 * 'compose' }`). The one sanctioned use is a non-Node app (no `server`), where
 * `mode: 'compose'` is mandatory and permanent — so the rule flags a `mode`
 * property ONLY when `server` is also defined in the same options object.
 */
export const a5ModeWithServer: LintRule = {
    create(context: RuleContext) {
        return {
            CallExpression(node: AstNode) {
                if (specificationMember(node) !== 'api') {
                    return;
                }
                for (const argument of (node.arguments as AstNode[] | undefined) ?? []) {
                    if (argument.type !== 'ObjectExpression') {
                        continue;
                    }
                    const mode = findProperty(argument, 'mode');
                    const server = findProperty(argument, 'server');
                    if (mode !== undefined && server !== undefined) {
                        context.report({ messageId: 'hardcodedMode', node: mode });
                    }
                }
            },
        };
    },
    meta: {
        docs: RULE_DOCS['a5-mode-with-server'],
        messages: {
            hardcodedMode:
                '`mode` must not be hardcoded when `server` is defined — the node/compose switch lives in vitest.config.ts via `env: { TEST_MODE: "compose" }` (A5 — see docs/13-linting.md).',
        },
        type: 'problem',
    },
};
