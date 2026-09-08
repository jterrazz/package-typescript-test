import { TOKEN_KINDS } from '../../core/matching/match.js';
import { findProperty, memberPropertyName, specificationMember, stringValue } from '../ast.js';
import { RULE_DOCS } from '../manifest.js';
import type { AstNode, LintRule, RuleContext } from '../types.js';

const KNOWN_TOKEN_LITERAL = new RegExp(`^\\{\\{(?:${TOKEN_KINDS.join('|')})(?:#[\\w.-]+)?\\}\\}$`);

/**
 * Is this function a pure chain of `.replace(…, '{{token}}')` normalisations?
 * Accepts an arrow with an expression body or a single-return body whose
 * expression is nested `.replace()` calls; every replacement must be a string
 * literal that is exactly a known `{{token}}`.
 */
function isTokenEquivalentTransform(fn: AstNode): boolean {
    if (fn.type !== 'ArrowFunctionExpression' && fn.type !== 'FunctionExpression') {
        return false;
    }
    let expression = fn.body as AstNode | undefined;
    if (expression?.type === 'BlockStatement') {
        const statements = (expression.body as AstNode[] | undefined) ?? [];
        if (statements.length !== 1 || statements[0].type !== 'ReturnStatement') {
            return false;
        }
        expression = statements[0].argument as AstNode | undefined;
    }
    let sawReplace = false;
    while (expression?.type === 'CallExpression') {
        const callee = expression.callee as AstNode | undefined;
        if (callee === undefined || memberPropertyName(callee) !== 'replace') {
            return false;
        }
        const replacement = stringValue((expression.arguments as AstNode[] | undefined)?.[1]);
        if (replacement === undefined || !KNOWN_TOKEN_LITERAL.test(replacement)) {
            return false;
        }
        sawReplace = true;
        expression = callee.object as AstNode | undefined;
    }
    return sawReplace && expression?.type === 'Identifier';
}

/**
 * CONVENTIONS D6 (warning) — `transform` survives only as an escape hatch for
 * applicative noise the tokens do not cover (ANSI is already stripped by
 * default). A transform that only rewrites dynamic segments into known
 * `{{token}}` literals duplicates the token grammar: put the tokens in the
 * fixture instead.
 */
export const d6wTransformTokenEquivalent: LintRule = {
    create(context: RuleContext) {
        return {
            CallExpression(node: AstNode) {
                if (specificationMember(node) === undefined) {
                    return;
                }
                for (const argument of (node.arguments as AstNode[] | undefined) ?? []) {
                    const transform = findProperty(argument, 'transform');
                    const fn = transform?.value as AstNode | undefined;
                    if (fn !== undefined && isTokenEquivalentTransform(fn)) {
                        context.report({ messageId: 'tokenEquivalent', node: transform ?? node });
                    }
                }
            },
        };
    },
    meta: {
        docs: RULE_DOCS['d6w-transform-token-equivalent'],
        messages: {
            tokenEquivalent:
                'This transform only rewrites output into known token literals — write the tokens in the _expected/ fixture instead; transform is an escape hatch for uncovered noise (D6 — see docs/13-linting.md).',
        },
        type: 'suggestion',
    },
};
