import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';

import {
    assertedStreams,
    DOCUMENT_KEYS,
    readSpecFile,
    RUN_KEYS,
    SPEC_EXTENSION,
    type SpecDocument,
    type SpecFile,
} from '../core/literate/spec-document.js';
import { resolveFixtureSource } from '../core/specification/shared/fixtures.js';
import { GROUND_FIXTURES } from '../core/specification/shared/ground.js';
import {
    isMap,
    isScalar,
    isSeq,
    type Node,
    type Pair,
    renderYamlSource,
    Scalar,
    type YAMLMap,
} from '../integrations/yaml/document.js';
import type { Severity, TokenViolation } from './checker.js';

/**
 * The `<case>.spec.yaml` conventions — the checker passes that judge a document
 * beyond its grammar.
 *
 * The grammar pass (`d4b-spec-shape`, in `checker.ts`) answers "can the runner
 * execute this?". These answer the questions a reader asks afterwards: is it
 * where it says it is, does it read in one order, does it assert something, and
 * is what it asserts still true tomorrow. Each pass exists because a defect
 * class was found by hand first; the header of each names it.
 *
 * Two of them are FIXABLE — key order and block scalars — because the writer
 * can rewrite them without judgment: the same `yaml` document round trip update
 * mode already relies on puts the keys back in order and re-styles a stream,
 * comments and everything else intact.
 */

// ── Shared ──

/** A violation before it knows its file — the passes below return these. */
interface Finding {
    line: number;
    message: string;
    /** The catalogue pass this finding belongs to, named in the message. */
    rule: string;
    severity: Severity;
}

function finding(
    rule: string,
    line: number,
    message: string,
    severity: Severity = 'error',
): Finding {
    return { line, message, rule, severity };
}

/** Directories the walks never enter — `_fixtures/` holds INPUTS, never scenarios. */
const PRUNED = new Set<string>(['.git', 'dist', GROUND_FIXTURES, 'node_modules']);

function listSpecFiles(dir: string): string[] {
    const out: string[] = [];
    const visit = (current: string): void => {
        let entries;
        try {
            entries = readdirSync(current, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const path = join(current, entry.name);
            if (entry.isDirectory()) {
                if (!PRUNED.has(entry.name)) {
                    visit(path);
                }
            } else if (entry.name.endsWith(SPEC_EXTENSION)) {
                out.push(path);
            }
        }
    };
    visit(dir);
    return out;
}

function readText(path: string): string {
    try {
        return readFileSync(path, 'utf8');
    } catch {
        return '';
    }
}

// ── The YAML view (styles and key order live only in the AST) ──

function documentMap(file: SpecFile): null | YAMLMap {
    const root = file.source.document.contents;
    return isMap(root) ? root : null;
}

function pairsOf(map: YAMLMap): Pair<Node, Node>[] {
    return map.items as Pair<Node, Node>[];
}

function keyName(pair: Pair<Node, Node>): null | string {
    return isScalar(pair.key) && typeof pair.key.value === 'string' ? pair.key.value : null;
}

function runMaps(file: SpecFile): YAMLMap[] {
    const map = documentMap(file);
    const runs = map?.get('runs', true);
    return isSeq(runs) ? (runs.items as Node[]).filter((item) => isMap(item)) : [];
}

/** The stream scalars of one run — the values the block-scalar rule judges. */
function streamScalars(run: YAMLMap): { key: string; scalar: Scalar }[] {
    const found: { key: string; scalar: Scalar }[] = [];
    for (const pair of pairsOf(run)) {
        const key = keyName(pair);
        if (key === null) {
            continue;
        }
        if (['stderr', 'stdin', 'stdout'].includes(key) && isScalar(pair.value)) {
            found.push({ key, scalar: pair.value });
            continue;
        }
        if (key !== 'files' || !isMap(pair.value)) {
            continue;
        }
        for (const entry of pairsOf(pair.value)) {
            if (!isMap(entry.value)) {
                continue;
            }
            for (const assertion of pairsOf(entry.value)) {
                if (keyName(assertion) === 'equals' && isScalar(assertion.value)) {
                    found.push({
                        key: `files.${keyName(entry) ?? '?'}.equals`,
                        scalar: assertion.value,
                    });
                }
            }
        }
    }
    return found;
}

function isBlock(scalar: Scalar): boolean {
    return String(scalar.type ?? '').startsWith('BLOCK');
}

// ── d4b-spec-key-order ──

/**
 * The canonical order, top level and inside a run: the ground a session stands
 * on before the session, what was given to a command before what came back.
 * Two authors ordering differently make an unreadable diff out of an unchanged
 * document; a `runs:` above `env:` makes a reader meet the session before its
 * setup.
 */
function checkKeyOrder(file: SpecFile, lineAt: (node: Pair<Node, Node>) => number): Finding[] {
    const findings: Finding[] = [];
    const inspect = (map: YAMLMap, order: readonly string[], where: string): void => {
        let highest = -1;
        let highestKey = '';
        for (const pair of pairsOf(map)) {
            const key = keyName(pair);
            const rank = key === null ? -1 : order.indexOf(key);
            if (rank === -1) {
                continue;
            }
            if (rank < highest) {
                findings.push(
                    finding(
                        'd4b-spec-key-order',
                        lineAt(pair),
                        `"${key}:" comes after "${highestKey}:" in ${where} — the canonical order is ${order.join(', ')} (fixable: \`node dist/checker.js <root> --fix\`)`,
                    ),
                );
                return;
            }
            highest = rank;
            highestKey = key ?? '';
        }
    };
    const map = documentMap(file);
    if (map !== null) {
        inspect(map, DOCUMENT_KEYS, 'a spec document');
    }
    for (const run of runMaps(file)) {
        inspect(run, RUN_KEYS, 'a run');
    }
    return findings;
}

// ── d4b-spec-block-scalar ──

/**
 * A stream is written as a block scalar (`|` or `|-`), never as a quoted string
 * with `\n` escapes. A one-line golden is unreadable, and no diff can show it:
 * the whole point of the format is that the expected output looks like output.
 */
function checkBlockScalars(file: SpecFile, lineOf: (scalar: Scalar) => number): Finding[] {
    const findings: Finding[] = [];
    for (const run of runMaps(file)) {
        for (const { key, scalar } of streamScalars(run)) {
            if (isBlock(scalar) || scalar.value === '') {
                continue;
            }
            findings.push(
                finding(
                    'd4b-spec-block-scalar',
                    lineOf(scalar),
                    `${key} is a ${scalar.type === Scalar.PLAIN ? 'plain' : 'quoted'} scalar — a stream is written as a block scalar (\`|\` keeps the final newline, \`|-\` drops it) (fixable: \`node dist/checker.js <root> --fix\`)`,
                ),
            );
        }
    }
    return findings;
}

// ── c12-spec-file-name ──

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Words the `.spec.yaml` suffix already says — a case name repeating one says nothing. */
const REDUNDANT_WORDS = new Set(['cli', 'spec', 'test']);

/**
 * The file is `<case>.spec.yaml`, and `<case>` NAMES the case: kebab-case, no
 * word the suffix already carries, and never the bare name of its directory —
 * a `rm/` folder holding `rm.spec.yaml` says nothing twice, where `removed`,
 * `unattended` and `missing` each say one thing.
 */
function checkFileName(rel: string): Finding[] {
    const name = basename(rel);
    const caseName = name.slice(0, -SPEC_EXTENSION.length);
    const findings: Finding[] = [];
    if (!KEBAB.test(caseName)) {
        findings.push(
            finding(
                'c12-spec-file-name',
                1,
                `"${name}" — <case> is kebab-case: lowercase words joined by single hyphens`,
            ),
        );
        return findings;
    }
    const redundant = caseName.split('-').filter((word) => REDUNDANT_WORDS.has(word));
    if (redundant.length > 0) {
        findings.push(
            finding(
                'c12-spec-file-name',
                1,
                `"${name}" repeats "${redundant[0]}" — the .spec.yaml suffix already says it; name the CASE instead`,
            ),
        );
    }
    const folder = basename(dirname(rel));
    if (caseName === folder) {
        findings.push(
            finding(
                'c12-spec-file-name',
                1,
                `"${name}" repeats its directory "${folder}/" — name what this case proves, not where it sits`,
            ),
        );
    }
    return findings;
}

// ── j5-spec-description ──

const MAX_DESCRIPTION = 100;
/** A first word that is an identifier, not prose — exempt from the lowercase rule. */
const SYMBOL_WORD = /^[A-Z0-9_]+$/;

/**
 * The description IS the vitest test title, and it is held to the title rules:
 * one lowercase line of prose, no trailing period, short enough to read in a
 * runner's output. A title that is a paragraph is a comment in the wrong place.
 */
function checkDescription(document: SpecDocument): Finding[] {
    const findings: Finding[] = [];
    const text = document.description;
    const line = document.descriptionLine;
    const at = (message: string): Finding => finding('j5-spec-description', line, message);
    if (text.includes('\n')) {
        findings.push(at('description: is one line — the vitest title, not a paragraph'));
        return findings;
    }
    if (text.length > MAX_DESCRIPTION) {
        findings.push(
            at(`description: is ${text.length} characters — keep it under ${MAX_DESCRIPTION}`),
        );
    }
    if (text.endsWith('.')) {
        findings.push(
            at('description: ends with a period — a title is a fragment, not a sentence'),
        );
    }
    const first = text.split(/\s+/)[0] ?? '';
    if (/^[A-Z]/.test(text) && !SYMBOL_WORD.test(first)) {
        findings.push(at('description: starts with a capital — a title is lowercase prose'));
    }
    return findings;
}

// ── d5-spec-volatile-literal ──

/** The literals the update writer must have failed to tokenise, and their token. */
const VOLATILE = [
    {
        pattern: /\b(?:127\.0\.0\.1|localhost|0\.0\.0\.0):\d{2,5}\b/,
        token: '{{url}} (or {{port}})',
    },
    { pattern: /(?:^|[\s"'(=])(?:\/private)?\/tmp\//, token: '{{workdir}}' },
    { pattern: /(?:^|[\s"'(=])\/var\/folders\//, token: '{{workdir}}' },
    { pattern: /(?:^|[\s"'(=])\/(?:Users|home)\/[^\s"'/]+\//, token: '{{workdir}} or {{path}}' },
] as const;

/**
 * A stream that pins a loopback port, a temp directory or somebody's home is a
 * golden that passed once, on one machine: the port was free that second, the
 * temp path belonged to that run. It is the exact shape of a value the update
 * writer would have tokenised, which is why finding one means a token was
 * overwritten by hand.
 */
function checkVolatileLiterals(document: SpecDocument): Finding[] {
    const findings: Finding[] = [];
    for (const stream of assertedStreams(document)) {
        for (const [index, text] of stream.text.split('\n').entries()) {
            for (const { pattern, token } of VOLATILE) {
                const found = pattern.exec(text);
                if (found === null) {
                    continue;
                }
                findings.push(
                    finding(
                        'd5-spec-volatile-literal',
                        stream.line + index,
                        `"${found[0].trim()}" is a value the next run will not reproduce — write ${token}`,
                    ),
                );
                break;
            }
        }
    }
    return findings;
}

// ── d5w-spec-pinned-value ──

const ISO8601 = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/;
const UUID = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;

/** Everything the document itself FIXED: what it feeds in, and what its fixtures hold. */
function fixedData(document: SpecDocument, dir: string): string {
    const parts = document.runs.map((run) => run.stdin ?? '');
    for (const fixture of document.fixtures) {
        let source;
        try {
            source = resolveFixtureSource(fixture.path, dir);
        } catch {
            continue;
        }
        const visit = (path: string): void => {
            let stat;
            try {
                stat = statSync(path);
            } catch {
                return;
            }
            if (!stat.isDirectory()) {
                parts.push(readText(path));
                return;
            }
            for (const entry of readdirSync(path)) {
                visit(join(path, entry));
            }
        };
        visit(source);
    }
    return parts.join('\n');
}

/**
 * A timestamp or a uuid spelled out in a golden is a value nothing fixed —
 * unless the document DID fix it, by feeding it in through `stdin:` or shipping
 * it in a `fixture:`. That carve-out is the whole rule: the defect is not the
 * literal, it is the literal nobody pinned.
 */
function checkPinnedValues(document: SpecDocument, dir: string): Finding[] {
    const findings: Finding[] = [];
    const streams = assertedStreams(document);
    if (streams.length === 0) {
        return findings;
    }
    let fixed: null | string = null;
    for (const stream of streams) {
        for (const [index, text] of stream.text.split('\n').entries()) {
            for (const [pattern, token] of [
                [ISO8601, '{{iso8601}}'],
                [UUID, '{{uuid}}'],
            ] as const) {
                const found = pattern.exec(text);
                if (found === null) {
                    continue;
                }
                fixed ??= fixedData(document, dir);
                if (fixed.includes(found[0])) {
                    continue;
                }
                findings.push(
                    finding(
                        'd5w-spec-pinned-value',
                        stream.line + index,
                        `"${found[0]}" is not fixed by any fixture: or stdin: of this document — write ${token}`,
                        'warn',
                    ),
                );
            }
        }
    }
    return findings;
}

// ── j3w-spec-empty-assertion ──

/**
 * A stream whose entire content is `{{any}}` states that the command printed
 * something, or nothing, of any shape — which is what a stream does anyway. The
 * run happens and proves nothing.
 */
function checkEmptyAssertions(document: SpecDocument): Finding[] {
    const findings: Finding[] = [];
    for (const stream of assertedStreams(document)) {
        if (
            stream.text.replaceAll('{{any}}', '').trim() === '' &&
            stream.text.includes('{{any}}')
        ) {
            findings.push(
                finding(
                    'j3w-spec-empty-assertion',
                    stream.line,
                    'a stream that is only {{any}} asserts nothing — golden what the command actually printed',
                    'warn',
                ),
            );
        }
    }
    return findings;
}

// ── d11w-spec-silent-refusal ──

/**
 * A non-zero exit with neither stream is a CLI that failed without a word — or,
 * far more often, a golden whose author forgot that the words went to stderr.
 * Either way the document does not say WHY the command refused.
 */
function checkSilentRefusals(document: SpecDocument): Finding[] {
    return document.runs
        .filter((run) => run.exitCode !== 0 && run.stdout === null && run.stderr === null)
        .map((run) =>
            finding(
                'd11w-spec-silent-refusal',
                run.commandLine,
                `exit: ${run.exitCode} with no stdout: and no stderr: — golden the words the refusal printed`,
                'warn',
            ),
        );
}

// ── c8-spec-registered-name ──

/** The top-level keys of an object literal, read by depth, not by parsing. */
function objectKeys(source: string, from: number): { end: number; keys: string[] } {
    const keys: string[] = [];
    let depth = 0;
    let quote = '';
    for (let index = from; index < source.length; index += 1) {
        const char = source[index];
        if (quote !== '') {
            if (char === quote && source[index - 1] !== '\\') {
                quote = '';
            }
            continue;
        }
        if (char === "'" || char === '"' || char === '`') {
            quote = char;
            continue;
        }
        if (char === '{' || char === '[' || char === '(') {
            depth += 1;
            continue;
        }
        if (char === '}' || char === ']' || char === ')') {
            depth -= 1;
            if (depth === 0) {
                return { end: index, keys };
            }
            continue;
        }
        if (depth === 1 && /[A-Za-z_$'"]/.test(char)) {
            const rest = /^(?<quote>['"]?)(?<name>[A-Za-z_$][\w$]*)\k<quote>\s*:/.exec(
                source.slice(index),
            );
            if (rest?.groups) {
                keys.push(rest.groups.name);
                index += rest[0].length - 1;
            }
        }
    }
    return { end: source.length, keys };
}

/**
 * The `env` and `serve` names registered by the `specification.cli(…)` calls of
 * the nearest directory holding a `*.specification.ts`, read as literals. A
 * directory may declare several runners, and nothing in a document says which
 * one runs it, so their registries are read as a UNION: a name known to any
 * neighbouring runner passes, and only a name known to none is a typo.
 */
function registeredNames(dir: string): null | { env: Set<string>; serve: Set<string> } {
    let current = dir;
    for (;;) {
        let entries: string[];
        try {
            entries = readdirSync(current).filter((name) => name.endsWith('.specification.ts'));
        } catch {
            entries = [];
        }
        if (entries.length > 0) {
            const env = new Set<string>();
            const serve = new Set<string>();
            for (const entry of entries) {
                const text = readText(join(current, entry));
                for (const call of text.matchAll(/specification\.cli\s*\(/g)) {
                    const open = text.indexOf('{', call.index + call[0].length);
                    if (open === -1) {
                        continue;
                    }
                    const options = objectKeys(text, open);
                    for (const [key, into] of [
                        ['env', env],
                        ['serve', serve],
                    ] as const) {
                        const marker = new RegExp(String.raw`\b${key}\s*:\s*\{`).exec(
                            text.slice(open, options.end),
                        );
                        if (marker === null) {
                            continue;
                        }
                        const at = open + marker.index + marker[0].length - 1;
                        for (const name of objectKeys(text, at).keys) {
                            into.add(name);
                        }
                    }
                }
            }
            return { env, serve };
        }
        const parent = dirname(current);
        if (parent === current) {
            return null;
        }
        current = parent;
    }
}

/**
 * Every bare word of `env:` and every `serve:` name must be a key of a runner
 * registered above the document. A typo (`serve: dashbord`) is a refusal at
 * run time today, one test file into a suite; here it is a line in a lint run.
 */
function checkRegisteredNames(document: SpecDocument, dir: string): Finding[] {
    if (document.env.length === 0 && document.serve.length === 0) {
        return [];
    }
    const registered = registeredNames(dir);
    if (registered === null) {
        return [];
    }
    const findings: Finding[] = [];
    for (const token of document.env) {
        if (token.kind === 'set' && !registered.env.has(token.name)) {
            findings.push(
                finding(
                    'c8-spec-registered-name',
                    token.line,
                    `env: "${token.name}" is not a registered env set${registered.env.size === 0 ? '' : ` — registered: ${[...registered.env].sort().join(', ')}`}`,
                ),
            );
        }
    }
    for (const entry of document.serve) {
        if (!registered.serve.has(entry.name)) {
            findings.push(
                finding(
                    'c8-spec-registered-name',
                    entry.line,
                    `serve: "${entry.name}" is not a registered server${registered.serve.size === 0 ? '' : ` — registered: ${[...registered.serve].sort().join(', ')}`}`,
                ),
            );
        }
    }
    return findings;
}

// ── Entry ──

/**
 * Run every document-conventions pass over one `<case>.spec.yaml`. A document
 * the grammar refuses yields NOTHING here: `d4b-spec-shape` already reported
 * it, and a second cascade of findings about a file nobody can parse only
 * buries the one line that matters.
 */
export function checkSpecConventions(text: string, rel: string, path: string): TokenViolation[] {
    let file: SpecFile;
    try {
        file = readSpecFile(text, rel);
    } catch {
        return [];
    }
    const lineAt = (node: Pair<Node, Node> | Scalar): number => {
        const range = 'range' in node && Array.isArray(node.range) ? node.range : undefined;
        const key = (node as Pair<Node, Node>).key;
        const target = range ?? (isScalar(key) && Array.isArray(key.range) ? key.range : undefined);
        return target === undefined ? 1 : file.source.lineAt(target[0]);
    };
    const dir = dirname(path);
    const findings = [
        ...checkKeyOrder(file, (pair) => lineAt(pair.key as unknown as Scalar)),
        ...checkBlockScalars(file, (scalar) => lineAt(scalar)),
        ...checkFileName(rel),
        ...checkDescription(file.document),
        ...checkVolatileLiterals(file.document),
        ...checkPinnedValues(file.document, dir),
        ...checkEmptyAssertions(file.document),
        ...checkSilentRefusals(file.document),
        ...checkRegisteredNames(file.document, dir),
    ];
    return findings.map(({ line, message, rule, severity }) => ({
        file: rel,
        line,
        message: `${rel}:${line}: ${message} (${rule} — see docs/13-linting.md)`,
        severity,
    }));
}

/**
 * J4-spec-description-unique — the description is the test title, and two
 * documents in one directory sharing it make a failing run ambiguous: the
 * reporter names the title, and the reader has two files to open.
 */
export function checkSpecDescriptionsUnique(rootDir: string): TokenViolation[] {
    const byDirectory = new Map<string, Map<string, string>>();
    const violations: TokenViolation[] = [];
    for (const path of listSpecFiles(rootDir)) {
        let document;
        try {
            document = readSpecFile(readText(path), path).document;
        } catch {
            continue;
        }
        const dir = dirname(path);
        const seen = byDirectory.get(dir) ?? new Map<string, string>();
        byDirectory.set(dir, seen);
        const first = seen.get(document.description);
        const rel = relative(rootDir, path);
        if (first === undefined) {
            seen.set(document.description, rel);
            continue;
        }
        violations.push({
            file: rel,
            line: document.descriptionLine,
            message: `${rel}:${document.descriptionLine}: "${document.description}" is already the description of ${first} — two documents of one directory cannot share a title (j4-spec-description-unique — see docs/13-linting.md)`,
            severity: 'error',
        });
    }
    return violations;
}

// ── Fix ──

/**
 * Apply the two fixable passes to one document: reorder its keys, and re-style
 * every stream as a block scalar. Returns `null` when nothing moved — the
 * caller writes only what changed, so a clean tree keeps its mtimes.
 */
export function fixSpecDocument(text: string, rel: string): null | string {
    let file: SpecFile;
    try {
        file = readSpecFile(text, rel);
    } catch {
        return null;
    }
    const reorder = (map: YAMLMap, order: readonly string[]): void => {
        const known = pairsOf(map).filter((pair) => order.includes(keyName(pair) ?? ''));
        const sorted = [...known].sort(
            (a, b) => order.indexOf(keyName(a)!) - order.indexOf(keyName(b)!),
        );
        let cursor = 0;
        map.items = pairsOf(map).map((pair) =>
            order.includes(keyName(pair) ?? '') ? sorted[cursor++] : pair,
        );
    };
    const map = documentMap(file);
    if (map === null) {
        return null;
    }
    reorder(map, DOCUMENT_KEYS);
    for (const run of runMaps(file)) {
        reorder(run, RUN_KEYS);
        for (const { scalar } of streamScalars(run)) {
            if (!isBlock(scalar) && scalar.value !== '') {
                scalar.type = Scalar.BLOCK_LITERAL;
            }
        }
    }
    const next = renderYamlSource(file.source);
    return next === text ? null : next;
}

/** Fix every `<case>.spec.yaml` under `rootDir`; returns the paths rewritten. */
export function fixSpecFiles(rootDir: string): string[] {
    const written: string[] = [];
    for (const path of listSpecFiles(rootDir)) {
        const text = readText(path);
        const next = fixSpecDocument(text, relative(rootDir, path));
        if (next !== null) {
            writeFileSync(path, next);
            written.push(relative(rootDir, path));
        }
    }
    return written;
}
