import { dirname, resolve } from 'node:path';

import { findRoot } from '../../core/specification/shared/resolve.js';
import { findProperty, specificationMember, stringValue } from '../ast.js';
import { isFile } from '../fs-cache.js';
import { RULE_DOCS } from '../manifest.js';
import type { AstNode, LintRule, RuleContext } from '../types.js';

/**
 * The root the convention would derive (A9 — see docs/13-linting.md): the
 * framework's own walk-up, run against this layer's cached fs probe. The rule
 * flags a `root` that the runner would have found by itself, so the two MUST
 * be the same function — a private copy of the walk drifted from it before.
 */
function derivedRoot(startDir: string): string | undefined {
    return findRoot(startDir, isFile);
}

/**
 * CONVENTIONS A9 (warning) — `root` is an override reserved for cases the
 * convention cannot resolve. When the literal points at the very directory the
 * walk-up would have found, it is redundant and flagged.
 */
export const a9wRedundantRoot: LintRule = {
    create(context: RuleContext) {
        return {
            CallExpression(node: AstNode) {
                if (specificationMember(node) === undefined) {
                    return;
                }
                for (const argument of (node.arguments as AstNode[] | undefined) ?? []) {
                    const root = findProperty(argument, 'root');
                    const literal = stringValue(root?.value as AstNode | undefined);
                    if (root === undefined || literal === undefined) {
                        continue;
                    }
                    const specDir = dirname(context.physicalFilename);
                    if (resolve(specDir, literal) === derivedRoot(specDir)) {
                        context.report({
                            data: { root: literal },
                            messageId: 'redundant',
                            node: root,
                        });
                    }
                }
            },
        };
    },
    meta: {
        docs: RULE_DOCS['a9w-redundant-root'],
        messages: {
            redundant:
                'root: "{{root}}" is redundant — walking up from the specification file already resolves to that directory (A9 — see docs/13-linting.md).',
        },
        type: 'suggestion',
    },
};
