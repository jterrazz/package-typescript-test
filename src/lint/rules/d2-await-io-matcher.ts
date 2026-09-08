import { memberPropertyName } from '../ast.js';
import { RULE_DOCS } from '../manifest.js';
import type { AstNode, LintRule, RuleContext } from '../types.js';

/** Matchers backed by IO (SQL query, disk walk, docker) — must be awaited (D2). */
const IO_MATCHERS = new Set(['toBeEmpty', 'toBeRunning', 'toMatchRows']);

/** Does the member-call spine root at an `expect(…)` call? */
function rootsAtExpect(node: AstNode | undefined): boolean {
    let current = node;
    while (current !== undefined) {
        if (current.type === 'CallExpression') {
            const callee = current.callee as AstNode | undefined;
            if (callee?.type === 'Identifier' && callee.name === 'expect') {
                return true;
            }
            current = callee;
        } else if (current.type === 'MemberExpression') {
            current = current.object as AstNode | undefined;
        } else {
            return false;
        }
    }
    return false;
}

/**
 * The matcher's promise is dropped only when the call is a bare statement
 * (`expect(rows).toMatchRows([]);`). Any other position uses the value —
 * awaited, returned, an arrow body, assigned, or passed to an outer
 * `expect(promise).rejects.toThrow(…)` — so the promise is handled.
 */
function isDropped(node: AstNode): boolean {
    const parent = node.parent as AstNode | undefined;
    return parent?.type === 'ExpressionStatement';
}

/**
 * CONVENTIONS D2 — the IO-backed matchers (`toMatchRows` runs SQL,
 * `toBeEmpty`/`toBeRunning` walk disk / query docker) return a promise and must
 * be `await`ed (or returned). A bare `expect(rows).toMatchRows(...)` silently
 * resolves nothing and the assertion never runs.
 */
export const d2AwaitIoMatcher: LintRule = {
    create(context: RuleContext) {
        return {
            CallExpression(node: AstNode) {
                const callee = node.callee as AstNode | undefined;
                if (callee === undefined) {
                    return;
                }
                const matcher = memberPropertyName(callee);
                if (matcher === undefined || !IO_MATCHERS.has(matcher)) {
                    return;
                }
                if (!rootsAtExpect(callee.object as AstNode | undefined)) {
                    return;
                }
                if (isDropped(node)) {
                    context.report({ data: { matcher }, messageId: 'mustAwait', node });
                }
            },
        };
    },
    meta: {
        docs: RULE_DOCS['d2-await-io-matcher'],
        messages: {
            mustAwait:
                'expect(…).{{matcher}}(…) is IO-backed and returns a promise — it must be awaited or returned, else the assertion never runs (D2 — see docs/13-linting.md).',
        },
        type: 'problem',
    },
};
