import type { ElementMatch, ElementRef } from '../../ports/browser.port.js';

/**
 * The ambiguity refusal — CONVENTIONS W3.
 *
 * A visit descriptor must designate exactly one element. Acting on "the
 * first match" is the failure mode this module exists to prevent: the spec
 * keeps passing while the visitor clicks something else, and nothing ever
 * reports it. So when a descriptor matches several elements the framework
 * refuses, and the refusal has to carry everything needed to fix it without
 * opening a browser — the descriptor in the caller's own vocabulary, every
 * candidate, and the concrete rewrites that would resolve it.
 *
 * Pure string building: it takes captured data and returns a message, so the
 * wording is unit-testable and the browser integration stays a thin adapter.
 */

/** `kind` → the constructor that builds it, so errors echo the caller's source. */
const CONSTRUCTORS: Record<ElementRef['kind'], string> = {
    banner: 'banner',
    button: 'button',
    complementary: 'complementary',
    contentinfo: 'contentinfo',
    field: 'field',
    form: 'form',
    heading: 'heading',
    link: 'link',
    main: 'main',
    navigation: 'navigation',
    region: 'region',
    search: 'search',
    testId: 'testId',
    text: 'content',
};

/** The landmark a context string maps back to, for a copy-pasteable suggestion. */
const CONTEXT_LANDMARKS: Record<string, string> = {
    aside: 'complementary()',
    banner: 'banner()',
    complementary: 'complementary()',
    contentinfo: 'contentinfo()',
    footer: 'contentinfo()',
    form: 'form()',
    header: 'banner()',
    main: 'main()',
    nav: 'navigation()',
    navigation: 'navigation()',
    search: 'search()',
};

/**
 * Render a descriptor as the source that would build it — `link('Articles')`,
 * `within(navigation(), link('Articles', { exact: true }))`. The error speaks
 * the vocabulary the author wrote, never playwright's.
 */
export function formatElement(element: ElementRef): string {
    const bare = formatBare(element);
    return element.scope ? `within(${formatElement(element.scope)}, ${bare})` : bare;
}

function formatBare(element: ElementRef): string {
    const args: string[] = [];
    if (element.name !== undefined) {
        args.push(JSON.stringify(element.name));
    }
    if (element.exact) {
        args.push('{ exact: true }');
    }
    return `${CONSTRUCTORS[element.kind]}(${args.join(', ')})`;
}

/** `1. <a href="/articles">Articles</a>  in <nav>` — one evidence line per candidate. */
function formatMatch(match: ElementMatch, index: number): string {
    const attribute = match.detail ? ` ${quoteDetail(match)}` : '';
    const context = match.context ? `  in <${match.context}>` : '';
    return `  ${index + 1}. <${match.tag}${attribute}>${match.text}</${match.tag}>${context}`;
}

function quoteDetail(match: ElementMatch): string {
    const attribute = match.tag === 'a' ? 'href' : 'name';
    return `${attribute}=${JSON.stringify(match.detail)}`;
}

/**
 * The rewrites worth offering, in the order they should be tried. Scoping is
 * always available; `exact` only when it would actually narrow the set, and
 * the count it would leave is stated so a still-ambiguous suggestion never
 * reads as a fix.
 */
function formatFixes(element: ElementRef, matches: ElementMatch[]): string[] {
    const fixes: string[] = [];

    const landmarks = [
        ...new Set(
            matches
                .map((match) => match.context && CONTEXT_LANDMARKS[match.context])
                .filter((landmark): landmark is string => Boolean(landmark)),
        ),
    ];
    if (landmarks.length > 0 && !element.scope) {
        fixes.push(
            `scope it       within(${landmarks[0]}, ${formatBare(element)})${
                landmarks.length > 1 ? `   [also here: ${landmarks.slice(1).join(', ')}]` : ''
            }`,
        );
    } else if (!element.scope) {
        fixes.push(`scope it       within(main(), ${formatBare(element)})`);
    }

    if (!element.exact && element.name !== undefined) {
        const remaining = matches.filter((match) => match.text === element.name).length;
        if (remaining > 0 && remaining < matches.length) {
            fixes.push(
                `exact name     ${formatBare({ ...element, exact: true })}` +
                    `   [leaves ${remaining} of ${matches.length}]`,
            );
        }
    }

    fixes.push(
        'other element  a heading(), button() or field() may name one thing where this does not',
    );
    return fixes;
}

/**
 * The W3 refusal. A distinct class so the visit wrapper can recognize an
 * already-complete message and let it through instead of nesting it inside
 * `visit scenario failed: …`, which would print the whole thing twice.
 */
export class AmbiguousElementError extends Error {
    override readonly name = 'AmbiguousElementError';
}

/**
 * Build the refusal thrown when a descriptor matches more than one element.
 *
 * @param options.element The descriptor as the caller wrote it.
 * @param options.matches Every candidate, in DOM order (already truncated).
 * @param options.url The page the visitor was on when it happened.
 */
export function describeAmbiguity(options: {
    element: ElementRef;
    matches: ElementMatch[];
    url: string;
}): string {
    const { element, matches, url } = options;
    const fixes = formatFixes(element, matches).map((fix) => `  • ${fix}`);

    return [
        `Ambiguous element: ${formatElement(element)} matched ${matches.length} elements on ${url}.`,
        '',
        'A spec must designate exactly one element. Acting on the first match would let',
        'this test keep passing while the visitor interacts with something else.',
        '',
        'Matched:',
        ...matches.map((match, index) => formatMatch(match, index)),
        '',
        'Disambiguate with one of:',
        ...fixes,
        '',
        'Docs: docs/14-website.md#designating-exactly-one-element (CONVENTIONS W3)',
    ].join('\n');
}
