import { toKebabCase } from '../../core/specification/shared/binding.js';
import { findProperty, propertyKeyName, specificationMember, stringValue } from '../ast.js';
import { RULE_DOCS } from '../manifest.js';
import type { AstNode, LintRule, RuleContext } from '../types.js';

/** The compose service an entry binds to: explicit `composeService`, else the key's kebab form. */
function canonicalBinding(entry: AstNode, key: string): string {
    const factory = entry.value as AstNode | undefined;
    if (factory?.type === 'CallExpression') {
        const options = (factory.arguments as AstNode[] | undefined)?.[0];
        if (options?.type === 'ObjectExpression') {
            const explicit = stringValue(
                findProperty(options, 'composeService')?.value as AstNode | undefined,
            );
            if (explicit !== undefined) {
                return explicit;
            }
        }
    }
    return toKebabCase(key);
}

/**
 * CONVENTIONS A10 — within one `services` record, two keys that derive (or
 * pin via `composeService`) the SAME compose service name are a silent
 * collision: the record is a map, and the second binding would shadow the
 * first. Detected on the same kebab derivation the runtime binding uses
 * (`analyticsDb` and `analytics-db` both → `analytics-db`), and across explicit
 * `composeService` values.
 */
export const a10DuplicateBinding: LintRule = {
    create(context: RuleContext) {
        return {
            CallExpression(node: AstNode) {
                if (specificationMember(node) === undefined) {
                    return;
                }
                for (const argument of (node.arguments as AstNode[] | undefined) ?? []) {
                    const record = findProperty(argument, 'services')?.value as AstNode | undefined;
                    if (record?.type !== 'ObjectExpression') {
                        continue;
                    }
                    const seen = new Map<string, string>();
                    for (const entry of (record.properties as AstNode[] | undefined) ?? []) {
                        const key = propertyKeyName(entry);
                        if (key === undefined) {
                            continue;
                        }
                        const binding = canonicalBinding(entry, key);
                        const first = seen.get(binding);
                        if (first !== undefined) {
                            context.report({
                                data: { binding, first, key },
                                messageId: 'duplicate',
                                node: entry,
                            });
                            continue;
                        }
                        seen.set(binding, key);
                    }
                }
            },
        };
    },
    meta: {
        docs: RULE_DOCS['a10-duplicate-binding'],
        messages: {
            duplicate:
                'Service keys "{{first}}" and "{{key}}" both bind to compose service "{{binding}}" — one shadows the other; rename a key or set distinct composeService values (A10 — see docs/13-linting.md).',
        },
        type: 'problem',
    },
};
