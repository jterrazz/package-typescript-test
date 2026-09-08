import { specsAnchor } from '../ast.js';
import { isFile } from '../fs-cache.js';
import { RULE_DOCS } from '../manifest.js';
import type { AstNode, LintRule, RuleContext, Visitor } from '../types.js';

const TEST_SUFFIX = '.test.ts';
const SPECIFICATION_SUFFIX = '.specification.ts';

/** The shapes a spec tree may declare. */
export type SpecsDepth = 'facet' | 'facet-domain' | 'mirror' | 'off';

type Options = { depth?: SpecsDepth };

const DEFAULT_DEPTH: SpecsDepth = 'facet-domain';

/**
 * Whether a file is the unit test of the module it sits beside — `x.test.ts`
 * next to `x.ts`, which is the whole of I2's pairing. This is what tells a
 * ground MODULE's test from a spec that wandered into the ground.
 */
function testsItsNeighbour(filename: string): boolean {
    return filename.endsWith(TEST_SUFFIX) && isFile(`${filename.slice(0, -TEST_SUFFIX.length)}.ts`);
}

/**
 * CONVENTIONS C1' — the shape of a spec tree, DECLARED by the consumer.
 *
 * A project states which shape its `specs/` tree has; the rule checks that one.
 * Before this option there was a single shape and the only way out was `off`,
 * which took the whole rule with it — a tree with a different, equally
 * deliberate shape had no way to be checked at all.
 *
 * `depth: 'facet-domain'` (the default, and the historical behaviour)
 *
 * A facet (`specs/<facet>/` — api, jobs, cli, integrations, lint, …) is the
 * master folder. It carries its runner(s) at its ROOT
 * (`specs/<facet>/<name>.specification.ts`) and holds DOMAIN folders, each a
 * product command/area with one or more `<aspect>.test.ts` files plus their
 * shared asset dirs.
 *
 * - a `*.test.ts` sits at facet/domain depth — exactly
 *   `specs/<facet>/<domain>/<file>.test.ts`. A test directly at the facet root
 *   (or nested deeper than a domain) is rejected.
 * - a `*.specification.ts` sits at the facet root — exactly
 *   `specs/<facet>/<file>.specification.ts`, never inside a domain.
 *
 * `depth: 'facet'`
 *
 * The same facet root, one degree looser: the folder follows the assets. A
 * `*.test.ts` sits EITHER at the facet root (`specs/<facet>/<aspect>.test.ts`)
 * or one domain folder down (`specs/<facet>/<domain>/<aspect>.test.ts`) — a
 * test earns a domain folder when it carries assets of its own, and sits
 * beside its siblings when it does not. Anything deeper is rejected, and so is
 * a test loose at the specs root. A `*.specification.ts` sits at the facet
 * root, exactly as in `facet-domain`.
 *
 * `depth: 'mirror'`
 *
 * The tree mirrors something outside itself (a command tree, a source tree), so
 * the depth is that structure's and no fixed number can name it. A `*.test.ts`
 * sits at ANY depth of at least one directory under `specs/`, and is NAMED
 * AFTER the directory holding it — `<dir>/<dir>.test.ts`. That naming is what
 * keeps the shape checkable: one test per mirrored node, no test loose at the
 * specs root. Specification files are unconstrained: a mirror has no facet
 * level to anchor them to.
 *
 * `depth: 'off'` — no DEPTH check; the tree's shape is guarded elsewhere.
 *
 * The ground clause holds in every mode, `off` included: a directory whose name
 * carries a LEADING UNDERSCORE is ground — what the specs of a row stand on —
 * and never a domain, so no SPEC may live inside one. That is not a question of
 * depth, which is why no project's declared shape switches it off.
 *
 * Ground is not always inert, though: it may be CODE the specs stand on — the
 * build of the subject under test, a harness the runner spawns. A `<module>.ts`
 * there keeps its own unit test under I2's law, `<module>.test.ts` NEXT to it,
 * and the clause lets that one pair through. Nothing else: a test with no module
 * beside it, or a `*.specification.ts`, is a spec that wandered into the ground.
 *
 * Module tests under `src/` follow the neighbour rule (I2) and are out of scope
 * in every mode.
 */
export const c1DomainStructure: LintRule = {
    create(context: RuleContext): Visitor {
        const depth = (context.options[0] as Options | undefined)?.depth ?? DEFAULT_DEPTH;
        return {
            Program(node: AstNode) {
                const anchor = specsAnchor(context.filename);
                if (anchor === undefined) {
                    return;
                }
                const base = anchor.relative.at(-1) ?? '';
                // Segments strictly between `specs` and the file: [facet, domain, …].
                const nesting = anchor.relative.length - 1;

                if (base.endsWith(TEST_SUFFIX) || base.endsWith(SPECIFICATION_SUFFIX)) {
                    const ground = anchor.relative
                        .slice(0, -1)
                        .find((segment) => segment.startsWith('_'));
                    if (ground !== undefined) {
                        if (!testsItsNeighbour(context.filename)) {
                            context.report({ data: { ground }, messageId: 'specInGround', node });
                        }
                        // A ground module's test answers to I2, not to depth.
                        return;
                    }
                }
                if (depth === 'off') {
                    return;
                }

                if (depth === 'facet') {
                    if (base.endsWith(TEST_SUFFIX)) {
                        if (nesting < 1) {
                            context.report({ messageId: 'testOutsideFacet', node });
                        } else if (nesting > 2) {
                            context.report({ messageId: 'testTooDeepForFacet', node });
                        }
                        return;
                    }
                    if (base.endsWith(SPECIFICATION_SUFFIX) && nesting !== 1) {
                        context.report({ messageId: 'specNotAtFacetRoot', node });
                    }
                    return;
                }

                if (depth === 'mirror') {
                    if (!base.endsWith(TEST_SUFFIX)) {
                        return; // A mirror constrains its tests, nothing else.
                    }
                    if (nesting < 1) {
                        context.report({ messageId: 'testAtSpecsRoot', node });
                        return;
                    }
                    const directory = anchor.relative.at(-2) ?? '';
                    if (base.slice(0, -TEST_SUFFIX.length) !== directory) {
                        context.report({
                            data: { directory },
                            messageId: 'testNotMirroringDirectory',
                            node,
                        });
                    }
                    return;
                }

                if (base.endsWith(TEST_SUFFIX)) {
                    if (nesting < 2) {
                        context.report({ messageId: 'testAtFacetRoot', node });
                    } else if (nesting > 2) {
                        context.report({ messageId: 'testTooDeep', node });
                    }
                    return;
                }
                if (base.endsWith(SPECIFICATION_SUFFIX)) {
                    if (nesting !== 1) {
                        context.report({ messageId: 'specNotAtFacetRoot', node });
                    }
                }
            },
        };
    },
    meta: {
        defaultOptions: [{ depth: DEFAULT_DEPTH }],
        docs: RULE_DOCS['c1-domain-structure'],
        messages: {
            specInGround:
                'A spec must not live under "{{ground}}/" — a leading underscore marks GROUND (what the specs of a row stand on: _fixtures/, _expected/, _requests/, _seeds/), never a domain (C1 — see docs/13-linting.md). Ground that is CODE keeps its own unit test: `<module>.test.ts` NEXT to the `<module>.ts` it tests (I2), and nothing else.',
            specNotAtFacetRoot:
                'A `*.specification.ts` must sit at the facet root: `specs/<facet>/<name>.specification.ts` (C1 — see docs/13-linting.md).',
            testAtFacetRoot:
                'A `*.test.ts` must live in a domain folder: `specs/<facet>/<domain>/<aspect>.test.ts` — tests directly at the facet root are forbidden (C1 — see docs/13-linting.md).',
            testAtSpecsRoot:
                'A `*.test.ts` must live in a directory under specs/ — with `depth: "mirror"` the tree mirrors a structure, and the specs root mirrors nothing (C1 — see docs/13-linting.md).',
            testNotMirroringDirectory:
                'A `*.test.ts` must be named after the directory holding it — `{{directory}}/{{directory}}.test.ts` — with `depth: "mirror"` (C1 — see docs/13-linting.md).',
            testOutsideFacet:
                'A `*.test.ts` must live in a facet folder — `specs/<facet>/<aspect>.test.ts`, or one domain deeper: with `depth: "facet"` the specs root holds facets, not tests (C1 — see docs/13-linting.md).',
            testTooDeep:
                'A `*.test.ts` must sit at facet/domain depth: `specs/<facet>/<domain>/<aspect>.test.ts` — no deeper nesting (C1 — see docs/13-linting.md).',
            testTooDeepForFacet:
                'A `*.test.ts` must sit at the facet root or one domain folder down — `specs/<facet>/<aspect>.test.ts` or `specs/<facet>/<domain>/<aspect>.test.ts`: with `depth: "facet"` nothing nests deeper (C1 — see docs/13-linting.md).',
        },
        schema: [
            {
                additionalProperties: false,
                properties: {
                    depth: { enum: ['facet', 'facet-domain', 'mirror', 'off'], type: 'string' },
                },
                type: 'object',
            },
        ],
        type: 'problem',
    },
};
