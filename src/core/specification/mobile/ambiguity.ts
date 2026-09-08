import type { MobileElementMatch, MobileElementRef } from '../../ports/device.port.js';
import { formatElement } from '../website/ambiguity.js';

/**
 * The ambiguity refusal, mobile edition — CONVENTIONS W3.
 *
 * A mobile descriptor must designate exactly one element. Acting on "the
 * first match" is the failure mode this module exists to prevent: the spec
 * keeps passing while the visitor taps something else, and nothing ever
 * reports it. So when a descriptor matches several elements the framework
 * refuses, and the refusal carries everything needed to fix it without
 * opening the simulator — the descriptor in the caller's own vocabulary,
 * every candidate, and the concrete rewrites that would resolve it.
 *
 * The element vocabulary is shared with the website facet, so the source
 * rendering (`formatElement`) is too; only the evidence differs — XCUITest
 * types, labels and accessibility identifiers instead of tags and landmarks.
 * Pure string building: the appium integration stays a thin adapter.
 */

/** `1. Button "Bookmark"  [testId: event-42]` — one evidence line per candidate. */
function formatMatch(match: MobileElementMatch, index: number): string {
    const label = match.label === undefined ? '' : ` ${JSON.stringify(match.label)}`;
    const value = match.value === undefined ? '' : `  value=${JSON.stringify(match.value)}`;
    const identifier = match.identifier === undefined ? '' : `  [testId: ${match.identifier}]`;
    return `  ${index + 1}. ${match.type}${label}${value}${identifier}`;
}

/**
 * The rewrites worth offering, in the order they should be tried. Scoping is
 * always available; `exact` only when it would actually narrow the set, and
 * the count it would leave is stated so a still-ambiguous suggestion never
 * reads as a fix; distinct identifiers make `testId()` a concrete rewrite
 * rather than a guess.
 */
function formatFixes(element: MobileElementRef, matches: MobileElementMatch[]): string[] {
    const fixes: string[] = [];

    if (!element.scope) {
        fixes.push(
            `scope it       within(testId('…'), ${formatElement(element)}) — a screen has no landmarks; any descriptor works as the scope`,
        );
    }

    if (!element.exact && element.name !== undefined) {
        const remaining = matches.filter((match) => match.label === element.name).length;
        if (remaining > 0 && remaining < matches.length) {
            fixes.push(
                `exact name     ${formatElement({ exact: true, kind: element.kind, name: element.name })}` +
                    `   [leaves ${remaining} of ${matches.length}]`,
            );
        }
    }

    const identifiers = [
        ...new Set(
            matches
                .map((match) => match.identifier)
                .filter((identifier): identifier is string => identifier !== undefined),
        ),
    ];
    if (identifiers.length > 1 && element.kind !== 'testId') {
        fixes.push(
            `test id        testId(${JSON.stringify(identifiers[0])})   [also here: ${identifiers
                .slice(1)
                .join(', ')}]`,
        );
    }

    fixes.push('other element  a button() or field() may name one thing where this does not');
    return fixes;
}

/**
 * Build the refusal thrown when a descriptor matches more than one element
 * on the screen.
 *
 * @param options.element The descriptor as the caller wrote it.
 * @param options.matches Every candidate, in screen order (already truncated).
 */
export function describeMobileAmbiguity(options: {
    element: MobileElementRef;
    matches: MobileElementMatch[];
}): string {
    const { element, matches } = options;
    const fixes = formatFixes(element, matches).map((fix) => `  • ${fix}`);

    return [
        `Ambiguous element: ${formatElement(element)} matched ${matches.length} elements on the screen.`,
        '',
        'A spec must designate exactly one element. Acting on the first match would let',
        'this test keep passing while the visitor taps something else.',
        '',
        'Matched:',
        ...matches.map((match, index) => formatMatch(match, index)),
        '',
        'Disambiguate with one of:',
        ...fixes,
        '',
        'Docs: docs/15-mobile.md#designating-exactly-one-element (CONVENTIONS W3)',
    ].join('\n');
}
