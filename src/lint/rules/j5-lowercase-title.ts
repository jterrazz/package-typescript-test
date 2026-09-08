import { chainRootName, stringValue } from '../ast.js';
import { RULE_DOCS } from '../manifest.js';
import type { AstNode, LintRule, RuleContext, Visitor } from '../types.js';

/** The block/test introducers whose title literal C1' constrains. */
const TITLED = new Set(['describe', 'it', 'test']);

/** An identifier-shaped, all-caps/underscored first word: `VALID_CATEGORIES`,
 * `HTTP`, `DI`. Such a word names a symbol verbatim — lowercasing it would
 * misspell it — so it is exempt. A prose word (`Rejects`, `Builds`) is not. */
const ALL_CAPS_IDENTIFIER = /^[A-Z][A-Z0-9_]*$/u;

/**
 * CONVENTIONS J5 — the first character of a `test('…')` / `describe('…')` title
 * literal must be lowercase.
 *
 * The test name is the sole description of behaviour (B3): a sentence fragment,
 * lowercase-led like prose (`'rejects an unknown job'`). Exempt are titles
 * whose first WORD is an identifier-shaped all-caps/underscored token
 * (`'VALID_CATEGORIES is rejected'`, `'HTTP is upgraded'`, `'DI wires …'`) —
 * lowercasing a named symbol would misspell it — and titles opening on a
 * non-letter (a `$`, a `{`, a `%s` placeholder). Only lowercase-able prose
 * first words are enforced. Covers the modifier and parametrized forms
 * (`test.only`, `describe.each(...)(...)`) via the chain root.
 */
export const j5LowercaseTitle: LintRule = {
    create(context: RuleContext): Visitor {
        return {
            CallExpression(node: AstNode) {
                const callee = node.callee as AstNode | undefined;
                const root = chainRootName(callee);
                if (root === undefined || !TITLED.has(root)) {
                    return;
                }
                const title = stringValue((node.arguments as AstNode[] | undefined)?.[0]);
                if (title === undefined) {
                    return;
                }
                const first = [...title][0];
                // Empty title, or one opening on a non-letter, is out of scope.
                if (first === undefined || !/\p{L}/u.test(first)) {
                    return;
                }
                // An identifier-shaped all-caps first word names a symbol —
                // Exempt (VALID_CATEGORIES, HTTP, DI).
                const firstWord = title.split(/\s+/u)[0];
                if (ALL_CAPS_IDENTIFIER.test(firstWord)) {
                    return;
                }
                if (first !== first.toLocaleLowerCase()) {
                    context.report({ data: { runner: root }, messageId: 'uppercase', node });
                }
            },
        };
    },
    meta: {
        docs: RULE_DOCS['j5-lowercase-title'],
        messages: {
            uppercase:
                'A {{runner}}() title must start lowercase — the test name is a prose fragment, not a sentence (J5 — see docs/13-linting.md).',
        },
        type: 'problem',
    },
};
