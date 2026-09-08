import { dirname, join } from 'node:path';

import {
    GROUND_EXPECTED,
    GROUND_FIXTURES,
    GROUND_REQUESTS,
    GROUND_SEEDS,
} from '../../core/specification/shared/ground.js';
import { memberPropertyName, specsAnchor, stringValue } from '../ast.js';
import { isDirectory, isFile } from '../fs-cache.js';
import { RULE_DOCS } from '../manifest.js';
import type { AstNode, LintRule, RuleContext, Visitor } from '../types.js';

const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;

/** The ground directory each fixture-referencing verb reads from. */
const VERB_ROOTS: Record<string, string> = {
    request: GROUND_REQUESTS,
    seed: GROUND_SEEDS,
    toMatch: GROUND_EXPECTED,
};

/**
 * A fixture reference is a filename/path, never inline content. `.seed()` also
 * accepts a raw SQL string (integration tests), and any literal with whitespace
 * or a newline is inline content, not a path — out of C8's reach.
 */
function looksLikePath(value: string): boolean {
    return value.length > 0 && !/\s/u.test(value);
}

/** Resolve the on-disk target a `.fixture()` literal points at, if determinable. */
function resolveFixture(
    argument: string,
    featureDir: string,
    specsDir: string,
): string | undefined {
    if (argument.startsWith('$FIXTURES/')) {
        return join(specsDir, GROUND_FIXTURES, argument.slice(10));
    }
    if (argument.startsWith('$')) {
        return undefined; // Unknown marker — B2's concern, not existence.
    }
    return join(featureDir, GROUND_FIXTURES, argument);
}

/**
 * CONVENTIONS C8 — a fixture referenced by a literal must exist on disk under
 * its ground root: `.request(x)`→`_requests/x`, `.seed(x)`→`_seeds/x`,
 * `.fixture(x)`→the leaf's `_fixtures/` (or the `$FIXTURES/` pool at the nearest
 * `specs/_fixtures/`), `toMatch(x)`→`_expected/x` (file or tree snapshot). A typo
 * that would fail only at runtime is caught statically. Non-literal arguments
 * are out of static reach and skipped.
 */
export const c8ReferencedFixtureExists: LintRule = {
    create(context: RuleContext): Visitor {
        const file = context.physicalFilename;
        const anchor = specsAnchor(file);
        if (!TEST_FILE.test(file) || anchor === undefined) {
            return {};
        }
        const featureDir = dirname(file);
        return {
            CallExpression(node: AstNode) {
                const callee = node.callee as AstNode | undefined;
                const verb = callee === undefined ? undefined : memberPropertyName(callee);
                if (verb === undefined) {
                    return;
                }
                const args = (node.arguments as AstNode[] | undefined) ?? [];
                if (verb === 'fixture') {
                    const value = stringValue(args[0]);
                    if (value === undefined || !looksLikePath(value)) {
                        return;
                    }
                    const target = resolveFixture(
                        value.replace(/\/+$/, ''),
                        featureDir,
                        anchor.directory,
                    );
                    if (target !== undefined && !isFile(target) && !isDirectory(target)) {
                        context.report({
                            data: { path: value, root: GROUND_FIXTURES },
                            messageId: 'missing',
                            node: args[0],
                        });
                    }
                    return;
                }
                const root = VERB_ROOTS[verb];
                if (root === undefined) {
                    return;
                }
                const value = stringValue(args[0]);
                if (value === undefined || !looksLikePath(value)) {
                    return;
                }
                const target = join(featureDir, root, value.replace(/\/+$/, ''));
                // ToMatch may name a directory-tree snapshot; the others are files.
                const ok =
                    verb === 'toMatch' ? isFile(target) || isDirectory(target) : isFile(target);
                if (!ok) {
                    context.report({
                        data: { path: `${root}/${value}`, root },
                        messageId: 'missing',
                        node: args[0],
                    });
                }
            },
        };
    },
    meta: {
        docs: RULE_DOCS['c8-referenced-fixture-exists'],
        messages: {
            missing:
                'Referenced fixture "{{path}}" does not exist on disk under its ground {{root}}/ root (C8 — see docs/13-linting.md). Create it or fix the reference.',
        },
        type: 'problem',
    },
};
