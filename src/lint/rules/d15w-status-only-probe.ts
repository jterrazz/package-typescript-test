import { findTestCallback, isTestCallee, memberPropertyName, segments, walk } from '../ast.js';
import { RULE_DOCS } from '../manifest.js';
import type { AstNode, LintRule, RuleContext, Visitor } from '../types.js';

/** An HTTP status code lives in this range — the numeric-literal gate. */
const MIN_STATUS = 100;
const MAX_STATUS = 599;

/** Matchers that pin a single value — the shape of a status probe. */
const EQUALITY_MATCHERS = new Set(['toBe', 'toEqual']);

/** Is `node` an `expect(…)` call (bare `expect` identifier callee)? */
function isExpectCall(node: AstNode | undefined): boolean {
    if (node?.type !== 'CallExpression') {
        return false;
    }
    const callee = node.callee as AstNode | undefined;
    return callee?.type === 'Identifier' && callee.name === 'expect';
}

/** Is `node` a numeric literal in the HTTP status range (100–599)? */
function isStatusLiteral(node: AstNode | undefined): boolean {
    if (node?.type !== 'Literal' || typeof node.value !== 'number') {
        return false;
    }
    const value = node.value;
    return Number.isInteger(value) && value >= MIN_STATUS && value <= MAX_STATUS;
}

/**
 * Is `node` a status probe — `expect(X.status).toBe(N)` / `.toEqual(N)` where
 * `X.status` is any `.status` member access and `N` is a numeric literal in the
 * HTTP status range? The numeric-literal gate keeps container-status STRINGS
 * (`expect(neo.status).toBe('running')`) out.
 */
function isStatusProbe(node: AstNode): boolean {
    if (node.type !== 'CallExpression') {
        return false;
    }
    const callee = node.callee as AstNode | undefined;
    if (callee?.type !== 'MemberExpression') {
        return false;
    }
    const matcher = memberPropertyName(callee);
    if (matcher === undefined || !EQUALITY_MATCHERS.has(matcher)) {
        return false;
    }
    // The subject is a direct `expect(<subject>)` — no `.not`/`.resolves` chain.
    const expectCall = callee.object as AstNode | undefined;
    if (!isExpectCall(expectCall)) {
        return false;
    }
    const subject = ((expectCall?.arguments as AstNode[] | undefined) ?? [])[0];
    if (subject?.type !== 'MemberExpression' || memberPropertyName(subject) !== 'status') {
        return false;
    }
    const expected = ((node.arguments as AstNode[] | undefined) ?? [])[0];
    return isStatusLiteral(expected);
}

/**
 * CONVENTIONS D11/D15 (warning) — a spec test whose ONLY assertions are HTTP
 * status probes (`expect(X.status).toBe(N)` / `.toEqual(N)`, N a numeric literal
 * 100–599) throws away the full-response golden. Pin the whole response instead:
 * `expect(result.response).toMatch('case.http')`.
 *
 * This complements d12w (which needs a CLUSTER of ≥3 body probes): the lone
 * `expect(result.status).toBe(422)` as a test's sole assertion falls below that
 * threshold yet still hides everything the response carries. The rule fires only
 * when EVERY `expect(…)` in the callback is a status probe — a status probe
 * sitting NEXT TO a real assertion (a golden, `toMatchRows`, `toContain`, …) is
 * the legitimate scalpel and stays silent.
 */
export const d15wStatusOnlyProbe: LintRule = {
    create(context: RuleContext): Visitor {
        if (!segments(context.filename).includes('specs')) {
            return {};
        }
        return {
            CallExpression(node: AstNode) {
                if (!isTestCallee(node.callee as AstNode | undefined)) {
                    return;
                }
                const callback = findTestCallback((node.arguments as AstNode[] | undefined) ?? []);
                if (callback === undefined) {
                    return;
                }

                // Count every `expect(…)` call and how many are status probes.
                // Any non-status assertion (golden, toMatchRows, toContain, or a
                // Status compared to a string) makes probes < expects — the
                // Scalpel allowance stays silent.
                let expectCalls = 0;
                let statusProbes = 0;
                walk(callback, (inner) => {
                    if (isExpectCall(inner)) {
                        expectCalls++;
                    }
                    if (isStatusProbe(inner)) {
                        statusProbes++;
                    }
                });

                if (expectCalls >= 1 && statusProbes === expectCalls) {
                    context.report({ messageId: 'statusOnlyProbe', node });
                }
            },
        };
    },
    meta: {
        docs: RULE_DOCS['d15w-status-only-probe'],
        messages: {
            statusOnlyProbe:
                "The test's only assertion(s) are status probes — pin the full response: expect(result.response).toMatch('case.http') (D11 — see docs/13-linting.md).",
        },
        type: 'suggestion',
    },
};
