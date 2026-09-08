import { memberPropertyName } from '../ast.js';
import { RULE_DOCS } from '../manifest.js';
import type { AstNode, LintRule, RuleContext } from '../types.js';

/** The five constructors, and only five (A2 — see docs/13-linting.md). */
const KNOWN_CONSTRUCTORS = new Set(['api', 'cli', 'jobs', 'mobile', 'website']);

/**
 * CONVENTIONS A2 — `specification.api()`, `specification.jobs()`,
 * `specification.cli()`, `specification.website()` and
 * `specification.mobile()` are the only members. Any other access
 * (`specification.app`, `.http`, `.stack`, …) is flagged at the member site.
 */
export const a2KnownConstructors: LintRule = {
    create(context: RuleContext) {
        return {
            MemberExpression(node: AstNode) {
                const object = node.object as AstNode | undefined;
                if (object?.type !== 'Identifier' || object.name !== 'specification') {
                    return;
                }
                const member = memberPropertyName(node);
                if (member !== undefined && !KNOWN_CONSTRUCTORS.has(member)) {
                    context.report({ data: { member }, messageId: 'unknownConstructor', node });
                }
            },
        };
    },
    meta: {
        docs: RULE_DOCS['a2-known-constructors'],
        messages: {
            unknownConstructor:
                'specification.{{member}} does not exist — the only constructors are specification.api(), specification.jobs(), specification.cli(), specification.website() and specification.mobile() (A2 — see docs/13-linting.md).',
        },
        type: 'problem',
    },
};
