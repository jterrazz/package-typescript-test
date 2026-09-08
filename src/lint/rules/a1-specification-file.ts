import { specificationMember } from '../ast.js';
import { RULE_DOCS } from '../manifest.js';
import type { AstNode, LintRule, RuleContext, Visitor } from '../types.js';

const SPECIFICATION_SUFFIX = '.specification.ts';

/**
 * CONVENTIONS A1 — a runner is created in a `*.specification.ts` file under
 * `specs/`. Any `specification.<member>(…)` call in a file that is not a
 * specification file is flagged.
 *
 * Framework-internal unit tests of the constructors themselves (this repo's
 * `src/**\/*.test.ts`) disable the rule via a config override — for consumers
 * the rule is universal.
 */
export const a1SpecificationFile: LintRule = {
    create(context: RuleContext): Visitor {
        if (context.filename.endsWith(SPECIFICATION_SUFFIX)) {
            return {};
        }
        return {
            CallExpression(node: AstNode) {
                const member = specificationMember(node);
                if (member !== undefined) {
                    context.report({ data: { member }, messageId: 'outsideSpecification', node });
                }
            },
        };
    },
    meta: {
        docs: RULE_DOCS['a1-specification-file'],
        messages: {
            outsideSpecification:
                'specification.{{member}}() must be called from a `*.specification.ts` file under specs/ (A1 — see docs/13-linting.md).',
        },
        type: 'problem',
    },
};
