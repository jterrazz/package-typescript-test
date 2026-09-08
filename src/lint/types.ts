/**
 * Local structural types for the slice of oxlint's JS-plugin API this layer uses.
 *
 * oxlint 1.74 does not publicly export its `Plugin` / `Rule` / `Context` types
 * (only `RuleTester`, from `oxlint/plugins-dev`), so we describe the exact subset
 * we depend on here. Declaring them locally keeps the rules layer importing
 * NOTHING from the framework runtime — only these ambient shapes and, where a
 * rule needs it, pure helpers from `core/` (e.g. the token list, the kebab-case
 * utilities). The API is ESLint-compatible, so these shapes mirror ESTree.
 */

/** A source comment, as exposed by oxlint's ESTree-compatible `sourceCode`. */
export type Comment = {
    range?: [number, number];
    start?: number;
    type: 'Block' | 'Line' | 'Shebang';
    value: string;
};

/**
 * Minimal AST node. Rules narrow by `type` and read known fields defensively —
 * the full generated node union is not re-exported, and structural access keeps
 * the layer decoupled from oxlint's internal type churn.
 */
export type AstNode = {
    type: string;
    [key: string]: unknown;
};

/** The slice of `context.sourceCode` the rules read. */
export type SourceCode = {
    getAllComments: () => Comment[];
    getCommentsInside: (node: AstNode) => Comment[];
    text: string;
};

/** A diagnostic accepted by `context.report`. */
export type Diagnostic = {
    data?: Record<string, number | string>;
    messageId?: string;
    message?: string;
    node?: AstNode;
};

/** Rule context passed to `create`. */
export type RuleContext = {
    filename: string;
    id: string;
    /** Configured rule options (`['error', …options]` minus the severity). */
    options: readonly unknown[];
    physicalFilename: string;
    report: (diagnostic: Diagnostic) => void;
    sourceCode: SourceCode;
};

/** A visitor: node-type keys → handlers invoked on entry. */
export type Visitor = Record<string, (node: AstNode) => void>;

/**
 * The normative documentation a rule carries — the code is the source of truth
 * for the mechanized catalogue (docs-as-code inversion). Every plugin rule sets
 * `meta.docs` to its {@link RuleDoc} entry from `manifest.ts`; the catalogue
 * generator reads these to (re)write `docs/13-linting.md` and the annex.
 */
export type RuleDoc = {
    /** Enforcement channel — the four faces the manifest assembles. */
    channel: 'checker' | 'process' | 'runtime' | 'statique';
    /** The French normative sentence (the constitution's per-rule text, moved here). */
    convention: string;
    /**
     * The specification facet the rule guards — segments the catalogue like
     * the constructors segment the API. `'shared'` for cross-facet rules.
     */
    facet?: 'api' | 'cli' | 'jobs' | 'mobile' | 'shared' | 'website';
    /** Convention family letter, e.g. `'A'`. */
    family: string;
    /** Convention code, e.g. `'A1'`. */
    id: string;
    /** One line: why the rule exists. */
    rationale: string;
};

/** Rule metadata (the subset we set). */
export type RuleMeta = {
    defaultOptions?: unknown[];
    docs?: RuleDoc & { description?: string };
    messages?: Record<string, string>;
    /** JSON schema for options — required by oxlint for rules that take options. */
    schema?: false | unknown[];
    type?: 'layout' | 'problem' | 'suggestion';
};

/** A lint rule in oxlint's `create` form. */
export type LintRule = {
    create: (context: RuleContext) => Visitor;
    meta?: RuleMeta;
};

/** An oxlint JS plugin: a namespace plus its rules. */
export type LintPlugin = {
    meta: { name: string };
    rules: Record<string, LintRule>;
};
