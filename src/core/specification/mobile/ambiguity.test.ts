import { describe, expect, test } from 'vitest';

import type { MobileElementMatch } from '../../ports/device.port.js';
import { button, content, testId, within } from '../website/elements.js';
import { describeMobileAmbiguity } from './ambiguity.js';

const match = (overrides: Partial<MobileElementMatch> = {}): MobileElementMatch => ({
    label: 'Bookmark',
    type: 'Button',
    ...overrides,
});

describe('describeMobileAmbiguity', () => {
    test('names the descriptor and the count', () => {
        // Given - three candidates for one button
        const message = describeMobileAmbiguity({
            element: button('Bookmark'),
            matches: [match(), match({ label: 'Bookmark all' }), match()],
        });

        // Then - the headline carries the caller's own vocabulary
        expect(message).toContain('button("Bookmark") matched 3 elements on the screen');
    });

    test('enumerates every candidate with its type, label and identifier', () => {
        // Given - candidates carrying accessibility identifiers
        const message = describeMobileAmbiguity({
            element: button('Bookmark'),
            matches: [
                match({ identifier: 'event-1-bookmark' }),
                match({ identifier: 'event-2-bookmark' }),
            ],
        });

        // Then - each line is readable without opening the simulator
        expect(message).toContain('1. Button "Bookmark"  [testId: event-1-bookmark]');
        expect(message).toContain('2. Button "Bookmark"  [testId: event-2-bookmark]');
    });

    test('renders a value when the candidate carries one', () => {
        // Given - two text fields distinguished only by their content
        const message = describeMobileAmbiguity({
            element: content('a@b.test'),
            matches: [
                match({ label: 'Email', type: 'TextField', value: 'a@b.test' }),
                match({ label: 'Confirm email', type: 'TextField', value: 'a@b.test' }),
            ],
        });

        // Then - the value is part of the evidence
        expect(message).toContain('1. TextField "Email"  value="a@b.test"');
    });

    test('suggests scoping first — a screen has no landmarks to name', () => {
        // Given - an unscoped ambiguous descriptor
        const message = describeMobileAmbiguity({
            element: button('Bookmark'),
            matches: [match(), match()],
        });

        // Then - within() is offered with any-descriptor scoping spelled out
        expect(message).toContain('within(testId(\'…\'), button("Bookmark"))');
    });

    test('suggests exact only when it would narrow the set, with what it leaves', () => {
        // Given - one candidate matched as a substring
        const message = describeMobileAmbiguity({
            element: button('Bookmark'),
            matches: [match(), match({ label: 'Bookmark all' })],
        });

        // Then - the remaining count keeps the suggestion honest
        expect(message).toContain('button("Bookmark", { exact: true })');
        expect(message).toContain('leaves 1 of 2');
    });

    test('omits the exact suggestion when every candidate matches the name whole', () => {
        // Given - two identical labels, where exact would change nothing
        const message = describeMobileAmbiguity({
            element: button('Bookmark'),
            matches: [match(), match()],
        });

        // Then - no suggestion that would leave the spec just as ambiguous
        expect(message).not.toContain('exact: true');
    });

    test('offers the distinct identifiers as a concrete testId rewrite', () => {
        // Given - candidates whose identifiers differ
        const message = describeMobileAmbiguity({
            element: button('Bookmark'),
            matches: [
                match({ identifier: 'event-1-bookmark' }),
                match({ identifier: 'event-2-bookmark' }),
            ],
        });

        // Then - the rewrite is copy-pasteable and names the alternative
        expect(message).toContain('testId("event-1-bookmark")');
        expect(message).toContain('also here: event-2-bookmark');
    });

    test('does not re-suggest scoping a descriptor that is already scoped', () => {
        // Given - an ambiguity inside an existing scope
        const message = describeMobileAmbiguity({
            element: within(testId('event-list'), button('Bookmark')),
            matches: [match(), match()],
        });

        // Then - scoping is not offered again; the other routes remain
        expect(message).not.toContain('scope it');
        expect(message).toContain('other element');
    });

    test('states the rule and where it is documented', () => {
        // Given - any refusal
        const message = describeMobileAmbiguity({
            element: button('Bookmark'),
            matches: [match(), match()],
        });

        // Then - an agent reading the failure can find the full rule
        expect(message).toContain('CONVENTIONS W3');
        expect(message).toContain('docs/15-mobile.md#designating-exactly-one-element');
    });
});
