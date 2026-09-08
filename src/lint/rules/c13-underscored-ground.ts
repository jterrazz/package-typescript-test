import { dirname, join } from 'node:path';

import { RENAMED_GROUND_DIRS } from '../../core/specification/shared/ground.js';
import { specsAnchor } from '../ast.js';
import { isDirectory } from '../fs-cache.js';
import { RULE_DOCS } from '../manifest.js';
import type { AstNode, LintRule, RuleContext, Visitor } from '../types.js';

const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;

/**
 * CONVENTIONS C13 — the ground of a spec carries a leading underscore. A
 * directory named `fixtures/`, `expected/`, `requests/` or `seeds/` under
 * `specs/` is a pre-14 name: since `@jterrazz/test` 14.0.0 the four are
 * `_fixtures/`, `_expected/`, `_requests/` and `_seeds/`, with no compatibility
 * fallback.
 *
 * The catch this rule exists for: a consumer that upgrades and keeps the old
 * names loses nothing loudly. Every resolver — `.fixture()`, `.seed()`,
 * `.request()`, `toMatch()` — looks under the underscored name, finds nothing,
 * and the tree becomes invisible rather than wrong. The failure that follows is
 * "fixture does not exist" on every spec at once, one step removed from the
 * cause; this rule states the cause and the rename.
 *
 * Anchored on the feature's visited test file, exactly as C2/C7/C11 are: the
 * spec's own sibling directories are probed, plus the `$FIXTURES` pool at the
 * nearest specs root. A DOMAIN folder named after the ground it holds
 * (`specs/api/requests/_requests/`) is never a probe target — only what sits
 * beside a spec is.
 */
export const c13UnderscoredGround: LintRule = {
    create(context: RuleContext): Visitor {
        const file = context.physicalFilename;
        const anchor = specsAnchor(file);
        if (!TEST_FILE.test(file) || anchor === undefined) {
            return {};
        }
        return {
            Program(node: AstNode) {
                const seen = new Set<string>();
                const probe = (parent: string, legacy: string): void => {
                    const path = join(parent, legacy);
                    if (seen.has(path) || !isDirectory(path)) {
                        return;
                    }
                    seen.add(path);
                    context.report({
                        data: { ground: RENAMED_GROUND_DIRS[legacy], legacy },
                        messageId: 'notUnderscored',
                        node,
                    });
                };
                for (const legacy of Object.keys(RENAMED_GROUND_DIRS)) {
                    probe(dirname(file), legacy);
                }
                // The pool is ground for the whole tree, and no spec sits beside it.
                probe(anchor.directory, 'fixtures');
            },
        };
    },
    meta: {
        docs: RULE_DOCS['c13-underscored-ground'],
        messages: {
            notUnderscored:
                'The directory "{{legacy}}/" is a pre-14 ground name — rename it to "{{ground}}/" (`git mv {{legacy}} {{ground}}`). What a spec stands on carries the underscore; a spec\'s own folder never does, and no resolver reads the un-underscored name (C13 — see docs/13-linting.md).',
        },
        type: 'problem',
    },
};
