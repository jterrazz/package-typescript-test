import { memberPropertyName } from '../ast.js';
import { RULE_DOCS } from '../manifest.js';
import type { AstNode, LintRule, RuleContext } from '../types.js';

/** Text-oriented matchers that tempt a raw `.text` bypass (D8). */
const TEXT_MATCHERS = new Set(['toContain', 'toMatch']);

/**
 * CONVENTIONS D8 (warning) — `.text` is the raw stream escape hatch. Asserting
 * `expect(result.text).toContain(…)` throws away the typed subject (its token
 * grammar, its `toMatch('file.txt')` fixture resolution) for a substring check.
 * Prefer asserting on the accessor subject itself.
 */
export const d8wTextBypass: LintRule = {
    create(context: RuleContext) {
        return {
            CallExpression(node: AstNode) {
                const callee = node.callee as AstNode | undefined;
                const matcher = callee === undefined ? undefined : memberPropertyName(callee);
                if (matcher === undefined || !TEXT_MATCHERS.has(matcher)) {
                    return;
                }
                const expectCall = callee?.object as AstNode | undefined;
                if (expectCall?.type !== 'CallExpression') {
                    return;
                }
                const expectCallee = expectCall.callee as AstNode | undefined;
                if (expectCallee?.type !== 'Identifier' || expectCallee.name !== 'expect') {
                    return;
                }
                const subject = (expectCall.arguments as AstNode[] | undefined)?.[0];
                if (subject !== undefined && memberPropertyName(subject) === 'text') {
                    context.report({ data: { matcher }, messageId: 'textBypass', node });
                }
            },
        };
    },
    meta: {
        docs: RULE_DOCS['d8w-text-bypass'],
        messages: {
            textBypass:
                'expect(x.text).{{matcher}}(…) asserts on the raw stream — prefer the typed accessor subject (expect(x)) so the token grammar and fixture resolution apply (D8 — see docs/13-linting.md).',
        },
        type: 'suggestion',
    },
};
