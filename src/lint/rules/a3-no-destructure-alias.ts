import { propertyKeyName, specificationMember } from '../ast.js';
import { RULE_DOCS } from '../manifest.js';
import type { AstNode, LintRule, RuleContext } from '../types.js';

/** Unwrap `await <expr>` down to the call expression, if that is what it is. */
function unwrapAwaitedCall(node: AstNode | undefined): AstNode | undefined {
    let current = node;
    while (current?.type === 'AwaitExpression') {
        current = current.argument as AstNode | undefined;
    }
    return current?.type === 'CallExpression' ? current : undefined;
}

/**
 * CONVENTIONS A3 — the constructor's return is destructured with the canonical
 * names, no aliasing: `const { api, cleanup, docker } = await
 * specification.api(…)`. A renamed binding (`{ api: myApi }`) is flagged.
 *
 * Renaming at the IMPORT site (`import { cli as dockerCli } from …`) stays
 * legal — the canonical name is enforced where the record is destructured.
 */
export const a3NoDestructureAlias: LintRule = {
    create(context: RuleContext) {
        return {
            VariableDeclarator(node: AstNode) {
                const call = unwrapAwaitedCall(node.init as AstNode | undefined);
                if (call === undefined || specificationMember(call) === undefined) {
                    return;
                }
                const id = node.id as AstNode | undefined;
                if (id?.type !== 'ObjectPattern') {
                    return;
                }
                for (const property of (id.properties as AstNode[] | undefined) ?? []) {
                    const key = propertyKeyName(property);
                    if (key === undefined) {
                        continue;
                    }
                    let value = property.value as AstNode | undefined;
                    if (value?.type === 'AssignmentPattern') {
                        value = value.left as AstNode | undefined;
                    }
                    if (value?.type === 'Identifier' && value.name !== key) {
                        context.report({
                            data: { alias: value.name as string, key },
                            messageId: 'aliased',
                            node: property,
                        });
                    }
                }
            },
        };
    },
    meta: {
        docs: RULE_DOCS['a3-no-destructure-alias'],
        messages: {
            aliased:
                'Destructure the specification result with its canonical name: `{{key}}`, not `{{key}}: {{alias}}` (A3 — see docs/13-linting.md). Rename at the import site if a different local name is needed.',
        },
        type: 'problem',
    },
};
