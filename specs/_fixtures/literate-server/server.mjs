#!/usr/bin/env node
/**
 * The server a literate `serve:` line starts.
 *
 * It picks its OWN port (listen on 0) and announces it on stdout —
 * `listening on port <n>` — which is the readiness form a `serve:`
 * registration declares: a regex whose one capture group is the port. The
 * framework reads the banner, builds the URL, and binds it to the variable the
 * registration names.
 *
 * `LITERATE_GREETING` shows the per-line extra env of `serve: echo KEY=value`.
 *
 * Two routes make it a data-driven stub, over the working directory the runner
 * hands every served child as `TEST_WORKDIR`:
 *
 * - `/workdir` answers that path itself, so a document can state it equals the
 *   directory its runs execute in;
 * - `/answers/<system>/<file>` answers with the file of that name under the
 *   workdir — a document's `fixture:` is what decides the content, and a
 *   missing route file is a loud 404 rather than an improvised answer.
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const greeting = process.env.LITERATE_GREETING ?? 'hello';
const workdir = process.env.TEST_WORKDIR ?? 'unset';

const server = createServer((request, response) => {
    if (request.url === '/workdir') {
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.end(`${workdir}\n`);
        return;
    }
    if (request.url.startsWith('/answers/')) {
        const file = join(workdir, request.url.slice(1));
        let content;
        try {
            content = readFileSync(file, 'utf8');
        } catch {
            response.writeHead(404, { 'content-type': 'text/plain' });
            response.end(`no answer file at ${file}\n`);
            return;
        }
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(content);
        return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ greeting, path: request.url }));
});

server.listen(0, '127.0.0.1', () => {
    process.stdout.write(`listening on port ${server.address().port}\n`);
});
