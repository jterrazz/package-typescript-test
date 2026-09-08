import { importSourceVisitor, segments } from '../ast.js';
import { RULE_DOCS } from '../manifest.js';
import type { AstNode, LintRule, RuleContext, Visitor } from '../types.js';

const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;

/**
 * Known DATA extensions — the closed list of what counts as a file asset. The
 * classification is an allowlist, never "has a dot": a module specifier is
 * routinely dotted for reasons that have nothing to do with a file type
 * (`../entities/dashboard.post`, `@scope/kernel/plugin.registry`), and reading
 * those as assets flagged perfectly ordinary code imports.
 */
const DATA_EXTENSIONS = [
    'avif',
    'bin',
    'bmp',
    'csv',
    'gif',
    'graphql',
    'gql',
    'gz',
    'htm',
    'html',
    'ico',
    'ini',
    'jpeg',
    'jpg',
    'json',
    'json5',
    'jsonc',
    'jsonl',
    'md',
    'mdx',
    'ndjson',
    'pdf',
    'png',
    'proto',
    'sql',
    'svg',
    'tar',
    'toml',
    'tsv',
    'txt',
    'wasm',
    'webp',
    'xml',
    'yaml',
    'yml',
    'zip',
];
const DATA_ASSET = new RegExp(`\\.(?:${DATA_EXTENSIONS.join('|')})$`, 'i');

/** A bundler suffix (`./payload.json?raw`, `./doc.md#frag`) is not part of the extension. */
function withoutSuffix(source: string): string {
    return source.replace(/[?#].*$/, '');
}

/**
 * CONVENTIONS I4 — in module tests under `src/`, mocks and data are CODE:
 * `mockOf`/`mockOfDate` inline, large payloads in a `*.fixtures.ts` neighbour.
 * Flags, under `src/`:
 *
 * - `vi.mock(…)` calls (module mocking) in any file;
 * - files living in a `__mocks__/` or `__fixtures__/` directory;
 * - a `*.test.ts` importing a known data asset (`.json`, `.txt`, `.sql`, …) —
 *   a test needing a real file is a specification and belongs in `specs/`.
 *
 * A specifier whose extension is not on the data list is CODE, dotted or not:
 * `<subject>.<role>` module names are a naming convention, not a file type.
 */
export const i4NoViMockInSrc: LintRule = {
    create(context: RuleContext) {
        const parts = segments(context.filename);
        if (!parts.includes('src')) {
            return {};
        }
        const banned = parts.find((part) => part === '__mocks__' || part === '__fixtures__');
        const isTest = TEST_FILE.test(context.filename);
        const visitor: Visitor = {
            CallExpression(node: AstNode) {
                const callee = node.callee as AstNode | undefined;
                if (callee?.type !== 'MemberExpression' || callee.computed === true) {
                    return;
                }
                const object = callee.object as AstNode | undefined;
                const property = callee.property as AstNode | undefined;
                if (
                    object?.type === 'Identifier' &&
                    object.name === 'vi' &&
                    property?.type === 'Identifier' &&
                    (property.name === 'mock' || property.name === 'doMock')
                ) {
                    context.report({ messageId: 'viMock', node });
                }
            },
            Program(node: AstNode) {
                if (banned !== undefined) {
                    context.report({ data: { dir: banned }, messageId: 'bannedDir', node });
                }
            },
        };
        if (isTest) {
            Object.assign(
                visitor,
                importSourceVisitor(({ node, source }) => {
                    if (DATA_ASSET.test(withoutSuffix(source))) {
                        context.report({ data: { source }, messageId: 'assetImport', node });
                    }
                }),
            );
        }
        return visitor;
    },
    meta: {
        docs: RULE_DOCS['i4-no-vi-mock-in-src'],
        messages: {
            assetImport:
                'A src/ module test must not import the data asset "{{source}}" — inline it as code or move the test to specs/ (I4 — see docs/13-linting.md).',
            bannedDir:
                '`{{dir}}/` directories are banned under src/ — mocks and data are code: mockOf/mockOfDate inline, payloads in a *.fixtures.ts neighbour (I4 — see docs/13-linting.md).',
            viMock: '`vi.mock` is banned under src/ — use mockOf/mockOfDate (I4 — see docs/13-linting.md).',
        },
        type: 'problem',
    },
};
