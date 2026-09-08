import { memberPropertyName, propertyKeyName } from '../ast.js';
import { RULE_DOCS } from '../manifest.js';
import type { AstNode, LintRule, RuleContext } from '../types.js';

const URL_KEY = /^[A-Z0-9]+(?:_[A-Z0-9]+)*_URL$/;

/**
 * CONVENTIONS B6 (warning) — in `cli` mode with services, the framework
 * already injects `<KEY>_URL` for every service (plus the unambiguous
 * `DATABASE_URL` / `REDIS_URL` aliases). A `.env()` entry that assigns a
 * `*_URL` key from a service's `.connectionString` re-does that injection by
 * hand and is flagged as redundant.
 */
export const b6wRedundantEnvUrl: LintRule = {
    create(context: RuleContext) {
        return {
            CallExpression(node: AstNode) {
                const callee = node.callee as AstNode | undefined;
                if (callee === undefined || memberPropertyName(callee) !== 'env') {
                    return;
                }
                const argument = (node.arguments as AstNode[] | undefined)?.[0];
                if (argument?.type !== 'ObjectExpression') {
                    return;
                }
                for (const property of (argument.properties as AstNode[] | undefined) ?? []) {
                    const key = propertyKeyName(property);
                    if (key === undefined || !URL_KEY.test(key)) {
                        continue;
                    }
                    const value = property.value as AstNode | undefined;
                    if (
                        value?.type === 'MemberExpression' &&
                        memberPropertyName(value) === 'connectionString'
                    ) {
                        context.report({ data: { key }, messageId: 'redundant', node: property });
                    }
                }
            },
        };
    },
    meta: {
        docs: RULE_DOCS['b6w-redundant-env-url'],
        messages: {
            redundant:
                '.env({ {{key}}: ….connectionString }) is redundant — the framework already injects <KEY>_URL (and the DATABASE_URL/REDIS_URL aliases) for every service (B6 — see docs/13-linting.md).',
        },
        type: 'suggestion',
    },
};
