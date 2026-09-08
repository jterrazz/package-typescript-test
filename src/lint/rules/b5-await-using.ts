import { chainRootName } from '../ast.js';
import { RULE_DOCS } from '../manifest.js';
import type { AstNode, LintRule, RuleContext, Visitor } from '../types.js';

type Options = { runners?: string[] };

/**
 * CONVENTIONS B5 — a docker-aware runner's result must be bound with `await
 * using` so tracked containers are disposed deterministically.
 *
 * Which runner identifiers are docker-aware is not statically derivable from a
 * test file (the `docker:` option lives in the specification file), so the
 * rule reads them from its options:
 *
 *     'jterrazz/b5-await-using': ['error', { runners: ['dockerCli'] }]
 *
 * With no configured runners the rule is inert.
 */
export const b5AwaitUsing: LintRule = {
    create(context: RuleContext): Visitor {
        const runners = new Set((context.options[0] as Options | undefined)?.runners);
        if (runners.size === 0) {
            return {};
        }
        return {
            VariableDeclaration(node: AstNode) {
                if (node.kind === 'await using') {
                    return;
                }
                for (const declarator of (node.declarations as AstNode[] | undefined) ?? []) {
                    let init = declarator.init as AstNode | undefined;
                    while (init?.type === 'AwaitExpression') {
                        init = init.argument as AstNode | undefined;
                    }
                    if (init?.type !== 'CallExpression') {
                        continue;
                    }
                    const root = chainRootName(init);
                    if (root !== undefined && runners.has(root)) {
                        context.report({
                            data: { runner: root },
                            messageId: 'requireAwaitUsing',
                            node: declarator,
                        });
                    }
                }
            },
        };
    },
    meta: {
        docs: RULE_DOCS['b5-await-using'],
        defaultOptions: [{ runners: [] }],
        messages: {
            requireAwaitUsing:
                'The result of docker-aware runner "{{runner}}" must be bound with `await using` so its containers are disposed (B5 — see docs/13-linting.md).',
        },
        schema: [
            {
                additionalProperties: false,
                properties: {
                    runners: { items: { type: 'string' }, type: 'array' },
                },
                type: 'object',
            },
        ],
        type: 'problem',
    },
};
