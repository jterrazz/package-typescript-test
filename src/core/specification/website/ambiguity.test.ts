import { describe, expect, test } from 'vitest';

import type { ElementMatch } from '../../ports/browser.port.js';
import { describeAmbiguity, formatElement } from './ambiguity.js';
import { link, main, navigation, region, within } from './elements.js';

const match = (overrides: Partial<ElementMatch> = {}): ElementMatch => ({
    tag: 'a',
    text: 'Articles',
    ...overrides,
});

describe('formatElement', () => {
    test('renders a descriptor as the source that would build it', () => {
        // Given - a plain named descriptor
        const element = link('Articles');

        // Then - the error speaks the caller's vocabulary, not playwright's
        expect(formatElement(element)).toBe('link("Articles")');
    });

    test('renders the exact option', () => {
        // Given - a descriptor asking for a whole-name match
        const element = link('Articles', { exact: true });

        // Then - the option is echoed as written
        expect(formatElement(element)).toBe('link("Articles", { exact: true })');
    });

    test('renders an anonymous landmark without arguments', () => {
        // Given - a landmark carrying no accessible name
        const element = main();

        // Then - no empty string is invented for it
        expect(formatElement(element)).toBe('main()');
    });

    test('renders a scope as the within() call that produced it', () => {
        // Given - a scoped descriptor
        const element = within(navigation(), link('Articles'));

        // Then - the rendering round-trips to source the author could paste
        expect(formatElement(element)).toBe('within(navigation(), link("Articles"))');
    });

    test('renders a nested scope outside-in', () => {
        // Given - a target scoped twice
        const inner = within(region('Series'), link('Part 2'));
        const element = within(main(), inner);

        // Then - the chain reads from the outermost container inward
        expect(formatElement(element)).toBe(
            'within(within(main(), region("Series")), link("Part 2"))',
        );
    });
});

describe('describeAmbiguity', () => {
    test('names the descriptor, the count and the page', () => {
        // Given - three candidates for one link
        const message = describeAmbiguity({
            element: link('Articles'),
            matches: [match(), match({ text: 'Read Articles' }), match()],
            url: 'http://site.test/',
        });

        // Then - the headline carries all three facts
        expect(message).toContain('link("Articles") matched 3 elements on http://site.test/');
    });

    test('enumerates every candidate with its tag, detail and landmark', () => {
        // Given - candidates sitting in different landmarks
        const message = describeAmbiguity({
            element: link('Articles'),
            matches: [
                match({ context: 'nav', detail: '/articles' }),
                match({ context: 'footer', detail: '/articles' }),
            ],
            url: 'http://site.test/',
        });

        // Then - each line is readable without opening a browser
        expect(message).toContain('1. <a href="/articles">Articles</a>  in <nav>');
        expect(message).toContain('2. <a href="/articles">Articles</a>  in <footer>');
    });

    test('suggests scoping to a landmark the candidates actually sit in', () => {
        // Given - candidates in a nav and a footer
        const message = describeAmbiguity({
            element: link('Articles'),
            matches: [match({ context: 'nav' }), match({ context: 'footer' })],
            url: 'http://site.test/',
        });

        // Then - the suggestion is copy-pasteable and names the alternative
        expect(message).toContain('within(navigation(), link("Articles"))');
        expect(message).toContain('also here: contentinfo()');
    });

    test('suggests exact only when it would narrow the set, with what it leaves', () => {
        // Given - one candidate matched as a substring
        const message = describeAmbiguity({
            element: link('Articles'),
            matches: [match(), match({ text: 'Read Articles' })],
            url: 'http://site.test/',
        });

        // Then - the remaining count keeps the suggestion honest
        expect(message).toContain('link("Articles", { exact: true })');
        expect(message).toContain('leaves 1 of 2');
    });

    test('omits the exact suggestion when every candidate matches the name whole', () => {
        // Given - two identical names, where exact would change nothing
        const message = describeAmbiguity({
            element: link('Articles'),
            matches: [match(), match()],
            url: 'http://site.test/',
        });

        // Then - no suggestion that would leave the spec just as ambiguous
        expect(message).not.toContain('exact: true');
    });

    test('does not re-suggest scoping a descriptor that is already scoped', () => {
        // Given - an ambiguity inside an existing scope
        const message = describeAmbiguity({
            element: within(navigation(), link('Articles')),
            matches: [match({ context: 'nav' }), match({ context: 'nav' })],
            url: 'http://site.test/',
        });

        // Then - scoping is not offered again; the other routes remain
        expect(message).not.toContain('scope it');
        expect(message).toContain('other element');
    });

    test('states the rule and where it is documented', () => {
        // Given - any refusal
        const message = describeAmbiguity({
            element: link('Articles'),
            matches: [match(), match()],
            url: 'http://site.test/',
        });

        // Then - an agent reading the failure can find the full rule
        expect(message).toContain('CONVENTIONS W3');
        expect(message).toContain('docs/14-website.md#designating-exactly-one-element');
    });
});
