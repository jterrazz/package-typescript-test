import { toKebabCase } from '../../core/specification/shared/binding.js';
import { findProperty, propertyKeyName, specificationMember, stringValue } from '../ast.js';
import { RULE_DOCS } from '../manifest.js';
import type { AstNode, LintRule, RuleContext } from '../types.js';

/**
 * CONVENTIONS A6 (warning) — `composeService:` is the escape hatch for
 * non-derivable names. When its literal equals the record key itself or the
 * key's kebab-case conversion (the two names the deterministic binding would
 * try anyway, via the same `toKebabCase` the runtime uses), it is redundant.
 */
export const a6wRedundantComposeService: LintRule = {
    create(context: RuleContext) {
        return {
            CallExpression(node: AstNode) {
                if (specificationMember(node) === undefined) {
                    return;
                }
                for (const argument of (node.arguments as AstNode[] | undefined) ?? []) {
                    const services = findProperty(argument, 'services');
                    const record = services?.value as AstNode | undefined;
                    if (record?.type !== 'ObjectExpression') {
                        continue;
                    }
                    for (const entry of (record.properties as AstNode[] | undefined) ?? []) {
                        const key = propertyKeyName(entry);
                        const factory = entry.value as AstNode | undefined;
                        if (key === undefined || factory?.type !== 'CallExpression') {
                            continue;
                        }
                        const options = (factory.arguments as AstNode[] | undefined)?.[0];
                        if (options?.type !== 'ObjectExpression') {
                            continue;
                        }
                        const composeService = findProperty(options, 'composeService');
                        const name = stringValue(composeService?.value as AstNode | undefined);
                        if (name !== undefined && (name === key || name === toKebabCase(key))) {
                            context.report({
                                data: { key, name },
                                messageId: 'redundant',
                                node: composeService ?? entry,
                            });
                        }
                    }
                }
            },
        };
    },
    meta: {
        docs: RULE_DOCS['a6w-redundant-compose-service'],
        messages: {
            redundant:
                'composeService: "{{name}}" is redundant — the key "{{key}}" already binds to it (exact name or kebab-case derivation, A6 — see docs/13-linting.md).',
        },
        type: 'suggestion',
    },
};
