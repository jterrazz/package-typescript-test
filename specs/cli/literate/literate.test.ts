import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { text } from '../../../src/index.js';
import { cli } from '../literate-cli.specification.js';

/**
 * The spec-document format run through the BRIDGE door (`cli.run`). The same
 * documents also run through the plugin door — `vitest.config.ts` collects
 * `specs/cli/literate/*.spec.yaml` as test files — so every scenario here is
 * proven twice, once per entry point, against one engine.
 *
 * The `_fixtures/` twins are the deliberately-wrong inputs: a document whose
 * golden or shape is wrong on purpose, kept out of the plugin's glob so the
 * runner never tries to pass them.
 */

const scratch: string[] = [];

function scratchFile(content: string): string {
    const dir = mkdtempSync(resolve(tmpdir(), 'spec-document-'));
    scratch.push(dir);
    const path = resolve(dir, 'case.spec.yaml');
    writeFileSync(path, content);
    return path;
}

async function failureOf(run: Promise<unknown>): Promise<string> {
    const error = await errorOf(run);
    return error.message;
}

async function errorOf(run: Promise<unknown>): Promise<Error> {
    try {
        await run;
    } catch (error) {
        return error as Error;
    }
    throw new Error('expected the spec document to fail, but it passed');
}

/** The `at …` frames of an error's stack, trimmed. */
function frames(error: Error): string[] {
    return (error.stack ?? '')
        .split('\n')
        .filter((line) => line.trimStart().startsWith('at '))
        .map((line) => line.trim());
}

afterEach(() => {
    for (const dir of scratch.splice(0)) {
        rmSync(dir, { force: true, recursive: true });
    }
});

describe('spec documents — the bridge door (cli.run)', () => {
    test('runs a bare document and hands back the last run result', async () => {
        // Given - a scenario with no ground to state and one command
        const result = await cli.run('help.spec.yaml');

        // Then - the document asserted itself; the result is still a CliResult
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('Usage: cli <command>');
    });

    test('a two-run sequence shares one working directory', async () => {
        // Given - build writes dist/, start reads it — one cwd, two runs
        const result = await cli.run('built-then-started.spec.yaml');

        // Then - the document proved the sequence; the cwd is readable afterwards
        expect(result.file('dist/index.js').exists).toBe(true);
    });

    test('an env set and an inline pair both reach the child', async () => {
        // Given - `env: [frozen, EXTRA=inline]`
        const result = await cli.run('frozen-env.spec.yaml');

        // Then - the set's value reached the child, and so did the pair
        expect(result.stdout).toContain('MY_VAR=from-the-frozen-set');
    });

    test('a served URL matches through {{url}} whatever port was free', async () => {
        // Given - the echo server started by the document, on an OS-picked port
        const result = await cli.run('served-url.spec.yaml');

        // Then - the document matched the URL by token; the raw value is a real one
        expect(result.stdout.comparableText).toMatch(/backend http:\/\/127\.0\.0\.1:\d+\//);
    });

    test('a served stub answers out of the workdir the document laid down', async () => {
        // Given - the stub reads TEST_WORKDIR: run 1 echoes it, run 2 serves
        // The file the document's `fixture:` put there
        const result = await cli.run('served-workdir.spec.yaml');

        // Then - the answer came off disk, from the very cwd the runs share
        expect(result.file('answers/dashboard/posts.json').content).toContain(
            'the fixture is the answer',
        );
    });

    test("a document's own TEST_WORKDIR wins over the one the runner seeds", async () => {
        // Given - the mapping form sets the key the runner already seeded
        const path = scratchFile(
            [
                'description: states the workdir its stub reads',
                'serve:',
                '  - echo: { TEST_WORKDIR: /elsewhere }',
                'runs:',
                '  - command: backend-fetch workdir',
                '    exit: 0',
                '    stdout: |',
                '      /elsewhere',
                '',
            ].join('\n'),
        );

        // Then - the document's value reached the server, not the temp cwd
        const result = await cli.run(path);
        expect(result.stdout.text).toBe('/elsewhere\n');
    });

    test('`|` and `|-` are compared byte for byte, final newline included', async () => {
        // Given - two runs, one output ending on a newline and one not
        const result = await cli.run('chomping.spec.yaml');

        // Then - the last run's raw stdout carries no trailing newline at all
        expect(result.stdout.text).toBe('ends here');
    });

    test('stdin: is written to the child, then closed', async () => {
        // Given - a command that reads its input to EOF and shouts it back
        const result = await cli.run('piped-input.spec.yaml');

        // Then - the document's own golden already proved it; the result agrees
        expect(result.stdout).toContain('SHOUT THIS');
    });

    test('files: asserts what the run left on disk', async () => {
        // Given - contains, equals, exists and absent over one scaffold
        const result = await cli.run('written-files.spec.yaml');

        // Then - the document passed, and the tree it judged is the result's cwd
        expect(result.file('out/go.mod').content).toBe('module example\n');
    });

    test('an absent: holds against the cwd of ITS run, not of the last one', async () => {
        // Given - run 1 states dist/index.js is not there yet, run 2 builds it
        const result = await cli.run('absent-then-written.spec.yaml');

        // Then - the absent passed although the session ends with the file there
        expect(result.file('dist/index.js').exists).toBe(true);
    });

    test('an exists: holds against the cwd of ITS run, not of the last one', async () => {
        // Given - run 1 builds dist/index.js, run 2 removes it again
        const result = await cli.run('written-then-removed.spec.yaml');

        // Then - the exists passed although the session ends with the file gone
        expect(result.file('dist/index.js').exists).toBe(false);
    });
});

describe('spec documents — refusals', () => {
    test('a key outside the closed set names the key, the line and the vocabulary', async () => {
        // Given - a `when:` line
        const message = await failureOf(cli.run('_fixtures/unknown-key.spec.yaml'));

        // Then - the closed vocabulary is spelled out in the refusal
        expect(message).toContain('unknown key "when:"');
        expect(message).toContain('kind, description, fixture, env, serve, runs');
        expect(message).toContain('unknown-key.spec.yaml:2');
    });

    test('a wrong stdout renders the description, the command and a line diff', async () => {
        // Given - a golden nobody updated (frozen: its mismatch IS the subject)
        const message = await failureOf(
            cli.run('_fixtures/wrong-stdout.spec.yaml', { frozen: true }),
        );

        // Then - the whole rendering, tokens covering the path and the run cwd
        expect(text(message)).toMatch('wrong-stdout-error.txt');
    });

    test('a wrong exit code names both codes and what stderr carried', async () => {
        // Given - a golden claiming a failing command succeeds
        const message = await failureOf(
            cli.run('_fixtures/wrong-exit.spec.yaml', { frozen: true }),
        );

        // Then - the whole rendering, stderr included
        expect(text(message)).toMatch('wrong-exit-error.txt');
    });

    test('failing files: assertions render as path, expected and got', async () => {
        // Given - a contains that does not, an absent that is there, and a
        // Missing file that should exist
        const message = await failureOf(
            cli.run('_fixtures/wrong-files.spec.yaml', { frozen: true }),
        );

        // Then - the whole rendering, one line per rejected assertion
        expect(text(message)).toMatch('wrong-files-error.txt');
    });

    test('the stack carries ONE frame, on the run that failed', async () => {
        // Given - a golden whose run is deliberately wrong
        const error = await errorOf(cli.run('_fixtures/wrong-stdout.spec.yaml', { frozen: true }));

        // Then - no engine frames, no generated-module frame: the `command:`
        // Line, which is what the message names too
        expect(frames(error)).toEqual([
            `at ${resolve(import.meta.dirname, '_fixtures/wrong-stdout.spec.yaml')}:3:1`,
        ]);
        expect(error.message).toContain('_fixtures/wrong-stdout.spec.yaml:3');
    });

    test('a grammar refusal points at the offending line, not at the engine', async () => {
        // Given - a document carrying a key outside the closed set (line 2)
        const error = await errorOf(cli.run('_fixtures/unknown-key.spec.yaml'));

        // Then - the frame is that line, not a parser frame
        expect(frames(error)).toEqual([
            `at ${resolve(import.meta.dirname, '_fixtures/unknown-key.spec.yaml')}:2:1`,
        ]);
    });

    test('a matched token line is not marked as a difference beside the real one', async () => {
        // Given - a run whose {{url}} matched and whose next line did not
        const path = scratchFile(
            [
                'description: renders only the real cause',
                'serve: echo',
                'runs:',
                '  - command: backend',
                '    exit: 0',
                '    stdout: |',
                '      backend {{url}}',
                '      not printed at all',
                '',
            ].join('\n'),
        );

        // Then - the token line is shown as equal, with its token
        const message = await failureOf(cli.run(path));
        expect(message).toContain('  backend {{url}}');
        expect(message).not.toContain('- backend {{url}}');
        expect(message).toContain('- not printed at all');
    });

    test('an unregistered server name lists what the runner declares', async () => {
        // Given - a document naming a server nobody registered
        const path = scratchFile(
            `description: names a server that does not exist\nserve: ghost\nruns:\n  - command: help\n    exit: 0\n`,
        );

        // Then - the refusal lists what specification.cli() actually declares
        expect(await failureOf(cli.run(path))).toContain('registered servers: echo');
    });
});

describe('spec documents — update mode (CONVENTIONS D5)', () => {
    test('rewrites exit and streams, keeping comments, key order and files:', async () => {
        // Given - a document whose golden is stale in both streams
        const path = scratchFile(
            [
                '# a comment the rewrite must keep',
                'description: rewrites what each run produced',
                'runs:',
                '  - command: fail',
                '    exit: 0',
                '    stdout: |',
                '      stale stdout',
                '',
            ].join('\n'),
        );

        // Given - one update run
        process.env.TEST_UPDATE = '1';
        try {
            await cli.run(path);
        } finally {
            delete process.env.TEST_UPDATE;
        }

        // Then - the comment and the description survived; the runs hold the truth
        const written = readFileSync(path, 'utf8');
        expect(written).toContain('# a comment the rewrite must keep');
        expect(written).toContain('description: rewrites what each run produced');
        expect(written).toContain('exit: 2');
        expect(written).toContain(
            'stderr: |\n      Starting...\n      Fatal: something went wrong',
        );
        // An empty stream loses its key rather than being written as ''.
        expect(written).not.toContain('stdout');

        // Then - the rewritten document passes on a normal run
        await cli.run(path);
    });

    test('{{url}} survives a port change: the second server gets another port', async () => {
        // Given - a golden already tokenised, updated against a fresh server
        const source = [
            'description: keeps the url token across runs',
            'serve: echo',
            'runs:',
            '  - command: backend',
            '    exit: 0',
            '    stdout: |',
            '      backend {{url}}',
            '',
        ].join('\n');
        const path = scratchFile(source);

        // Given - two update runs, each with its own server and port
        process.env.TEST_UPDATE = '1';
        try {
            await cli.run(path);
            const first = readFileSync(path, 'utf8');
            await cli.run(path);

            // Then - the token was never replaced by a run-specific URL
            expect(first).toContain('backend {{url}}');
            expect(readFileSync(path, 'utf8')).toBe(source);
        } finally {
            delete process.env.TEST_UPDATE;
        }
    });

    test('a mid-file insertion keeps the tokens of the lines it shifted', async () => {
        // Given - a golden whose token line sits above the line a new command
        // Adds; the update must recognise it where it landed, not by index
        const path = scratchFile(
            [
                'description: survives a new line appearing above a token',
                'runs:',
                '  - command: version',
                '    exit: 0',
                '    stdout: |',
                '      cli-app v{{semver}}',
                '      cwd {{workdir}}',
                '',
            ].join('\n'),
        );

        // Given - one update run against output carrying two EXTRA lines
        process.env.TEST_UPDATE = '1';
        try {
            await cli.run(path);
        } finally {
            delete process.env.TEST_UPDATE;
        }

        // Then - both tokens survived the shift, and nothing was pinned
        const written = readFileSync(path, 'utf8');
        expect(written).toContain('cli-app v{{semver}}');
        expect(written).toContain('cwd {{workdir}}');
        expect(written).not.toContain('cwd /');
    });

    test('files:, the command and the run order are never rewritten', async () => {
        // Given - a document whose files: assertion is deliberately wrong
        const path = scratchFile(
            [
                'description: leaves everything but the streams alone',
                'runs:',
                '  - command: scaffold',
                '    exit: 0',
                '    files:',
                '      out/main.go: { contains: package rust }',
                '',
            ].join('\n'),
        );

        // Given - one update run
        process.env.TEST_UPDATE = '1';
        try {
            await cli.run(path);
        } finally {
            delete process.env.TEST_UPDATE;
        }

        // Then - the wrong assertion is still there: an update refreshes the
        // Streams and the exit code, and nothing a human decided
        expect(readFileSync(path, 'utf8')).toContain('out/main.go: { contains: package rust }');
    });

    test('an update that changes nothing gives the file back byte for byte', async () => {
        // Given - a true golden, spelled the way the repository formatter
        // Spells it: a padded flow mapping, an unpadded flow sequence, one
        // Broken over lines, and a comment
        const source = [
            '# the ground of the case',
            'description: rewrites nothing when nothing moved',
            'runs:',
            '    - command: scaffold',
            '      exit: 0',
            '      stdout: |',
            '          Scaffolded',
            '      files:',
            "          out/main.go: { contains: 'package main' }",
            "          out/docs/README.md: { contains: ['# Docs'] }",
            '          out/go.mod:',
            '              {',
            "                  contains: ['module example'],",
            '              }',
            '',
        ].join('\n');
        const path = scratchFile(source);

        // Given - one update run
        process.env.TEST_UPDATE = '1';
        try {
            await cli.run(path);
        } finally {
            delete process.env.TEST_UPDATE;
        }

        // Then - not one byte moved: a rewrite restates the streams, and a
        // Collection it never read is not the writer's to restyle
        expect(readFileSync(path, 'utf8')).toBe(source);
    });

    test('a frozen document is never rewritten under TEST_UPDATE', async () => {
        // Given - a deliberately-wrong golden, run in update mode
        const target = resolve(import.meta.dirname, '_fixtures/wrong-stdout.spec.yaml');
        const before = readFileSync(target, 'utf8');
        process.env.TEST_UPDATE = '1';
        let message: string;
        try {
            message = await failureOf(
                cli.run('_fixtures/wrong-stdout.spec.yaml', { frozen: true }),
            );
        } finally {
            delete process.env.TEST_UPDATE;
        }

        // Then - it still threw its diff, and the file on disk is untouched
        expect(message).toContain('Spec mismatch');
        expect(readFileSync(target, 'utf8')).toBe(before);
    });
});
