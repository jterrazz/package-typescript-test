import { importSourceVisitor, isUnderSpecs, memberPropertyName } from '../ast.js';
import { RULE_DOCS } from '../manifest.js';
import type { AstNode, LintRule, RuleContext, Visitor } from '../types.js';

/**
 * CONVENTIONS J2 — spec files (`specs/**`) contain no arbitrary sleeps:
 * synchronisation goes through `waitFor` / the framework's own mechanisms.
 * Flags `setTimeout(…)` calls (bare or as a member, e.g.
 * `globalThis.setTimeout`) and imports of `node:timers/promises`.
 */
export const j2NoSleepInSpecs: LintRule = {
    create(context: RuleContext) {
        if (!isUnderSpecs(context.filename)) {
            return {};
        }
        const visitor: Visitor = {
            CallExpression(node: AstNode) {
                const callee = node.callee as AstNode | undefined;
                if (callee === undefined) {
                    return;
                }
                const name =
                    callee.type === 'Identifier'
                        ? (callee.name as string)
                        : memberPropertyName(callee);
                if (name === 'setTimeout' || name === 'setInterval') {
                    context.report({ messageId: 'sleep', node });
                    return;
                }
                // `Atomics.wait(…)` blocks the thread — a sleep in disguise.
                if (
                    name === 'wait' &&
                    callee.type === 'MemberExpression' &&
                    (callee.object as AstNode | undefined)?.type === 'Identifier' &&
                    ((callee.object as AstNode).name as string) === 'Atomics'
                ) {
                    context.report({ messageId: 'sleep', node });
                }
            },
            ...importSourceVisitor(({ node, source }) => {
                if (source === 'node:timers/promises' || source === 'timers/promises') {
                    context.report({ messageId: 'timersImport', node });
                }
            }),
        };
        return visitor;
    },
    meta: {
        docs: RULE_DOCS['j2-no-sleep-in-specs'],
        messages: {
            sleep: 'No arbitrary sleeps in specs — synchronise via `waitFor` or the framework (J2 — see docs/13-linting.md).',
            timersImport:
                'No timer-based sleeps in specs — synchronise via `waitFor` or the framework (J2 — see docs/13-linting.md).',
        },
        type: 'problem',
    },
};
