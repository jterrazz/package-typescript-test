import { dirname, join } from 'node:path';

import { GROUND_EXPECTED } from '../../core/specification/shared/ground.js';
import { memberPropertyName, segments, stringValue, walk } from '../ast.js';
import { isDirectory } from '../fs-cache.js';
import { RULE_DOCS } from '../manifest.js';
import type { AstNode, LintRule, RuleContext, Visitor } from '../types.js';

const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;

/** Does the expect(…) subject chain contain a `.directory(…)` call? */
function subjectIsDirectory(toMatchCallee: AstNode): boolean {
    const expectCall = toMatchCallee.object as AstNode | undefined;
    if (expectCall?.type !== 'CallExpression') {
        return false;
    }
    const callee = expectCall.callee as AstNode | undefined;
    if (callee?.type !== 'Identifier' || callee.name !== 'expect') {
        return false;
    }
    let isDirectorySubject = false;
    for (const argument of (expectCall.arguments as AstNode[] | undefined) ?? []) {
        walk(argument, (node) => {
            if (
                node.type === 'CallExpression' &&
                memberPropertyName((node.callee as AstNode) ?? { type: '' }) === 'directory'
            ) {
                isDirectorySubject = true;
            }
        });
    }
    return isDirectorySubject;
}

/**
 * CONVENTIONS C6 — the extension is part of the fixture name and mandatory in
 * `toMatch` (`'help.txt'`, never `'help'`) — except for directory-tree
 * snapshots, which are directories under `_expected/`.
 *
 * The directory exception is resolved two ways: statically, when the expect
 * subject visibly chains `.directory(…)`; else on disk, when
 * `_expected/<name>/` exists next to the spec (cached stat).
 */
export const c6ToMatchExtension: LintRule = {
    create(context: RuleContext): Visitor {
        const file = context.physicalFilename;
        if (!TEST_FILE.test(file) || !segments(file).includes('specs')) {
            return {};
        }
        return {
            CallExpression(node: AstNode) {
                const callee = node.callee as AstNode | undefined;
                if (callee === undefined || memberPropertyName(callee) !== 'toMatch') {
                    return;
                }
                const argument = (node.arguments as AstNode[] | undefined)?.[0];
                const name = stringValue(argument);
                if (name === undefined || name.length === 0) {
                    return;
                }
                const base = name.split('/').at(-1) ?? '';
                if (base.includes('.')) {
                    return; // Extension present.
                }
                if (subjectIsDirectory(callee)) {
                    return; // Directory-tree snapshot, statically visible.
                }
                if (isDirectory(join(dirname(file), GROUND_EXPECTED, name))) {
                    return; // Directory-tree snapshot on disk.
                }
                context.report({ data: { name }, messageId: 'missingExtension', node: argument });
            },
        };
    },
    meta: {
        docs: RULE_DOCS['c6-tomatch-extension'],
        messages: {
            missingExtension:
                'toMatch("{{name}}") is missing its extension — the extension is part of the fixture name ("help.txt", never "help"); only directory-tree snapshots (_expected/<name>/) omit it (C6 — see docs/13-linting.md).',
        },
        type: 'problem',
    },
};
