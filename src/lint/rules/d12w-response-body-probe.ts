import { findTestCallback, isTestCallee, memberPropertyName, segments, walk } from '../ast.js';
import { RULE_DOCS } from '../manifest.js';
import type { AstNode, LintRule, RuleContext, Visitor } from '../types.js';

type Options = { threshold?: number };

/** A test reading the response body this many times (or more) is a cluster. */
const DEFAULT_THRESHOLD = 3;

/** Is `node` the `x.response.body` member access itself? */
function isResponseBody(node: AstNode): boolean {
    if (node.type !== 'MemberExpression' || memberPropertyName(node) !== 'body') {
        return false;
    }
    const object = node.object as AstNode | undefined;
    return object !== undefined && memberPropertyName(object) === 'response';
}

/** Peel `await`, `as T`, and `!` off an initializer to reach its core expression. */
function unwrap(node: AstNode | undefined): AstNode | undefined {
    let current = node ?? undefined;
    while (current != null) {
        if (current.type === 'AwaitExpression') {
            current = (current.argument ?? undefined) as AstNode | undefined;
        } else if (current.type === 'TSAsExpression' || current.type === 'TSNonNullExpression') {
            current = (current.expression ?? undefined) as AstNode | undefined;
        } else if (current.type === 'ParenthesizedExpression') {
            current = (current.expression ?? undefined) as AstNode | undefined;
        } else {
            return current;
        }
    }
    return undefined;
}

/**
 * CONVENTIONS D12 (warning) — a full-response golden is the norm for API
 * assertions (the D11 boundary, mechanized). A test that accumulates a CLUSTER
 * of raw body probes — reading `.response.body` (or a variable cast from it)
 * `threshold`+ times in one test callback — should collapse into one golden:
 * `expect(result.response).toMatch('case.http')`. One or two probes stay silent
 * (a legitimate scalpel: absence, a single-field delta, third-party output).
 *
 * A probe is a body-rooted read: a direct `.response.body` use, or a field
 * access on the local binding a `const body = result.response.body as {…}`
 * introduces. The count is the same threshold the golden transformation applies.
 */
export const d12wResponseBodyProbe: LintRule = {
    create(context: RuleContext): Visitor {
        const parts = segments(context.filename);
        if (!parts.includes('specs')) {
            return {};
        }
        const threshold =
            (context.options[0] as Options | undefined)?.threshold ?? DEFAULT_THRESHOLD;
        return {
            CallExpression(node: AstNode) {
                if (!isTestCallee(node.callee as AstNode | undefined)) {
                    return;
                }
                const callback = findTestCallback((node.arguments as AstNode[] | undefined) ?? []);
                if (callback === undefined) {
                    return;
                }

                // Pass 1 — names bound to the response body (cast-then-probe).
                const aliases = new Set<string>();
                let responseBodyNodes = 0;
                walk(callback, (inner) => {
                    if (isResponseBody(inner)) {
                        responseBodyNodes++;
                    }
                    if (inner.type === 'VariableDeclarator') {
                        const init = unwrap(inner.init as AstNode | undefined);
                        const id = inner.id as AstNode | undefined;
                        if (
                            init !== undefined &&
                            isResponseBody(init) &&
                            id?.type === 'Identifier'
                        ) {
                            aliases.add(id.name as string);
                        }
                    }
                });

                // Pass 2 — probes: direct `.response.body` uses (excluding the
                // Alias bindings themselves) plus every field read on an alias.
                let aliasReads = 0;
                walk(callback, (inner) => {
                    if (inner.type !== 'MemberExpression') {
                        return;
                    }
                    const object = inner.object as AstNode | undefined;
                    if (object?.type === 'Identifier' && aliases.has(object.name as string)) {
                        aliasReads++;
                    }
                });

                const probes = responseBodyNodes - aliases.size + aliasReads;
                if (probes >= threshold) {
                    context.report({
                        data: { count: String(probes) },
                        messageId: 'bodyProbeCluster',
                        node,
                    });
                }
            },
        };
    },
    meta: {
        docs: RULE_DOCS['d12w-response-body-probe'],
        defaultOptions: [{ threshold: DEFAULT_THRESHOLD }],
        messages: {
            bodyProbeCluster:
                "{{count}} body probes in one test — this wants a full golden: expect(result.response).toMatch('x.http') (D12 — see docs/13-linting.md).",
        },
        schema: [
            {
                additionalProperties: false,
                properties: {
                    threshold: { minimum: 1, type: 'integer' },
                },
                type: 'object',
            },
        ],
        type: 'suggestion',
    },
};
