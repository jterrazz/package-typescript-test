import { dirname, join } from 'node:path';

import { findProperty, memberPropertyName, segments, stringValue, walk } from '../ast.js';
import { isDirectory, listDirectory } from '../fs-cache.js';
import { RULE_DOCS } from '../manifest.js';
import type { AstNode, LintRule, RuleContext, Visitor } from '../types.js';

/** The only directories a `contracts/` root may hold — the provider carriers. */
const PROVIDERS = new Set(['anthropic', 'http', 'openai']);

const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;
/** A file oxlint itself visits — the AST half of the rule reports on those. */
const SOURCE_FILE = /\.[cm]?[jt]sx?$/;
/** The public facade of a feature: `contracts/<kebab>.contracts.ts`. */
const COMPOSITE_FILE = /^[a-z0-9]+(?:-[a-z0-9]+)*\.contracts\.[cm]?ts$/u;
/** An internal unit contract: `contracts/<provider>/<kebab>.ts`. */
const UNIT_FILE = /^[a-z0-9]+(?:-[a-z0-9]+)*\.[cm]?ts$/u;
/** Matched data next to its contract: `contracts/<provider>/<stem>.request.ts`. */
const REQUEST_DATA_FILE = /^[a-z0-9]+(?:-[a-z0-9]+)*\.request\.[cm]?ts$/u;
/** Served data next to its contract: `contracts/<provider>/<stem>[.<qualifier>].response.json`. */
const RESPONSE_DATA_FILE = /\.response\.json$/;

/** The name a specifier/declaration exports under, when it is `default`. */
function exportsDefault(node: AstNode): boolean {
    const specifiers = (node.specifiers as AstNode[] | undefined) ?? [];
    return specifiers.some((specifier) => {
        const exported = specifier.exported as AstNode | undefined;
        return (
            (exported?.type === 'Identifier' && exported.name === 'default') ||
            stringValue(exported) === 'default'
        );
    });
}

/** Is this node a `defineContract(...)` call? */
function isDefineContract(node: AstNode): boolean {
    const callee = node.callee as AstNode | undefined;
    return (
        node.type === 'CallExpression' &&
        callee?.type === 'Identifier' &&
        callee.name === 'defineContract'
    );
}

/** A default export that may legitimately produce a contract (value or factory). */
function producesContract(declaration: AstNode | undefined): boolean {
    if (declaration === undefined) {
        return false;
    }
    return (
        isDefineContract(declaration) ||
        declaration.type === 'ArrowFunctionExpression' ||
        declaration.type === 'FunctionDeclaration' ||
        declaration.type === 'FunctionExpression' ||
        // `export default newsroomArticle` — the value is built above; the type
        // Channel (Contract) covers what the AST cannot follow here.
        declaration.type === 'Identifier'
    );
}

/**
 * The provider a `request:` value implies, when the builder is written as
 * `<provider>.<verb>(…)` — the only statically decidable form.
 */
function requestProvider(request: AstNode | undefined): string | undefined {
    if (request?.type !== 'CallExpression') {
        return undefined;
    }
    const callee = request.callee as AstNode | undefined;
    if (callee?.type !== 'MemberExpression') {
        return undefined;
    }
    const object = callee.object as AstNode | undefined;
    return object?.type === 'Identifier' ? (object.name as string) : undefined;
}

/**
 * The layout half — walks the feature's `contracts/` tree from the test file
 * that owns it. Covers what oxlint never visits: a stray `.json` at the root,
 * a directory that is not a provider, a nested folder or a foreign extension
 * inside a provider folder.
 */
function checkLayout(context: RuleContext, node: AstNode, contractsDir: string): void {
    const entries = listDirectory(contractsDir);
    if (entries === null) {
        return;
    }
    for (const entry of entries) {
        const path = join(contractsDir, entry);
        if (!isDirectory(path)) {
            // Source files at the root are reported on themselves (AST half).
            if (!SOURCE_FILE.test(entry)) {
                context.report({ data: { entry }, messageId: 'rootEntry', node });
            }
            continue;
        }
        if (!PROVIDERS.has(entry)) {
            context.report({ data: { entry }, messageId: 'badProviderDir', node });
            continue;
        }
        for (const child of listDirectory(path) ?? []) {
            if (isDirectory(join(path, child))) {
                context.report({
                    data: { child, provider: entry },
                    messageId: 'providerSubfolder',
                    node,
                });
            } else if (!/\.[cm]?ts$/u.test(child) && !RESPONSE_DATA_FILE.test(child)) {
                context.report({
                    data: { child, provider: entry },
                    messageId: 'providerEntry',
                    node,
                });
            }
        }
    }
}

/** The facade: `<kebab>.contracts.ts`, default-exporting a composition. */
function checkComposite(context: RuleContext, program: AstNode, base: string): void {
    if (!COMPOSITE_FILE.test(base)) {
        context.report({ data: { base }, messageId: 'rootFile', node: program });
        return;
    }
    let hasDefault = false;
    let composed = false;
    walk(program, (node) => {
        if (node.type === 'ExportDefaultDeclaration') {
            hasDefault = true;
        } else if (node.type === 'ExportAllDeclaration' || node.type === 'ExportNamedDeclaration') {
            if (exportsDefault(node)) {
                hasDefault = true;
                // `export { default } from './other.contracts.js'` — a
                // Composition re-export is a legitimate way to build the world.
                composed =
                    stringValue(node.source as AstNode | undefined) !== undefined || composed;
            }
        } else if (node.type === 'CallExpression') {
            const callee = node.callee as AstNode | undefined;
            if (
                (callee?.type === 'Identifier' && callee.name === 'defineContracts') ||
                (callee !== undefined && memberPropertyName(callee) === 'with')
            ) {
                composed = true;
            }
        }
    });
    if (!hasDefault) {
        context.report({ data: { base }, messageId: 'missingComposite', node: program });
    } else if (!composed) {
        context.report({ data: { base }, messageId: 'notDefineContracts', node: program });
    }
}

/** A unit contract under its provider folder. */
function checkUnit(context: RuleContext, program: AstNode, base: string, provider: string): void {
    if (REQUEST_DATA_FILE.test(base)) {
        return; // Matched data (a prompt, an expected body) — it exports a value.
    }
    if (!UNIT_FILE.test(base)) {
        context.report({ data: { base }, messageId: 'badName', node: program });
        return;
    }
    let hasDefault = false;
    let wellFormed = false;
    walk(program, (node) => {
        if (node.type === 'ExportDefaultDeclaration') {
            hasDefault = true;
            wellFormed = producesContract(node.declaration as AstNode | undefined) || wellFormed;
        } else if (node.type === 'ExportNamedDeclaration' && exportsDefault(node)) {
            hasDefault = true;
            wellFormed = true; // `export { contract as default }` — built above.
        }
        if (isDefineContract(node)) {
            const argument = (node.arguments as AstNode[] | undefined)?.[0];
            const request =
                argument === undefined
                    ? undefined
                    : (findProperty(argument, 'request')?.value as AstNode | undefined);
            const declared = requestProvider(request);
            if (declared !== undefined && PROVIDERS.has(declared) && declared !== provider) {
                context.report({
                    data: { declared, provider },
                    messageId: 'providerMismatch',
                    node,
                });
            }
        }
    });
    if (!hasDefault) {
        context.report({ data: { base }, messageId: 'missingDefault', node: program });
    } else if (!wellFormed) {
        context.report({ data: { base }, messageId: 'notDefineContract', node: program });
    }
}

/**
 * CONVENTIONS C4 — the structure of a feature's `contracts/` tree. The ROOT
 * holds only `*.contracts.ts` facades (default export = a `defineContracts`
 * composition, named exports = scenario factories) and the provider
 * directories `http` / `openai` / `anthropic`. A provider directory holds
 * `<kebab>.ts` unit contracts (default export = `defineContract(...)` or a
 * factory returning one) plus their sibling data (`*.response.json`,
 * `*.request.ts`) — the FOLDER carries the provider, so a unit whose `request`
 * builder names another provider is an error.
 *
 * Two halves: the AST half reports on each contract file it visits, the layout
 * half walks the tree from the feature's test file (oxlint never visits a
 * `.json` fixture or an empty directory).
 */
export const c4ContractShape: LintRule = {
    create(context: RuleContext): Visitor {
        const file = context.physicalFilename;
        const parts = segments(file);
        // `src/**/contracts/` is the framework's own contract MODULE, not a
        // Feature's contract tree — only specs carry the convention.
        if (!parts.includes('specs')) {
            return {};
        }
        const contractsIndex = parts.lastIndexOf('contracts');
        if (contractsIndex === -1) {
            if (!TEST_FILE.test(file)) {
                return {};
            }
            return {
                Program(node: AstNode) {
                    checkLayout(context, node, join(dirname(file), 'contracts'));
                },
            };
        }
        const base = parts.at(-1) ?? '';
        const depth = parts.length - 1 - contractsIndex;
        if (depth === 1) {
            return {
                Program(node: AstNode) {
                    checkComposite(context, node, base);
                },
            };
        }
        if (depth === 2) {
            const provider = parts[contractsIndex + 1];
            // A non-provider directory is reported once, by the layout half.
            return PROVIDERS.has(provider)
                ? {
                      Program(node: AstNode) {
                          checkUnit(context, node, base, provider);
                      },
                  }
                : {};
        }
        return {
            Program(node: AstNode) {
                context.report({ data: { base }, messageId: 'tooDeep', node });
            },
        };
    },
    meta: {
        docs: RULE_DOCS['c4-contract-shape'],
        messages: {
            badName:
                'Contract unit "{{base}}" must be named <kebab-name>.ts — the folder already carries the provider (C4 — see docs/13-linting.md).',
            badProviderDir:
                'contracts/{{entry}}/ is not a provider directory — a contracts/ root holds only http/, openai/, anthropic/ and *.contracts.ts files (C4 — see docs/13-linting.md).',
            missingComposite:
                'Contract facade "{{base}}" has no default export — it must default-export the composed world (C4 — see docs/13-linting.md).',
            missingDefault:
                'Contract unit "{{base}}" has no default export — a unit default-exports `defineContract(...)` or a factory returning one (C4 — see docs/13-linting.md).',
            notDefineContract:
                'The default export of a contract unit must be `defineContract(...)` or a factory returning a contract (C4 — see docs/13-linting.md).',
            notDefineContracts:
                'The default export of "{{base}}" must be built from `defineContracts(...)` (or a composition re-export) (C4 — see docs/13-linting.md).',
            providerEntry:
                'contracts/{{provider}}/{{child}} is neither a *.ts contract nor a *.response.json payload (C4 — see docs/13-linting.md).',
            providerMismatch:
                'This contract lives in contracts/{{provider}}/ but its request is a `{{declared}}.*` builder — the folder carries the provider (C4 — see docs/13-linting.md).',
            providerSubfolder:
                'contracts/{{provider}}/{{child}}/ is nested — a provider folder is flat (C4 — see docs/13-linting.md).',
            rootEntry:
                'contracts/{{entry}} is not a *.contracts.ts facade — data files live in a provider folder next to their contract (C4 — see docs/13-linting.md).',
            rootFile:
                'Contract file "{{base}}" sits at the contracts/ root, which holds only *.contracts.ts facades — a unit contract belongs in http/, openai/ or anthropic/ (C4 — see docs/13-linting.md).',
            tooDeep:
                'Contract file "{{base}}" is nested deeper than contracts/<provider>/ (C4 — see docs/13-linting.md).',
        },
        type: 'problem',
    },
};
