import { importSourceVisitor } from '../ast.js';
import { RULE_DOCS } from '../manifest.js';
import { declaredSubpaths } from '../package-exports.js';
import type { LintRule, RuleContext, Visitor } from '../types.js';

const PACKAGE = '@jterrazz/test';

/**
 * CONVENTIONS F1 — everything a SPEC needs is imported from `@jterrazz/test`;
 * internal subpaths do not exist.
 *
 * The exception is not a list kept here: it is the package's own `exports` map
 * (`/oxlint`, the tool-facing plugin entry; `/vitest`, the runner-config
 * surface `vitest.config.ts` imports). A published subpath IS the public
 * contract, so reading the manifest is what keeps the rule from outlawing an
 * import the package itself prescribes. Each is exempt from any file — an
 * oxlint config, a shared preset, a vitest config.
 */
export const f1NoSubpathImport: LintRule = {
    create(context: RuleContext) {
        const allowed = new Set(declaredSubpaths());
        const visitor: Visitor = {
            ...importSourceVisitor(({ node, source }) => {
                if (!source.startsWith(`${PACKAGE}/`) || allowed.has(source)) {
                    return;
                }
                context.report({
                    data: {
                        published: allowed.size === 0 ? 'none' : [...allowed].sort().join(', '),
                        source,
                    },
                    messageId: 'subpath',
                    node,
                });
            }),
        };
        return visitor;
    },
    meta: {
        docs: RULE_DOCS['f1-no-subpath-import'],
        messages: {
            subpath:
                'Import from "@jterrazz/test", not "{{source}}" — internal subpaths do not exist (F1 — see docs/13-linting.md). Published subpaths, exempt everywhere: {{published}}.',
        },
        type: 'problem',
    },
};
