import { KNOWN_FIXTURE_MARKERS } from '../../core/specification/shared/fixtures.js';
import { memberPropertyName, stringValue } from '../ast.js';
import { RULE_DOCS } from '../manifest.js';
import type { AstNode, LintRule, RuleContext } from '../types.js';

const KNOWN = new Set<string>(KNOWN_FIXTURE_MARKERS);

/**
 * The leading literal text of a `.fixture()` argument: a plain string, or the
 * first quasi of a template literal (`` `$FIXTURES/${name}` `` → `$FIXTURES/`),
 * so a `$…` marker on an interpolated path is still validated.
 */
function leadingText(node: AstNode | undefined): string | undefined {
    const literal = stringValue(node);
    if (literal !== undefined) {
        return literal;
    }
    if (node?.type === 'TemplateLiteral') {
        const firstQuasi = (node.quasis as AstNode[] | undefined)?.[0];
        return (firstQuasi?.value as undefined | { cooked?: string })?.cooked;
    }
    return undefined;
}

/**
 * CONVENTIONS B2 — a `$…` marker in a `.fixture()` path literal must be one of
 * the known markers (`$FIXTURES`). The list is imported from the same core
 * module the runtime resolution uses, so the two channels can never drift.
 */
export const b2KnownFixtureMarker: LintRule = {
    create(context: RuleContext) {
        return {
            CallExpression(node: AstNode) {
                const callee = node.callee as AstNode | undefined;
                if (callee === undefined || memberPropertyName(callee) !== 'fixture') {
                    return;
                }
                const args = (node.arguments as AstNode[] | undefined) ?? [];
                const path = leadingText(args[0]);
                if (path === undefined || !path.startsWith('$')) {
                    return;
                }
                const marker = path.replace(/\/+$/, '').split('/')[0];
                if (!KNOWN.has(marker)) {
                    context.report({
                        data: { known: [...KNOWN_FIXTURE_MARKERS].join(', '), marker },
                        messageId: 'unknownMarker',
                        node: args[0],
                    });
                }
            },
        };
    },
    meta: {
        docs: RULE_DOCS['b2-known-fixture-marker'],
        messages: {
            unknownMarker:
                'Unknown fixture marker "{{marker}}" — known markers: {{known}}. A path without a marker is feature-local (B2 — see docs/13-linting.md).',
        },
        type: 'problem',
    },
};
