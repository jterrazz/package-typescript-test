import { importSourceVisitor, segments } from '../ast.js';
import { RULE_DOCS } from '../manifest.js';
import type { LintRule, RuleContext, Visitor } from '../types.js';

/** A specifier reaching into a provider folder — the internal half of contracts/. */
const INTERNAL_UNIT = /(?:^|\/)contracts\/(?:anthropic|http|openai)\//u;

/**
 * CONVENTIONS C10 — the contracts boundary. A feature's `contracts/` folder has
 * a PUBLIC half (`*.contracts.ts` facades: the default export is the world, the
 * named exports are its scenarios) and an INTERNAL half (the `http/`, `openai/`
 * and `anthropic/` unit contracts the facades compose). Outside `contracts/`,
 * importing a unit is an error — a test routes through the facade, so a
 * scenario is named once, next to the world it derives from.
 */
export const c10ContractsBoundary: LintRule = {
    create(context: RuleContext): Visitor {
        const parts = segments(context.physicalFilename);
        if (!parts.includes('specs')) {
            return {};
        }
        // Inside contracts/ the internal half is the file's own business.
        if (parts.slice(0, -1).includes('contracts')) {
            return {};
        }
        return importSourceVisitor(({ node, source }) => {
            if (INTERNAL_UNIT.test(source)) {
                context.report({ data: { source }, messageId: 'internal', node });
            }
        });
    },
    meta: {
        docs: RULE_DOCS['c10-contracts-boundary'],
        messages: {
            internal:
                'Import "{{source}}" reaches into a provider folder — only contracts/*.contracts.ts is importable from a test; add a named scenario export there instead (C10 — see docs/13-linting.md).',
        },
        type: 'problem',
    },
};
