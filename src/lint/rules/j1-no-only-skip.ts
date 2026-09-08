import { RULE_DOCS } from '../manifest.js';
import type { AstNode, LintRule, RuleContext } from '../types.js';

/** Test runners whose `.only` / `.skip` modifiers must never be committed. */
const RUNNERS = new Set(['describe', 'it', 'test']);
/** The focus/skip modifiers CONVENTIONS J1 forbids. */
const FORBIDDEN = new Set(['only', 'skip']);

/**
 * CONVENTIONS J1 — no committed `.only` / `.skip`.
 *
 * Flags the member form used across the specs: `describe.only`, `test.only`,
 * `it.only` and their `.skip` counterparts. Modifiers that legitimately gate a
 * test (`test.skipIf`, `test.runIf`) are untouched — only the bare `only`/`skip`
 * that pin or disable a test in a commit are reported.
 */
export const j1NoOnlySkip: LintRule = {
    create(context: RuleContext) {
        return {
            MemberExpression(node: AstNode) {
                if (node.computed === true) {
                    return;
                }
                const object = node.object as AstNode | undefined;
                const property = node.property as AstNode | undefined;
                if (object?.type !== 'Identifier' || property?.type !== 'Identifier') {
                    return;
                }
                const runner = object.name as string;
                const modifier = property.name as string;
                if (RUNNERS.has(runner) && FORBIDDEN.has(modifier)) {
                    context.report({ data: { modifier, runner }, messageId: 'forbidden', node });
                }
            },
        };
    },
    meta: {
        docs: RULE_DOCS['j1-no-only-skip'],
        messages: {
            forbidden:
                'Committed `{{runner}}.{{modifier}}` is not allowed (J1 — see docs/13-linting.md). Remove it before committing.',
        },
        type: 'problem',
    },
};
