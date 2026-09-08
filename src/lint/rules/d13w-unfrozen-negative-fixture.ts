import { findProperty, memberPropertyName, segments } from '../ast.js';
import { RULE_DOCS } from '../manifest.js';
import type { AstNode, LintRule, RuleContext, Visitor } from '../types.js';

/**
 * Does `arguments[1]` of a `toMatch(name, options)` call carry `{ frozen: true }`?
 * A frozen fixture opts out of update-mode rewriting, so it is exempt.
 */
function hasFrozenOption(args: AstNode[]): boolean {
    const options = args[1];
    if (options === undefined || options.type !== 'ObjectExpression') {
        return false;
    }
    const frozen = findProperty(options, 'frozen');
    const value = frozen?.value as AstNode | undefined;
    return value?.type === 'Literal' && value.value === true;
}

/**
 * Is this `toMatch(…)` call nested inside a WRAPPING `expect(…)` — the shape of a
 * negative assertion (`expect(() => …toMatch(…)).toThrow()` or
 * `expect(…toMatch(…)).rejects.toThrow()`)? The subject's own `expect(x)` is the
 * member OBJECT of `.toMatch` (a descendant), never an ancestor, so a positive
 * `expect(x).toMatch('f')` never trips this. The walk stays inside the current
 * expression: it stops at the first statement boundary or non-`expect` call, so
 * a `toMatch` merely written inside `inUpdateMode(() => …)` is NOT flagged.
 */
const TRANSPARENT_ANCESTORS = new Set([
    'ArrowFunctionExpression',
    'AwaitExpression',
    'ChainExpression',
    'MemberExpression',
    'ParenthesizedExpression',
    'TSAsExpression',
    'TSNonNullExpression',
]);

function isWrappedInExpect(node: AstNode): boolean {
    let current = node.parent as AstNode | undefined;
    while (current !== undefined) {
        if (current.type === 'CallExpression') {
            const callee = current.callee as AstNode | undefined;
            return callee?.type === 'Identifier' && callee.name === 'expect';
        }
        if (!TRANSPARENT_ANCESTORS.has(current.type)) {
            return false;
        }
        current = current.parent as AstNode | undefined;
    }
    return false;
}

/**
 * CONVENTIONS D13 (warning) — a `toMatch` whose failure is the behaviour under
 * test (wrapped in `expect(() => …).toThrow()` or `expect(…).rejects.toThrow()`)
 * asserts a DELIBERATELY-WRONG or MISSING fixture. Under `TEST_UPDATE=1` an
 * unfrozen fixture is silently rewritten with the actual output — the matcher
 * writes instead of throwing — which destroys the negative case (the assertion
 * then no longer throws). Pass `{ frozen: true }` so the fixture is never
 * rewritten and the mismatch/error still throws in update mode.
 *
 * The structural signal is precise for the wrapped forms; a `toMatch` routed
 * through a helper that owns the try/catch (`catchMessage(() => …toMatch(…))`)
 * is out of static reach — see the D13 process note for that residue.
 */
export const d13wUnfrozenNegativeFixture: LintRule = {
    create(context: RuleContext): Visitor {
        if (!segments(context.filename).includes('specs')) {
            return {};
        }
        return {
            CallExpression(node: AstNode) {
                const callee = node.callee as AstNode | undefined;
                if (callee === undefined || memberPropertyName(callee) !== 'toMatch') {
                    return;
                }
                if (!isWrappedInExpect(node)) {
                    return;
                }
                if (hasFrozenOption((node.arguments as AstNode[] | undefined) ?? [])) {
                    return;
                }
                context.report({ messageId: 'unfrozenNegativeFixture', node });
            },
        };
    },
    meta: {
        docs: RULE_DOCS['d13w-unfrozen-negative-fixture'],
        messages: {
            unfrozenNegativeFixture:
                'This toMatch asserts a mismatch (wrapped in expect(…).toThrow/.rejects) — pass { frozen: true } so TEST_UPDATE=1 never overwrites the deliberately-wrong fixture (D13 — see docs/13-linting.md).',
        },
        type: 'suggestion',
    },
};
