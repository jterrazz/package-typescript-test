import {
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    renameSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';

import { parseSpecDocument, SPEC_EXTENSION } from '../core/literate/spec-document.js';
import { GROUND_DIRS, GROUND_FIXTURES } from '../core/specification/shared/ground.js';
import type { Severity, TokenViolation } from './checker.js';

/**
 * The cross-file checker passes — the analyses oxlint cannot express because
 * they need to read TWO files at once (a `*.specification.ts` record and the
 * `specs/` test files importing it) or a whole feature tree at once.
 *
 * They live in the checker channel (bundled as `dist/checker.js`) rather than
 * the oxlint plugin, which only ever sees one source file. Each pass follows
 * the checker doctrine: **precision over recall** — a heuristic that cannot
 * decide stays silent (under-reports) so the pass never blocks a legitimate
 * shape. All three are string/scan based (no TS parser in the light lint
 * bundle), matching the token checker's aesthetic.
 *
 * - **C9 dead fixtures** — per feature dir, a fixture file no test literal
 *   references is dead weight; a feature dir with ground subdirs but no
 *   `<feature>.test.ts` is an orphan. A `<case>.spec.yaml` counts as a test
 *   AND as a referrer: the paths of its `fixture:` entries keep those trees
 *   alive exactly as a `.fixture('…')` literal does.
 * - **B5 await-using (inference)** — the docker-aware runners of a spec file
 *   are derived from its `docker:` option, then every `<runner>….exec()` bound
 *   without `await using` in an importing test is flagged. The primary B5
 *   channel now (the oxlint rule needs the runner names spelled out by hand).
 * - **A7 database property** — a spec's `services:` record fixes how many SQL
 *   databases exist; importing tests must (≥2) or must not (==1) pass
 *   `{ database }` to every `.seed()` / `.table()`.
 * - **C14 / C15 where a fixture lives** — a pool entry only ONE spec directory
 *   reaches for belongs beside that leaf (autofixed), and a leaf's own fixture
 *   path may not escape its own `_fixtures/`.
 */

/** Directories the cross-file walks never descend into. */
const PRUNED = new Set(['.git', 'dist', 'node_modules']);

/** The ground directories of a leaf — the files a spec stands on. */
const GROUND_SUBDIRS = new Set<string>(GROUND_DIRS);

/** Destructured names that are never a runner (so never the A7/B5 subject). */
const NON_RUNNER_BINDINGS = new Set(['cleanup', 'docker', 'orchestrator']);

/** The specification constructors whose records/options the passes read. */
const CONSTRUCTORS = 'api|cli|jobs';

/**
 * A `$FIXTURES` pool (`.../specs/_fixtures`) is verbatim fixture material — the
 * reusable apps AND the lint-violation trees that fail on purpose — never live
 * specs. The cross-file walks prune it (like the token checker skips
 * `_fixtures/`); {@link checkPoolFixtures} inspects its top level separately.
 */
function isPool(dir: string): boolean {
    return basename(dir) === GROUND_FIXTURES && basename(dirname(dir)) === 'specs';
}

/** Recursively list every file under `dir`, skipping pruned dirs and the pool. */
function listFiles(dir: string, predicate: (path: string) => boolean): string[] {
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
                if (!PRUNED.has(entry.name) && !isPool(path)) {
                    visit(path);
                }
            } else if (predicate(path)) {
                out.push(path);
            }
        }
    };
    visit(dir);
    return out;
}

/** Recursively list every directory under `dir` (inclusive), pool pruned. */
function listDirs(dir: string): string[] {
    const out: string[] = [];
    const visit = (current: string): void => {
        out.push(current);
        let entries;
        try {
            entries = readdirSync(current, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const path = join(current, entry.name);
            if (entry.isDirectory() && !PRUNED.has(entry.name) && !isPool(path)) {
                visit(path);
            }
        }
    };
    visit(dir);
    return out;
}

/**
 * Locate every `specs/` root under `dir` — the anchor a fixture path is
 * measured from. A nested one (a fixture project's own tree) sits inside a pool,
 * which the walk does not enter; the pool's contents are inputs, not live specs.
 */
function findSpecsRoots(dir: string): string[] {
    const roots: string[] = [];
    const visit = (current: string): void => {
        if (basename(current) === 'specs') {
            roots.push(current);
            return;
        }
        let entries;
        try {
            entries = readdirSync(current, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            if (entry.isDirectory() && !PRUNED.has(entry.name)) {
                visit(join(current, entry.name));
            }
        }
    };
    visit(dir);
    return roots;
}

/** Locate `$FIXTURES` pools (unlike {@link listDirs}, does not prune them). */
function findPools(dir: string): string[] {
    const pools: string[] = [];
    const visit = (current: string): void => {
        let entries;
        try {
            entries = readdirSync(current, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            if (!entry.isDirectory() || PRUNED.has(entry.name)) {
                continue;
            }
            const path = join(current, entry.name);
            if (isPool(path)) {
                pools.push(path);
            } else {
                visit(path);
            }
        }
    };
    visit(dir);
    return pools;
}

function readText(path: string): string {
    try {
        return readFileSync(path, 'utf8');
    } catch {
        return '';
    }
}

/**
 * Blank out `//` and block comments (replacing them with spaces, newlines
 * preserved so offsets and line numbers stay intact) while leaving string
 * literals untouched. The regex/scan passes read this so a commented-out
 * `.exec()` or a comma inside a `services:` comment never confuses them.
 */
function blankComments(text: string): string {
    const out = [...text];
    let state: "'" | '"' | '' | '`' | 'block' | 'line' = '';
    for (let i = 0; i < text.length; i += 1) {
        const char = text[i];
        const next = text[i + 1];
        if (state === 'line') {
            if (char === '\n') {
                state = '';
            } else {
                out[i] = ' ';
            }
        } else if (state === 'block') {
            if (char === '*' && next === '/') {
                out[i] = ' ';
                out[i + 1] = ' ';
                i += 1;
                state = '';
            } else if (char !== '\n') {
                out[i] = ' ';
            }
        } else if (state === '"' || state === "'" || state === '`') {
            if (char === '\\') {
                i += 1;
            } else if (char === state) {
                state = '';
            }
        } else if (char === '/' && next === '/') {
            out[i] = ' ';
            state = 'line';
        } else if (char === '/' && next === '*') {
            out[i] = ' ';
            state = 'block';
        } else if (char === '"' || char === "'" || char === '`') {
            state = char;
        }
    }
    return out.join('');
}

/** File contents with comments blanked — the parse view for the scan passes. */
function readSource(path: string): string {
    return blankComments(readText(path));
}

/**
 * The fixture paths a `<case>.spec.yaml` names — its referrer literals. The
 * runner's own parser reads them, so the two channels cannot disagree about
 * what the document says; an unparseable file vouches for nothing (the
 * `d4b-spec-shape` pass is what reports it).
 */
function collectSpecLiterals(path: string): Set<string> {
    try {
        return new Set(
            parseSpecDocument(readText(path), path).fixtures.map((fixture) => fixture.path),
        );
    } catch {
        return new Set();
    }
}

/** Is this a file a leaf's ground may be referenced from? */
function isReferrer(name: string): boolean {
    return name.endsWith('.test.ts') || name.endsWith(SPEC_EXTENSION);
}

function isDir(path: string): boolean {
    try {
        return statSync(path).isDirectory();
    } catch {
        return false;
    }
}

/** The 1-based line number of a source offset. */
function lineAt(text: string, index: number): number {
    let line = 1;
    for (let i = 0; i < index && i < text.length; i += 1) {
        if (text[i] === '\n') {
            line += 1;
        }
    }
    return line;
}

/**
 * Every quoted string and simple template literal in a source. Over-collection
 * only ever *hides* a dead-fixture finding, so a greedy regex is safe here.
 */
const STRING_LITERAL =
    /'(?<single>(?:[^'\\\n]|\\.)*)'|"(?<double>(?:[^"\\\n]|\\.)*)"|`(?<template>(?:[^`$\\]|\\.)*)`/g;
function collectLiterals(text: string): Set<string> {
    const found = new Set<string>();
    for (const match of text.matchAll(STRING_LITERAL)) {
        const value = match.groups?.single ?? match.groups?.double ?? match.groups?.template;
        if (value !== undefined && value.length > 0) {
            found.add(value);
        }
    }
    return found;
}

/**
 * Does the text pass a NON-literal argument to a fixture-ish verb
 * (`.seed`/`.request`/`.fixture`/`toMatch`)? A template with an expression or a
 * variable makes the reference set incomplete, so the feature is reported at
 * warn level instead of error (a false positive would be worse than a miss).
 */
const FIXTURE_VERB_ARG = /(?:\.(?:seed|request|fixture)|\btoMatch)\s*\(\s*(?<arg>[^,)]*)/g;
function hasNonLiteralFixtureArg(text: string): boolean {
    for (const match of text.matchAll(FIXTURE_VERB_ARG)) {
        const arg = (match.groups?.arg ?? '').trim();
        if (arg.length === 0) {
            continue;
        }
        const isPlainString =
            /^'(?:[^'\\\n]|\\.)*'$/.test(arg) ||
            /^"(?:[^"\\\n]|\\.)*"$/.test(arg) ||
            /^`(?:[^`$\\]|\\.)*`$/.test(arg);
        if (!isPlainString) {
            return true;
        }
    }
    return false;
}

// ── Suppression (checker channel) ────────────────────────────────────────────

/**
 * `// checker-disable-next-line <id>[,<id>] -- reason` suppresses the passes
 * named by id (`a7`, `b5`, `c9`, or `*`) on the next non-blank line;
 * `checker-disable-line` suppresses its own line. Mirrors the oxlint-disable
 * idiom the repo already uses for negative specs.
 */
export function suppressedLines(text: string, id: string): Set<number> {
    const suppressed = new Set<number>();
    const lines = text.split('\n');
    const applies = (raw: string): boolean => {
        const ids = raw
            .replace(/--.*$/, '')
            .trim()
            .split(/[\s,]+/);
        return ids.includes(id) || ids.includes('*');
    };
    for (const [index, line] of lines.entries()) {
        // Case-insensitive: the repo's formatter capitalizes comment leads
        // (`checker-…` → `Checker-…`).
        let match = /checker-disable-next-line\s+(?<ids>.*)$/i.exec(line);
        if (match !== null && applies(match.groups?.ids ?? '')) {
            for (let next = index + 1; next < lines.length; next += 1) {
                if (lines[next].trim().length > 0) {
                    suppressed.add(next + 1);
                    break;
                }
            }
        }
        match = /checker-disable-line\s+(?<ids>.*)$/i.exec(line);
        if (match !== null && applies(match.groups?.ids ?? '')) {
            suppressed.add(index + 1);
        }
    }
    return suppressed;
}

// ── Balanced scanning helpers ────────────────────────────────────────────────

/** From the `(` at `openIndex`, the substring inside the matching `)`. */
function balancedParens(text: string, openIndex: number): string {
    let depth = 0;
    for (let i = openIndex; i < text.length; i += 1) {
        const char = text[i];
        if (char === '(') {
            depth += 1;
        } else if (char === ')') {
            depth -= 1;
            if (depth === 0) {
                return text.slice(openIndex + 1, i);
            }
        }
    }
    return text.slice(openIndex + 1);
}

/** From the `{` at `openIndex`, the substring inside the matching `}`. */
function balancedBraces(text: string, openIndex: number): null | string {
    let depth = 0;
    for (let i = openIndex; i < text.length; i += 1) {
        const char = text[i];
        if (char === '{') {
            depth += 1;
        } else if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                return text.slice(openIndex + 1, i);
            }
        }
    }
    return null;
}

/** Split an object/argument body on its depth-0 commas. */
function splitTopLevel(body: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < body.length; i += 1) {
        const char = body[i];
        if (char === '{' || char === '(' || char === '[') {
            depth += 1;
        } else if (char === '}' || char === ')' || char === ']') {
            depth -= 1;
        } else if (char === ',' && depth === 0) {
            parts.push(body.slice(start, i));
            start = i + 1;
        }
    }
    parts.push(body.slice(start));
    return parts;
}

// ── Specification-file model ─────────────────────────────────────────────────

type SpecModel = {
    /** True when a `specification.cli(…)` call carries a `docker:` option. */
    dockerAware: boolean;
    file: string;
    /** Named exports bound to a runner (destructured, minus cleanup/docker/…). */
    runnerExports: Set<string>;
    /**
     * Count of SQL database factories in the `services` record, or `null` when
     * the record is absent or not a plain literal (then A7 cannot be decided).
     */
    sqlDatabaseCount: null | number;
};

/** The destructured export names of a `= await specification.<ctor>(` binding. */
function runnerExportsOf(text: string): Set<string> {
    const names = new Set<string>();
    const decl = new RegExp(
        String.raw`\{(?<names>[^}]*)\}\s*=\s*await\s+specification\.(?:${CONSTRUCTORS})\s*\(`,
        'g',
    );
    for (const match of text.matchAll(decl)) {
        for (const raw of (match.groups?.names ?? '').split(',')) {
            // `export const { cleanup, cli }` / `{ api: bareApi }` → key side.
            const key = raw.split(':')[0].trim();
            if (key.length > 0 && !NON_RUNNER_BINDINGS.has(key)) {
                names.add(key);
            }
        }
    }
    return names;
}

/** The leading callee identifier of an expression (`postgres()` → `postgres`). */
function leadingCallee(value: string): null | string {
    const match = /^(?<callee>[A-Za-z_$][\w$]*)\s*\(/.exec(value.trim());
    return match === null ? match : (match.groups?.callee ?? null);
}

/** SQL factory count of a `services:` record, or null if non-literal/absent. */
function sqlDatabaseCount(text: string): null | number {
    const keyword = /\bservices\s*:/.exec(text);
    if (keyword === null) {
        return null;
    }
    const braceIndex = text.indexOf('{', keyword.index + keyword[0].length);
    // A non-`{` value (a variable) is out of static reach.
    if (
        braceIndex === -1 ||
        text.slice(keyword.index + keyword[0].length, braceIndex).trim() !== ''
    ) {
        return null;
    }
    const body = balancedBraces(text, braceIndex);
    if (body === null) {
        return null;
    }
    let count = 0;
    for (const pair of splitTopLevel(body)) {
        if (pair.trim().length === 0) {
            continue;
        }
        const colon = pair.indexOf(':');
        if (colon === -1) {
            return null; // Shorthand / spread — non-literal record.
        }
        const value = pair.slice(colon + 1).trim();
        const callee = leadingCallee(value);
        if (callee === null) {
            return null; // A handle variable — the count is not literal.
        }
        if (callee === 'postgres' || callee === 'sqlite' || callee === 'mysql') {
            count += 1;
        }
    }
    return count;
}

function modelSpecFile(file: string): SpecModel {
    const text = readSource(file);
    let dockerAware = false;
    const cliCall = /specification\.cli\s*\(/g;
    for (const match of text.matchAll(cliCall)) {
        const argsOpen = text.indexOf('(', match.index);
        if (argsOpen !== -1 && /\bdocker\s*:/.test(balancedParens(text, argsOpen))) {
            dockerAware = true;
        }
    }
    return {
        dockerAware,
        file,
        runnerExports: runnerExportsOf(text),
        sqlDatabaseCount: sqlDatabaseCount(text),
    };
}

/** Resolve a relative import specifier to a `.ts` path (else undefined). */
function resolveRelativeImport(fromFile: string, specifier: string): string | undefined {
    if (!specifier.startsWith('.')) {
        return undefined;
    }
    return resolve(dirname(fromFile), specifier).replace(/\.js$/, '.ts');
}

type ImportedBinding = { local: string; name: string; source: string };

/** Every `import { a, b as c } from '…'` binding in a file. */
function namedImports(text: string): ImportedBinding[] {
    const bindings: ImportedBinding[] = [];
    const decl = /import\s+(?:type\s+)?\{(?<names>[^}]*)\}\s+from\s+['"](?<source>[^'"]+)['"]/g;
    for (const match of text.matchAll(decl)) {
        const source = match.groups?.source ?? '';
        for (const raw of (match.groups?.names ?? '').split(',')) {
            const part = raw.trim();
            if (part.length === 0) {
                continue;
            }
            const [name, local] = part.split(/\s+as\s+/).map((token) => token.trim());
            bindings.push({ local: local ?? name, name, source });
        }
    }
    return bindings;
}

// ── B5 (inference) ───────────────────────────────────────────────────────────

/**
 * Docker-aware runner results must be bound with `await using`. The runner
 * identifiers are inferred from the `docker:` option of imported spec files —
 * no hand-maintained runner list, unlike the oxlint rule.
 */
export function checkDockerRunnerAwaitUsing(rootDir: string): TokenViolation[] {
    const violations: TokenViolation[] = [];
    const specFiles = listFiles(rootDir, (path) => path.endsWith('.specification.ts'));
    const dockerSpecs = new Map<string, SpecModel>();
    for (const file of specFiles) {
        const model = modelSpecFile(file);
        if (model.dockerAware && model.runnerExports.size > 0) {
            dockerSpecs.set(file, model);
        }
    }
    if (dockerSpecs.size === 0) {
        return violations;
    }

    for (const testFile of listFiles(rootDir, (path) => path.endsWith('.test.ts'))) {
        const text = readSource(testFile);
        const runners = new Set<string>();
        for (const binding of namedImports(text)) {
            const target = resolveRelativeImport(testFile, binding.source);
            const model = target === undefined ? undefined : dockerSpecs.get(target);
            if (model?.runnerExports.has(binding.name) === true) {
                runners.add(binding.local);
            }
        }
        if (runners.size === 0) {
            continue;
        }
        const suppressed = suppressedLines(readText(testFile), 'b5');
        // A declaration whose initializer is `await <runner>…​.exec(` — the
        // `await using` form matches group 1 and is exempt.
        const binding =
            /\b(?<kind>await\s+using|const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*await\s+(?<runner>[A-Za-z_$][\w$]*)\b[^;]*?\.exec\s*\(/g;
        for (const match of text.matchAll(binding)) {
            const kind = match.groups?.kind ?? '';
            const runner = match.groups?.runner ?? '';
            if (kind.startsWith('await using') || !runners.has(runner)) {
                continue;
            }
            const line = lineAt(text, match.index);
            if (suppressed.has(line)) {
                continue;
            }
            const rel = relative(rootDir, testFile);
            violations.push({
                file: rel,
                line,
                message: `${rel}:${line}: result of docker-aware runner "${runner}" must be bound with \`await using\` so its containers are disposed (B5 — see docs/13-linting.md)`,
                severity: 'error',
            });
        }
    }
    return violations;
}

// ── A7 (database property) ───────────────────────────────────────────────────

/** Local inline runners a test declares itself (`specification.api(…)`). */
function localRunnerBindings(text: string): Set<string> {
    const locals = new Set<string>();
    const decl = new RegExp(
        String.raw`\{(?<names>[^}]*)\}\s*=\s*await\s+specification\.(?:${CONSTRUCTORS})\s*\(`,
        'g',
    );
    for (const match of text.matchAll(decl)) {
        for (const raw of (match.groups?.names ?? '').split(',')) {
            const part = raw.trim();
            const local = (part.includes(':') ? part.split(':')[1] : part).trim();
            if (local.length > 0 && !NON_RUNNER_BINDINGS.has(part.split(':')[0].trim())) {
                locals.add(local);
            }
        }
    }
    return locals;
}

/** The identifier immediately before a `.seed(`/`.table(` member, if any. */
function memberObjectIdentifier(text: string, dotIndex: number): null | string {
    const before = text.slice(0, dotIndex);
    const match = /(?<name>[A-Za-z_$][\w$]*)\s*$/.exec(before);
    return match === null ? match : (match.groups?.name ?? null);
}

export function checkDatabaseProperty(rootDir: string): TokenViolation[] {
    const violations: TokenViolation[] = [];
    const enforced = new Map<string, SpecModel>();
    for (const file of listFiles(rootDir, (path) => path.endsWith('.specification.ts'))) {
        const model = modelSpecFile(file);
        if (
            model.sqlDatabaseCount !== null &&
            model.sqlDatabaseCount >= 1 &&
            model.runnerExports.size > 0
        ) {
            enforced.set(file, model);
        }
    }
    if (enforced.size === 0) {
        return violations;
    }

    for (const testFile of listFiles(rootDir, (path) => path.endsWith('.test.ts'))) {
        const text = readSource(testFile);
        // Which enforced specs does this test import? Enforce only when exactly
        // One applies (mixed DB configurations are ambiguous → skip).
        const applicable = new Set<SpecModel>();
        for (const binding of namedImports(text)) {
            const target = resolveRelativeImport(testFile, binding.source);
            const model = target === undefined ? undefined : enforced.get(target);
            if (model?.runnerExports.has(binding.name) === true) {
                applicable.add(model);
            }
        }
        if (applicable.size !== 1) {
            continue;
        }
        const count = [...applicable][0].sqlDatabaseCount ?? 0;
        const locals = localRunnerBindings(text);
        const suppressed = suppressedLines(readText(testFile), 'a7');
        const rel = relative(rootDir, testFile);

        for (const match of text.matchAll(/\.(?<verb>seed|table)\s*\(/g)) {
            const verb = match.groups?.verb ?? '';
            const object = memberObjectIdentifier(text, match.index);
            // Skip calls dispatched on a runner the test declared itself.
            if (object !== null && locals.has(object)) {
                continue;
            }
            const args = balancedParens(text, text.indexOf('(', match.index));
            const hasDatabase = /\bdatabase\s*:/.test(args);
            const line = lineAt(text, match.index);
            if (suppressed.has(line)) {
                continue;
            }
            if (count >= 2 && !hasDatabase) {
                violations.push({
                    file: rel,
                    line,
                    message: `${rel}:${line}: .${verb}() must pass { database } — ${count} SQL databases are declared (A7 — see docs/13-linting.md)`,
                    severity: 'error',
                });
            } else if (count === 1 && hasDatabase) {
                violations.push({
                    file: rel,
                    line,
                    message: `${rel}:${line}: .${verb}() must not pass { database } — a single SQL database is declared (A7 — see docs/13-linting.md)`,
                    severity: 'error',
                });
            }
        }
    }
    return violations;
}

// ── C9 (dead fixtures + orphan dirs) ─────────────────────────────────────────

/** Is a top-level ground-subdir entry referenced by any test literal? */
function entryReferenced(entry: string, entryIsDir: boolean, literals: Set<string>): boolean {
    for (const literal of literals) {
        if (entryIsDir) {
            // A referenced `<name>/…` tree counts entirely as used.
            if (
                literal === entry ||
                literal.startsWith(`${entry}/`) ||
                literal.includes(`/${entry}`)
            ) {
                return true;
            }
        }
        if (literal === entry || literal.includes(entry)) {
            return true;
        }
    }
    return false;
}

/** A child named like a ground subdir but actually a fixture container. */
function isConventionalSubdir(path: string): boolean {
    if (!isDir(path)) {
        return false;
    }
    // A real _seeds/_expected/… holds leaf fixtures: never a test, never a
    // Nested ground subdir (those signal a feature dir named like one).
    const files = listFiles(path, (candidate) => candidate.endsWith('.test.ts'));
    if (files.length > 0) {
        return false;
    }
    let children;
    try {
        children = readdirSync(path, { withFileTypes: true });
    } catch {
        return false;
    }
    return !children.some((child) => child.isDirectory() && GROUND_SUBDIRS.has(child.name));
}

export function checkDeadFixtures(rootDir: string): TokenViolation[] {
    const violations: TokenViolation[] = [];
    for (const dir of listDirs(rootDir)) {
        // A `specs/_fixtures` pool is not a feature; it is scanned separately.
        if (basename(dir) === 'specs') {
            continue;
        }
        let entries;
        try {
            entries = readdirSync(dir, { withFileTypes: true });
        } catch {
            continue;
        }
        const groundSubdirs = entries
            .filter(
                (entry) =>
                    entry.isDirectory() &&
                    GROUND_SUBDIRS.has(entry.name) &&
                    isConventionalSubdir(join(dir, entry.name)),
            )
            .map((entry) => entry.name);
        if (groundSubdirs.length === 0) {
            continue;
        }
        const feature = basename(dir);
        const testFiles = entries
            .filter((entry) => entry.isFile() && isReferrer(entry.name))
            .map((entry) => join(dir, entry.name));
        const rel = relative(rootDir, dir);

        // A domain owns 1..n `<aspect>.test.ts` (C1') — the ground is dead
        // Weight only when the domain carries no test at all.
        if (testFiles.length === 0) {
            violations.push({
                file: rel,
                line: 1,
                message: `${rel}: domain directory has ground subdirs (${groundSubdirs.join(', ')}) but no *.test.ts or *.spec.yaml (C9 — see docs/13-linting.md)`,
                severity: 'error',
            });
            continue;
        }

        const literals = new Set<string>();
        let downgrade = false;
        for (const testFile of testFiles) {
            if (testFile.endsWith(SPEC_EXTENSION)) {
                for (const literal of collectSpecLiterals(testFile)) {
                    literals.add(literal);
                }
                continue;
            }
            const text = readSource(testFile);
            for (const literal of collectLiterals(text)) {
                literals.add(literal);
            }
            downgrade ||= hasNonLiteralFixtureArg(text);
        }
        const severity: Severity = downgrade ? 'warn' : 'error';

        for (const sub of groundSubdirs) {
            const subPath = join(dir, sub);
            for (const entry of readdirSync(subPath, { withFileTypes: true })) {
                const entryIsDir = entry.isDirectory();
                if (entryReferenced(entry.name, entryIsDir, literals)) {
                    continue;
                }
                const relEntry = relative(rootDir, join(subPath, entry.name));
                violations.push({
                    file: relEntry,
                    line: 1,
                    message: `${relEntry}: dead fixture — no test literal in ${feature} references ${sub}/${entry.name} (C9 — see docs/13-linting.md)`,
                    severity,
                });
            }
        }
    }
    violations.push(...checkPoolFixtures(rootDir));
    return violations;
}

/** Unreferenced top-level entries of a `$FIXTURES` pool (`specs/_fixtures`). */
function checkPoolFixtures(rootDir: string): TokenViolation[] {
    const violations: TokenViolation[] = [];
    for (const pool of findPools(rootDir)) {
        const specsRoot = dirname(pool);
        // Every literal in the specs tree, excluding references made from
        // Inside the pool itself (a dead entry cannot vouch for another).
        const literals = new Set<string>();
        for (const file of listFiles(
            specsRoot,
            (path) => path.endsWith('.ts') || path.endsWith(SPEC_EXTENSION),
        )) {
            if (file.startsWith(`${pool}/`) || file.startsWith(`${pool}\\`)) {
                continue;
            }
            const found = file.endsWith(SPEC_EXTENSION)
                ? collectSpecLiterals(file)
                : collectLiterals(readSource(file));
            for (const literal of found) {
                literals.add(literal);
            }
        }
        for (const entry of readdirSync(pool, { withFileTypes: true })) {
            const referenced = [...literals].some((literal) => literal.includes(entry.name));
            if (!referenced) {
                const relEntry = relative(rootDir, join(pool, entry.name));
                violations.push({
                    file: relEntry,
                    line: 1,
                    message: `${relEntry}: dead pool fixture — no spec under ${relative(rootDir, specsRoot)} references $FIXTURES/${entry.name} (C9 — see docs/13-linting.md)`,
                    severity: 'error',
                });
            }
        }
    }
    return violations;
}

// ── C14 / C15 (where a fixture lives) ────────────────────────────────────────

/** One fixture reference: the path a spec named, and where it named it. */
interface FixtureReference {
    file: string;
    line: number;
    path: string;
}

/** A `.fixture('…')` call with a plain string argument. */
const FIXTURE_CALL = /\.fixture\(\s*(?<quote>['"`])(?<path>(?:[^'"`\\]|\\.)*)\k<quote>/g;

/**
 * Every fixture path a spec file names, with the line it names it on. A
 * `<case>.spec.yaml` is read through the runner's own parser; a `.ts` file
 * through its literal `.fixture()` arguments — a non-literal argument is out of
 * static reach and stays silent (the checker doctrine: precision over recall).
 */
function collectFixtureReferences(file: string): FixtureReference[] {
    if (file.endsWith(SPEC_EXTENSION)) {
        try {
            return parseSpecDocument(readText(file), file).fixtures.map((fixture) => ({
                file,
                line: fixture.line,
                path: fixture.path,
            }));
        } catch {
            return [];
        }
    }
    const text = readSource(file);
    const references: FixtureReference[] = [];
    for (const match of text.matchAll(FIXTURE_CALL)) {
        const path = match.groups?.path;
        if (path !== undefined && path.length > 0) {
            references.push({ file, line: lineAt(text, match.index), path });
        }
    }
    return references;
}

/** Every spec file of a tree that may name a fixture, the pool excluded. */
function listReferrers(specsRoot: string, pool: string): string[] {
    return listFiles(
        specsRoot,
        (path) => path.endsWith('.ts') || path.endsWith(SPEC_EXTENSION),
    ).filter((file) => !file.startsWith(`${pool}/`) && !file.startsWith(`${pool}\\`));
}

/** The pool entry a `$FIXTURES/…` path names — its FIRST segment. */
function poolEntryOf(path: string): string | undefined {
    if (!path.startsWith('$FIXTURES/')) {
        return undefined;
    }
    const entry = path.slice('$FIXTURES/'.length).split('/')[0];
    return entry.length > 0 ? entry : undefined;
}

/** Pool entry → the spec directories that reference it, each with its referrers. */
function poolUsage(specsRoot: string, pool: string): Map<string, Map<string, string[]>> {
    const usage = new Map<string, Map<string, string[]>>();
    for (const file of listReferrers(specsRoot, pool)) {
        for (const { path } of collectFixtureReferences(file)) {
            const entry = poolEntryOf(path);
            if (entry === undefined) {
                continue;
            }
            const leaves = usage.get(entry) ?? new Map<string, string[]>();
            const referrers = leaves.get(dirname(file)) ?? [];
            if (!referrers.includes(file)) {
                referrers.push(file);
            }
            leaves.set(dirname(file), referrers);
            usage.set(entry, leaves);
        }
    }
    return usage;
}

/** A pool entry only one leaf reaches for, and the leaf it belongs to. */
interface MisplacedPoolFixture {
    entry: string;
    leaf: string;
    pool: string;
    referrers: string[];
}

/**
 * Pool entries reached from exactly ONE spec directory. Two documents of the
 * same leaf count as one — the unit is the folder, not the file. An entry no
 * `$FIXTURES` reference names at all is C9's dead-fixture case, not this one.
 */
function misplacedPoolFixtures(rootDir: string): MisplacedPoolFixture[] {
    const misplaced: MisplacedPoolFixture[] = [];
    for (const pool of findPools(rootDir)) {
        const usage = poolUsage(dirname(pool), pool);
        for (const [entry, leaves] of usage) {
            if (leaves.size !== 1 || !isDir(join(pool, entry))) {
                continue;
            }
            const [leaf, referrers] = [...leaves][0];
            misplaced.push({ entry, leaf, pool, referrers });
        }
    }
    return misplaced;
}

/**
 * CONVENTIONS C14 — a pool fixture is SHARED, or it is local. A directory of the
 * specs-root `_fixtures/` pool that exactly one spec directory reaches for is
 * misplaced: it belongs beside that leaf, as `<leaf>/_fixtures/<name>/`, named by
 * the plain relative form.
 *
 * The catch: a fixture built for one scenario and parked in the pool reads as
 * shared ground. Every later author assumes some other spec depends on it, so
 * nobody dares change it — and the one spec that actually owns it is a directory
 * away, invisible. Fixed by `--fix`, which moves the tree and rewrites the
 * referrers.
 */
export function checkPoolFixtureSharing(rootDir: string): TokenViolation[] {
    return misplacedPoolFixtures(rootDir).map(({ entry, leaf, pool }) => {
        const relEntry = relative(rootDir, join(pool, entry));
        const relLeaf = relative(rootDir, leaf);
        return {
            file: relEntry,
            line: 1,
            message: `${relEntry}: only ${relLeaf} reaches for this pool fixture — the pool is what SEVERAL leaves share; move it to ${relLeaf}/${GROUND_FIXTURES}/${entry} and reference it as '${entry}' (C14 — see docs/13-linting.md, or run the checker with --fix)`,
            severity: 'error' as Severity,
        };
    });
}

/**
 * Apply C14: move each single-reader pool entry beside its leaf and rewrite the
 * `$FIXTURES/<name>` literals that named it. The move is a plain rename — the
 * checker never runs git, so the working tree sees it and the author stages it.
 * Returns what moved, relative to `rootDir`.
 */
export function fixPoolFixtures(rootDir: string): string[] {
    const moved: string[] = [];
    for (const { entry, leaf, pool, referrers } of misplacedPoolFixtures(rootDir)) {
        const destination = join(leaf, GROUND_FIXTURES, entry);
        if (existsSync(destination)) {
            continue; // Something already sits there — the author decides.
        }
        mkdirSync(dirname(destination), { recursive: true });
        renameSync(join(pool, entry), destination);
        for (const file of referrers) {
            const text = readText(file);
            const next = text.replaceAll(`$FIXTURES/${entry}`, entry);
            if (next !== text) {
                writeFileSync(file, next);
            }
        }
        moved.push(`${relative(rootDir, join(pool, entry))} → ${relative(rootDir, destination)}`);
    }
    return moved;
}

/**
 * CONVENTIONS C15 — a local fixture is reached only from its own folder. A
 * marker-less `.fixture()` / `fixture:` path resolves under the referring spec's
 * own `_fixtures/`; a `..` segment or an absolute path escapes it, and reaching
 * into a sibling's ground is the pool by another door — with none of the pool's
 * visibility.
 *
 * The catch: a leaf quietly depending on a neighbour's fixtures. The neighbour's
 * author has no way to know, edits their own ground, and breaks a spec two
 * folders away. Ground several leaves share belongs in the pool, where its
 * sharing is declared.
 */
export function checkLocalFixtureReach(rootDir: string): TokenViolation[] {
    const violations: TokenViolation[] = [];
    for (const specsRoot of findSpecsRoots(rootDir)) {
        const pool = join(specsRoot, GROUND_FIXTURES);
        for (const file of listReferrers(specsRoot, pool)) {
            const ground = join(dirname(file), GROUND_FIXTURES);
            for (const { line, path } of collectFixtureReferences(file)) {
                if (path.startsWith('$')) {
                    continue; // A marker is the declared shared door (B2 owns the vocabulary).
                }
                const target = resolve(ground, path);
                if (target === ground || target.startsWith(`${ground}/`)) {
                    continue;
                }
                const rel = relative(rootDir, file);
                violations.push({
                    file: rel,
                    line,
                    message: `${rel}:${line}: fixture "${path}" reaches outside ${relative(rootDir, ground)} — a leaf's ground sits beside it; ground several leaves share goes to the $FIXTURES pool at ${relative(rootDir, pool)} (C15 — see docs/13-linting.md)`,
                    severity: 'error',
                });
            }
        }
    }
    return violations;
}
