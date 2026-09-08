import { findTestCallback, isTestCallee, nodeStart } from '../ast.js';
import { RULE_DOCS } from '../manifest.js';
import type { AstNode, Comment, LintRule, RuleContext } from '../types.js';

/** Does any comment start (after leading whitespace) with `<marker> -`? */
function hasMarker(comments: Comment[], marker: string): boolean {
    const needle = `${marker} -`;
    return comments.some((comment) => comment.value.trimStart().startsWith(needle));
}

/** The source start offset of the first comment opening with `<marker> -`. */
function firstMarkerOffset(comments: Comment[], marker: string): number {
    const needle = `${marker} -`;
    let best = -1;
    for (const comment of comments) {
        if (!comment.value.trimStart().startsWith(needle)) {
            continue;
        }
        const start = nodeStart(comment);
        if (start >= 0 && (best === -1 || start < best)) {
            best = start;
        }
    }
    return best;
}

/**
 * CONVENTIONS B4 — every test carries `// Given -` and `// Then -` (always both),
 * in that order. `// When -` is optional: the spec chain is usually the "when".
 *
 * Presence is the keystone (comments are reachable via
 * `sourceCode.getCommentsInside(callback)`); the position upgrade adds the
 * unambiguous narrative ordering — Given before Then, judged on FIRST
 * occurrences for multi-`Then` bodies. (The stricter "first expect after Then"
 * variant is intentionally NOT enforced: setup-phase assertions — precondition
 * checks, update-mode writes before the Then narrative — are idiomatic here.)
 */
export const b4GivenThen: LintRule = {
    create(context: RuleContext) {
        return {
            CallExpression(node: AstNode) {
                if (!isTestCallee(node.callee as AstNode | undefined)) {
                    return;
                }
                const args = (node.arguments as AstNode[] | undefined) ?? [];
                const callback = findTestCallback(args);
                if (callback === undefined) {
                    return;
                }
                const comments = context.sourceCode.getCommentsInside(callback);
                const hasGiven = hasMarker(comments, 'Given');
                const hasThen = hasMarker(comments, 'Then');
                if (!hasGiven) {
                    context.report({ data: { marker: 'Given' }, messageId: 'missing', node });
                }
                if (!hasThen) {
                    context.report({ data: { marker: 'Then' }, messageId: 'missing', node });
                }
                if (!hasGiven || !hasThen) {
                    return;
                }
                const givenOffset = firstMarkerOffset(comments, 'Given');
                const thenOffset = firstMarkerOffset(comments, 'Then');
                // Offsets are unavailable on this oxlint build: skip the ordering pass.
                if (givenOffset < 0 || thenOffset < 0) {
                    return;
                }
                if (givenOffset > thenOffset) {
                    context.report({ messageId: 'givenAfterThen', node });
                }
            },
        };
    },
    meta: {
        docs: RULE_DOCS['b4-given-then'],
        messages: {
            givenAfterThen:
                'The `// Given -` marker comes after `// Then -` — Given describes the setup and must precede Then (B4 — see docs/13-linting.md).',
            missing:
                'Test is missing a `// {{marker}} -` comment (B4 — see docs/13-linting.md — every test needs both `// Given -` and `// Then -`).',
        },
        type: 'problem',
    },
};
