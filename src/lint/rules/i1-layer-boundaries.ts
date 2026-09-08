import { dirname, resolve } from 'node:path';

import { importSourceVisitor, segments } from '../ast.js';
import { RULE_DOCS } from '../manifest.js';
import type { LintRule, RuleContext, Visitor } from '../types.js';

/** What one layer under `src/` may import. */
export type LayerOptions = {
    /**
     * One folder = one external dependency: each key is a direct child folder of
     * the layer, its value the packages THAT folder may import. A folder may
     * always import from itself, and from `imports`.
     */
    folders?: Record<string, string[]>;
    /**
     * Paths inside `src/` this layer may import — a prefix when it ends with
     * `/` (`core/`), an exact module path otherwise (`vitest/matchers`).
     */
    imports?: string[];
    /** External packages this layer may import (whole name, or `<name>/…`). */
    packages?: string[];
    /**
     * Per-module escape hatches: a module path inside `src/` → the extra
     * `imports` that one file may make. For the lazy seam a layer opens once.
     */
    seams?: Record<string, string[]>;
};

type Options = { layers?: Record<string, LayerOptions> };

const TEST_OR_FIXTURES = /\.(?:test|fixtures)\.[cm]?[jt]sx?$/;

function matchesPackage(source: string, packages: string[]): boolean {
    return packages.some((name) => source === name || source.startsWith(`${name}/`));
}

/** Path relative to the (last) `src` segment, `undefined` when outside src. */
function pathInsideSrc(path: string): string | undefined {
    const parts = segments(path);
    const srcIndex = parts.lastIndexOf('src');
    return srcIndex === -1 ? undefined : parts.slice(srcIndex + 1).join('/');
}

/** Strip a `.js`/`.ts`-style extension for exact-path comparison. */
function withoutExtension(path: string): string {
    return path.replace(/\.[cm]?[jt]sx?$/, '');
}

/** Does `target` match one of the declared paths (prefix, or exact module)? */
function matchesPath(target: string, patterns: string[]): boolean {
    return patterns.some((pattern) =>
        pattern.endsWith('/')
            ? target.startsWith(pattern)
            : withoutExtension(target) === withoutExtension(pattern),
    );
}

/**
 * CONVENTIONS I1 — the layers under `src/` and their sanctioned edges, DECLARED
 * by the project:
 *
 *     'jterrazz/i1-layer-boundaries': ['error', {
 *         layers: {
 *             core: { imports: ['core/', 'integrations/docker/'] },
 *             integrations: { folders: { postgres: ['pg'] }, imports: ['core/'] },
 *         },
 *     }]
 *
 * With no layer map the rule is INERT. It used to ship the framework's own
 * architecture as its law — four layers named `core` / `integrations` / `lint`
 * / `vitest`, and the framework's own dependency table — and applied it to every
 * consumer that enabled the catalogue. A consumer with those directory names
 * was judged against a map describing a different package; a consumer with any
 * other architecture got a rule that could never say anything true. An
 * architecture is the project's to state.
 *
 * Per layer: `packages` are the external dependencies it may import, `imports`
 * the paths inside `src/` it may reach (a `foo/` prefix, or an exact module
 * path), `folders` expresses "one folder = one external dependency" (each child
 * folder may import its own packages and its own files), and `seams` opens a
 * named module to an extra edge — the lazy import a layer allows exactly once.
 *
 * A file under a layer the map does not name is out of scope, as are module
 * tests and `*.fixtures.ts` files (F2/I4 govern those), and any file outside
 * `src/`.
 */
export const i1LayerBoundaries: LintRule = {
    create(context: RuleContext): Visitor {
        const layers = (context.options[0] as Options | undefined)?.layers;
        if (layers === undefined || Object.keys(layers).length === 0) {
            return {};
        }
        const file = context.physicalFilename;
        if (TEST_OR_FIXTURES.test(file)) {
            return {};
        }
        const inside = pathInsideSrc(file);
        const layer = inside?.split('/')[0];
        const rules = layer === undefined ? undefined : layers[layer];
        if (inside === undefined || layer === undefined || rules === undefined) {
            return {};
        }
        const folder = rules.folders === undefined ? undefined : inside.split('/')[1];
        const ownPackages = [...(rules.packages ?? []), ...(rules.folders?.[folder ?? ''] ?? [])];
        const ownImports = [...(rules.imports ?? []), ...(rules.seams?.[inside] ?? [])];

        const allowsExternal = (source: string): boolean => matchesPackage(source, ownPackages);

        const allowsInternal = (target: string): boolean => {
            if (matchesPath(target, ownImports)) {
                return true;
            }
            // A folder always owns its own files (`integrations/redis/*`).
            return folder !== undefined && target.startsWith(`${layer}/${folder}/`);
        };

        const visitor: Visitor = {
            ...importSourceVisitor(({ node, source }) => {
                if (source.startsWith('node:')) {
                    return;
                }
                let messageId: null | string;
                if (source.startsWith('.')) {
                    const target = pathInsideSrc(resolve(dirname(file), source));
                    messageId =
                        target === undefined || !allowsInternal(target) ? 'crossLayer' : null;
                } else {
                    messageId = allowsExternal(source) ? null : 'foreignDependency';
                }
                if (messageId !== null) {
                    context.report({ data: { layer, source }, messageId, node });
                }
            }),
        };
        return visitor;
    },
    meta: {
        defaultOptions: [{ layers: {} }],
        docs: RULE_DOCS['i1-layer-boundaries'],
        messages: {
            crossLayer:
                'Layer "{{layer}}" must not import "{{source}}" — outside the edges its layer map declares (I1 — see docs/13-linting.md).',
            foreignDependency:
                '"{{source}}" is not a dependency layer "{{layer}}" declares — one layer states the packages it may import (I1 — see docs/13-linting.md).',
        },
        schema: [
            {
                additionalProperties: false,
                properties: {
                    layers: {
                        additionalProperties: {
                            additionalProperties: false,
                            properties: {
                                folders: {
                                    additionalProperties: {
                                        items: { type: 'string' },
                                        type: 'array',
                                    },
                                    type: 'object',
                                },
                                imports: { items: { type: 'string' }, type: 'array' },
                                packages: { items: { type: 'string' }, type: 'array' },
                                seams: {
                                    additionalProperties: {
                                        items: { type: 'string' },
                                        type: 'array',
                                    },
                                    type: 'object',
                                },
                            },
                            type: 'object',
                        },
                        type: 'object',
                    },
                },
                type: 'object',
            },
        ],
        type: 'problem',
    },
};
