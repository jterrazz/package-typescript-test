import { cpSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

import { shouldUpdateSnapshots } from '../../../vitest/update.js';
import {
    readSpecFile,
    type SpecDocument,
    type SpecFile,
    type SpecFileAssertion,
    type SpecRun,
    SpecSyntaxError,
    updateSpecFile,
} from '../../literate/spec-document.js';
import { CaptureScope } from '../../matching/match.js';
import {
    mergeTextPreservingPlaceholders,
    textContains,
    textEquals,
} from '../../matching/structural.js';
import type { CliEnv, CliOutput } from '../../ports/cli.port.js';
import type { SpecificationConfig } from '../shared/builder.js';
import { copyPlan } from '../shared/fixtures.js';
import { formatStdoutDiff } from '../shared/reporter.js';
import { expandWorkdir, safeRealpath } from '../shared/resolve.js';
import { stripAnsiCodes } from '../shared/result/text.js';
import { ServeAdapter } from '../website/serve.adapter.js';
import { CliResult } from './result.js';

/**
 * Running a `<case>.spec.yaml` document: one scenario, one working directory,
 * one set of servers, every run executed and asserted.
 *
 * The engine composes pieces that already exist rather than adding a second of
 * anything — {@link copyPlan} for `fixture:`, the runner's own command adapter
 * for each run, {@link ServeAdapter} for `serve:`, the `{{token}}` engine for
 * every comparison, and {@link mergeTextPreservingPlaceholders} for the
 * rewrite. What is new here is only the ORCHESTRATION the chain cannot express:
 * several commands sharing one working directory, each judged the moment it
 * ends — so what a run states about that directory is what IT left there, and
 * the first run to disagree is the one the failure names.
 */

// ── Types ──

/**
 * A server a document may start by name (`serve: mcp`), registered once per app
 * in the `serve` option of `specification.cli()`.
 */
export interface LiterateServeRegistration {
    /** Shell command that starts the server, run from the project root. */
    command: string;
    /** The variable the resolved URL is bound to in every run's child env. */
    env: string;
    /**
     * Matched against the server's output; the FIRST capture group is the port
     * it chose — named (`(?<port>\d+)`) or not, it is group 1 either way.
     */
    ready: RegExp;
    /** Builds the URL bound to {@link env} from the announced port. */
    url: (port: number) => string;
}

/** Per-call options for {@link runSpecDocument} / `cli.run()`. */
export interface LiterateRunFlags {
    /**
     * Opt this document OUT of the update-mode rewrite. A frozen document is
     * NEVER written under `TEST_UPDATE=1`: its mismatch still throws its diff.
     * That is what makes a DELIBERATELY-WRONG `.spec.yaml` — one whose failure
     * rendering is the subject of a negative test — survive an update run
     * instead of being silently corrected into a passing file. The document's
     * mirror of `toMatch(name, { frozen: true })`.
     */
    frozen?: boolean;
}

/** Everything the engine needs to run one document. Assembled by the chain. */
export interface LiterateRunOptions extends LiterateRunFlags {
    /** Env the chain already resolved: service URLs, docker run id, `.env()`. */
    baseEnv?: CliEnv;
    config: SpecificationConfig;
    /** The path failures name — as the reader would open it. */
    displayPath: string;
    /** Absolute path of the `.spec.yaml` file. */
    filePath: string;
    /** Directory `_expected/` fixtures of follow-up assertions resolve against. */
    testDir: string;
    /** The shared working directory every run executes in. */
    workDir: string;
}

/** One run's outcome, kept for the failure rendering and the rewrite. */
interface RunOutcome {
    actual: CliOutput;
    run: SpecRun;
    /** Streams as compared: ANSI stripped and `transform` applied, byte for byte. */
    stderr: string;
    stdout: string;
}

/** Where a failure is rendered against — the two forms of the same path. */
interface FailureContext {
    displayPath: string;
    filePath: string;
}

// ── Comparison ──

/**
 * The form a stream is compared in: ANSI stripped (rule D6) and the runner's
 * `transform` applied. Nothing else — a block scalar states its own final
 * newline (`|` keeps it, `|-` drops it), so the comparison is byte-exact and
 * has no normalisation to hide behind.
 */
function comparable(raw: string, transform?: (text: string) => string): string {
    const stripped = stripAnsiCodes(raw);
    return transform ? transform(stripped) : stripped;
}

/**
 * Line equality AS THE COMPARISON JUDGED IT — a `{{url}}` line that matched is
 * equal, whatever port the run picked. Each line is judged on its own fresh
 * scope: this is a rendering, and a ref captured by an earlier line must not
 * decide how a later one is displayed.
 */
function tokenAwareEquals(scope: CaptureScope): (expected: string, actual: string) => boolean {
    return (expected, actual) => textEquals(expected, actual, new CaptureScope(scope.workdir));
}

// ── Files ──

/** A path under the working directory, refusing anything that would escape it. */
function resolveUnderWorkDir(path: string, workDir: string, context: FailureContext): string {
    const target = resolve(workDir, path);
    const inside = relative(workDir, target);
    if (isAbsolute(path) || inside.startsWith('..') || isAbsolute(inside)) {
        throw new Error(
            `${context.displayPath}: files: "${path}" leaves the working directory — a files: key is a relative path under the cwd`,
        );
    }
    return target;
}

/** A one-line preview of a file's content for the failure rendering. */
function preview(text: string): string {
    const flat = JSON.stringify(text.length > 160 ? `${text.slice(0, 160)}…` : text);
    return flat;
}

function readIfPresent(path: string): null | string {
    try {
        return statSync(path).isFile() ? readFileSync(path, 'utf8') : null;
    } catch {
        return null;
    }
}

/** Check one `files:` entry and render its failure, or `null` when it holds. */
function checkFile(
    assertion: SpecFileAssertion,
    workDir: string,
    context: FailureContext,
    scope: CaptureScope,
): null | string {
    const target = resolveUnderWorkDir(assertion.path, workDir, context);
    let exists;
    try {
        exists = statSync(target) !== undefined;
    } catch {
        exists = false;
    }
    if (assertion.kind === 'absent') {
        return exists ? `${assertion.path}: expected absent, got a file` : null;
    }
    if (!exists) {
        return `${assertion.path}: expected to exist, got nothing at that path`;
    }
    if (assertion.kind === 'exists') {
        return null;
    }
    const content = readIfPresent(target);
    if (content === null) {
        return `${assertion.path}: expected a readable file, got a directory`;
    }
    for (const needle of assertion.contains) {
        if (!textContains(needle.text, content, scope)) {
            return `${assertion.path}: expected to contain ${preview(needle.text)}, got ${preview(content)}`;
        }
    }
    if (assertion.equals !== null && !textEquals(assertion.equals.text, content, scope)) {
        return `${assertion.path}: expected ${preview(assertion.equals.text)}, got ${preview(content)}`;
    }
    return null;
}

// ── Failure ──

/**
 * The failure a mismatching run throws: the description, the command that ran,
 * every detail the comparison rejected, and where to open the document. The
 * update hint names exactly what a rewrite touches, so it cannot be read as
 * "this will re-generate my `files:`".
 *
 * The stack is REPLACED by the run's own line. Left alone it would carry the
 * engine's frames and end inside the module the plugin generates — pointing the
 * reader at a line of a file they never wrote. One frame, on the `command:` key,
 * is the whole truth here.
 */
function failure(
    document: SpecDocument,
    run: SpecRun,
    context: FailureContext,
    details: string[],
): Error {
    const error = new Error(
        [
            'Spec mismatch',
            '',
            document.description,
            '',
            `$ ${run.command}`,
            '',
            details.join('\n\n'),
            '',
            `${context.displayPath}:${run.commandLine}`,
            'Run with TEST_UPDATE=1 to rewrite the runs — the exit code and the streams, and nothing else.',
        ].join('\n'),
    );
    return atLine(error, context.filePath, run.commandLine);
}

/**
 * Point an error's stack at one frame: the line of the `.spec.yaml` that owns
 * the failure. The framework's own frames carry nothing a reader of a spec
 * document can act on, and the generated module's frame actively misleads.
 */
function atLine(error: Error, filePath: string, line: number): Error {
    error.stack = `${error.name}: ${error.message}\n    at ${filePath}:${line}:1`;
    return error;
}

/**
 * Compare one run against what the command actually did — its exit code, its
 * streams and its `files:`, all read at the same instant: the moment that
 * command returned.
 */
function assertRun(
    document: SpecDocument,
    outcome: RunOutcome,
    context: FailureContext,
    workDir: string,
    scope: CaptureScope,
): void {
    const { actual, run } = outcome;
    // An exit-code mismatch is reported ALONE: when the command did something
    // Else entirely, its stream diffs are consequences, not causes.
    if (actual.exitCode !== run.exitCode) {
        throw failure(document, run, context, [
            [
                'exit code mismatch',
                `  expected: ${run.exitCode}`,
                `  received: ${actual.exitCode}`,
                // The stream is byte-exact, so it carries its own final
                // Newline; the joiner adds the separator, not the stream.
                ...(outcome.stderr.length > 0
                    ? ['', 'stderr was:', outcome.stderr.replace(/\n$/, '')]
                    : []),
            ].join('\n'),
        ]);
    }

    const equals = tokenAwareEquals(scope);
    const details: string[] = [];
    for (const [name, expected, received] of [
        ['stdout', run.stdout?.text ?? '', outcome.stdout],
        ['stderr', run.stderr?.text ?? '', outcome.stderr],
    ] as const) {
        if (!textEquals(expected, received, scope)) {
            details.push(formatStdoutDiff(name, expected, received, { equals }));
        }
    }

    const fileFailures = run.files
        .map((assertion) => checkFile(assertion, workDir, context, scope))
        .filter((line): line is string => line !== null);
    if (fileFailures.length > 0) {
        details.push(['files mismatch', '', ...fileFailures.map((line) => `  ${line}`)].join('\n'));
    }

    if (details.length > 0) {
        throw failure(document, run, context, details);
    }
}

// ── Update ──

/**
 * The rewritten runs: exit codes and streams from the run, placeholders of the
 * previous golden preserved by pattern (rule D5). A stream that ends up empty
 * loses its key, so a rewritten document passes the next run.
 */
function updates(outcomes: RunOutcome[], scope: CaptureScope) {
    return outcomes.map(({ actual, run, stderr, stdout }) => ({
        exitCode: actual.exitCode,
        stderr: mergeTextPreservingPlaceholders(run.stderr?.text ?? null, stderr, scope),
        stdout: mergeTextPreservingPlaceholders(run.stdout?.text ?? null, stdout, scope),
    }));
}

// ── Servers ──

/**
 * Start every server the document names, in declaration order, after `fixture:`
 * has been copied and before the first run. They all stay live for the whole
 * file and are stopped together — one document is one scenario, and its servers
 * are part of its ground.
 *
 * Every child is seeded with `TEST_WORKDIR`, the resolved working directory the
 * `{{workdir}}` token holds and `$WORKDIR` expands to. The fixtures are already
 * on disk when the child starts, so a served stub reads the world the document
 * laid down exactly as a stub binary reads its own fixture tree: a scenario is
 * a layer of files, never a flag threaded through the server. A document's
 * mapping-form env wins over it, key by key.
 */
async function startServers(
    document: SpecDocument,
    config: SpecificationConfig,
    displayPath: string,
    workdir: string,
): Promise<{ env: CliEnv; stop: () => Promise<void> }> {
    const registry = config.serveRegistry ?? {};
    const started: ServeAdapter[] = [];
    const env: CliEnv = {};

    const stop = async (): Promise<void> => {
        for (const adapter of started.toReversed()) {
            await adapter.stop();
        }
    };

    for (const entry of document.serve) {
        const registration = registry[entry.name];
        if (!registration) {
            await stop();
            const known = Object.keys(registry);
            throw new Error(
                `${displayPath}:${entry.line}: serve: "${entry.name}" is not registered — ${
                    known.length === 0
                        ? 'specification.cli() declares no `serve` option.'
                        : `registered servers: ${known.join(', ')}.`
                }`,
            );
        }
        const adapter = new ServeAdapter(
            { command: registration.command, ready: registration.ready },
            config.root ?? process.cwd(),
            'cli',
            { TEST_WORKDIR: workdir, ...entry.env },
        );
        started.push(adapter);
        try {
            await adapter.start();
        } catch (error) {
            await stop();
            throw error;
        }
        env[registration.env] = registration.url(adapter.port!);
    }

    return { env, stop };
}

// ── Environment ──

/** Resolve the document's `env:` entries against the registered sets. `$WORKDIR` expands. */
function documentEnv(
    document: SpecDocument,
    config: SpecificationConfig,
    displayPath: string,
): CliEnv {
    const sets = config.envSets ?? {};
    const env: CliEnv = {};
    for (const token of document.env) {
        if (token.kind === 'set') {
            const declared = sets[token.name];
            if (!declared) {
                const known = Object.keys(sets);
                throw new Error(
                    `${displayPath}:${token.line}: env: "${token.name}" is not a registered env set — ${
                        known.length === 0
                            ? 'specification.cli() declares no `env` option.'
                            : `registered sets: ${known.join(', ')}.`
                    }`,
                );
            }
            Object.assign(env, declared);
            continue;
        }
        env[token.key] = token.value;
    }
    return env;
}

// ── Engine ──

/**
 * Run one spec document end to end and resolve with the LAST run's result —
 * the handle a `.test.ts` adds its own assertion to (a directory golden, a
 * grep) after `cli.run('<case>.spec.yaml')`.
 *
 * Under `TEST_UPDATE=1` nothing is asserted: every run executes, and each one's
 * exit code and streams are rewritten from the actual output with the previous
 * golden's placeholders preserved.
 */
export async function runSpecDocument(options: LiterateRunOptions): Promise<CliResult> {
    const { config, displayPath, filePath, testDir, workDir } = options;
    if (!config.command) {
        throw new Error(
            '.run(): spec documents require a command adapter (use specification.cli())',
        );
    }

    let file: SpecFile;
    try {
        file = readSpecFile(readFileSync(filePath, 'utf8'), displayPath);
    } catch (error) {
        // A grammar refusal is about the FILE, not about the engine that read
        // It: the message already names the line, so the stack says the same.
        throw error instanceof SpecSyntaxError ? atLine(error, filePath, error.line) : error;
    }
    const document = file.document;
    const fileDir = filePath.replace(/[/\\][^/\\]*$/, '');

    // `fixture:` layers on top of whatever the chain already copied, in
    // Declaration order — identical semantics to chained `.fixture()` calls.
    for (const fixture of document.fixtures) {
        const { dest, src } = copyPlan(fixture.path, fileDir, workDir);
        cpSync(src, dest, { recursive: true });
    }

    // One resolved spelling of the working directory, read by everything that
    // Names it: `{{workdir}}` in a golden, `$WORKDIR` in an env value, and
    // `TEST_WORKDIR` in a served stub's environment.
    const workdir = safeRealpath(workDir);
    const servers = await startServers(document, config, displayPath, workdir);
    const scope = new CaptureScope(workdir);
    const env: CliEnv = expandWorkdir(
        {
            ...options.baseEnv,
            ...servers.env,
            ...documentEnv(document, config, displayPath),
        },
        workDir,
    );

    // A rewrite states what the runs DID, so it asserts nothing and needs every
    // Run to have executed; a normal session judges each run where it stands.
    const rewriting = shouldUpdateSnapshots() && options.frozen !== true;
    const outcomes: RunOutcome[] = [];
    try {
        for (const run of document.runs) {
            const actual =
                run.waitFor === null
                    ? await config.command.exec(run.command, workDir, env, {
                          stdin: run.stdin ?? undefined,
                          timeout: run.timeout ?? undefined,
                      })
                    : await config.command.watch(
                          run.command,
                          workDir,
                          { timeout: run.timeout ?? undefined, waitFor: run.waitFor },
                          env,
                      );
            const outcome: RunOutcome = {
                actual,
                run,
                stderr: comparable(actual.stderr, config.transform),
                stdout: comparable(actual.stdout, config.transform),
            };
            outcomes.push(outcome);
            // HERE, before the next command runs. A run's `files:` describes
            // The working directory as THIS run left it — a lock file the next
            // Command creates, a build output the next one removes — and a
            // Working directory only ever holds its latest state. Judging the
            // Whole session at the end would ask every run about the same tree.
            if (!rewriting) {
                assertRun(document, outcome, { displayPath, filePath }, workDir, scope);
            }
        }
    } finally {
        await servers.stop();
    }

    if (rewriting) {
        writeFileSync(filePath, updateSpecFile(file, updates(outcomes, scope)));
    }

    return new CliResult({
        commandOutput: outcomes.at(-1)!.actual,
        config,
        dockerConfig: config.dockerConfig,
        testDir,
        testRunId: config.dockerTestRunId,
        transform: config.transform,
        workDir,
    });
}

/** The title a transformed `.spec.yaml` module runs under — the `description:` line. */
export function specDescription(content: string, displayPath: string): string {
    return readSpecFile(content, displayPath).document.description;
}
