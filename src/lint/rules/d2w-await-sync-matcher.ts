import { memberPropertyName } from '../ast.js';
import { RULE_DOCS } from '../manifest.js';
import type { AstNode, LintRule, RuleContext } from '../types.js';

/** Always-synchronous matchers — awaiting them is redundant noise (D2). */
const SYNC_MATCHERS = new Set(['toBe', 'toContain', 'toEqual', 'toHaveLength']);

/**
 * Does the member-call spine root at an `expect(…)` call, WITHOUT a `.resolves`
 * / `.rejects` modifier? Those modifiers make an otherwise-sync matcher async,
 * so `await expect(p).resolves.toEqual(…)` is NOT a redundant await.
 */
function rootsAtSyncExpect(node: AstNode | undefined): boolean {
    let current = node;
    while (current !== undefined) {
        if (current.type === 'CallExpression') {
            const callee = current.callee as AstNode | undefined;
            if (callee?.type === 'Identifier' && callee.name === 'expect') {
                return true;
            }
            current = callee;
        } else if (current.type === 'MemberExpression') {
            const property = memberPropertyName(current);
            if (property === 'resolves' || property === 'rejects') {
                return false;
            }
            current = current.object as AstNode | undefined;
        } else {
            return false;
        }
    }
    return false;
}

/**
 * CONVENTIONS D2 (warning) — the mirror of {@link d2AwaitIoMatcher}: only the
 * IO-backed matchers are async. `await expect(x).toBe(y)` awaits a plain value,
 * which reads as if the assertion were IO and hides the D2 signal. Drop the
 * `await`.
 */
export const d2wAwaitSyncMatcher: LintRule = {
    create(context: RuleContext) {
        return {
            CallExpression(node: AstNode) {
                const parent = node.parent as AstNode | undefined;
                if (parent?.type !== 'AwaitExpression') {
                    return;
                }
                const callee = node.callee as AstNode | undefined;
                if (callee === undefined) {
                    return;
                }
                const matcher = memberPropertyName(callee);
                if (matcher === undefined || !SYNC_MATCHERS.has(matcher)) {
                    return;
                }
                if (rootsAtSyncExpect(callee.object as AstNode | undefined)) {
                    context.report({ data: { matcher }, messageId: 'redundantAwait', node });
                }
            },
        };
    },
    meta: {
        docs: RULE_DOCS['d2w-await-sync-matcher'],
        messages: {
            redundantAwait:
                'await on expect(…).{{matcher}}(…) is redundant — that matcher is synchronous; only IO-backed matchers (toMatchRows/toBeEmpty/toBeRunning) are awaited (D2 — see docs/13-linting.md).',
        },
        type: 'suggestion',
    },
};
