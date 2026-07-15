/**
 * Berry language tokenizer and simple symbol extractor.
 *
 * The tokenizer converts raw text into a stream of Token objects.
 * The symbol extractor walks the token stream and builds a SymbolTable
 * that records class definitions, function definitions, and variable
 * declarations in the document.
 */

// ---------------------------------------------------------------------------
// Token types
// ---------------------------------------------------------------------------

export type TokenKind =
    | 'keyword'
    | 'identifier'
    | 'string'
    | 'number'
    | 'operator'
    | 'comment';

export interface Token {
    kind: TokenKind;
    text: string;
    line: number;
    start: number;
    length: number;
    /** For multi-line comments: ending line number */
    endLine?: number;
    /** For multi-line comments: ending column (exclusive) */
    endChar?: number;
}

// ---------------------------------------------------------------------------
// Tokenizer constants
// ---------------------------------------------------------------------------

const MULTI_CHAR_OPERATORS = [
    '<<=', '>>=',
    '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=',
    '==', '!=', '<=', '>=', '<<', '>>', '&&', '||', '..', ':=', '->',
];

const SINGLE_CHAR_OPERATORS = new Set([
    '(', ')', '[', ']', '{', '}', '.', '-', '!', '~',
    '*', '/', '%', '+', '&', '^', '|', '<', '>', '=',
    ':', ',', ';', '?',
]);

const CONTROL_KEYWORDS = new Set([
    'if', 'elif', 'else', 'for', 'while', 'do', 'end',
    'break', 'continue', 'return', 'try', 'except', 'raise',
]);

const DECLARATION_KEYWORDS = new Set(['def', 'class', 'var', 'static']);
const NAMESPACE_KEYWORDS = new Set(['import', 'as']);
const CONSTANT_KEYWORDS = new Set(['true', 'false', 'nil', 'self', 'super', '_class']);

export const ALL_KEYWORDS = new Set([
    ...CONTROL_KEYWORDS,
    ...DECLARATION_KEYWORDS,
    ...NAMESPACE_KEYWORDS,
    ...CONSTANT_KEYWORDS,
]);

const IDENT_START = /[A-Za-z_]/;
const IDENT_PART = /[A-Za-z0-9_]/;
const NUMBER_RE = /^(?:0[xX][A-Fa-f0-9]+|(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?)/;

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

/**
 * Tokenizes a Berry source text into a flat list of Token objects.
 * Multi-line block comments (#- ... -#) produce a single token with
 * `endLine` / `endChar` set.
 */
export function tokenize(text: string): Token[] {
    const lines = text.split(/\r?\n/);
    const tokens: Token[] = [];
    let inBlockComment = false;
    let blockStartLine = 0;
    let blockStartChar = 0;

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx];
        let i = 0;

        while (i < line.length) {
            // ---- Inside a block comment ----
            if (inBlockComment) {
                const end = line.indexOf('-#', i);
                if (end >= 0) {
                    tokens.push({
                        kind: 'comment',
                        text: '',
                        line: blockStartLine,
                        start: blockStartChar,
                        length: 0,
                        endLine: lineIdx,
                        endChar: end + 2,
                    });
                    inBlockComment = false;
                    i = end + 2;
                    continue;
                }
                break; // rest of the line is inside the comment
            }

            const ch = line[i];

            // ---- Whitespace ----
            if (/\s/.test(ch)) { i++; continue; }

            // ---- Comments ----
            if (ch === '#') {
                if (line[i + 1] === '-') {
                    const end = line.indexOf('-#', i + 2);
                    if (end >= 0) {
                        tokens.push({
                            kind: 'comment',
                            text: line.slice(i, end + 2),
                            line: lineIdx,
                            start: i,
                            length: end + 2 - i,
                        });
                        i = end + 2;
                        continue;
                    }
                    inBlockComment = true;
                    blockStartLine = lineIdx;
                    blockStartChar = i;
                    break;
                }
                // line comment
                tokens.push({
                    kind: 'comment',
                    text: line.slice(i),
                    line: lineIdx,
                    start: i,
                    length: line.length - i,
                });
                break;
            }

            // ---- f-strings (f"..." or f'...') ----
            if ((ch === 'f' || ch === 'F') &&
                (line[i + 1] === '"' || line[i + 1] === "'")) {
                const quote = line[i + 1];
                let j = i + 2;
                let escaped = false;
                while (j < line.length) {
                    const c = line[j];
                    if (!escaped && c === quote) { j++; break; }
                    escaped = !escaped && c === '\\';
                    j++;
                }
                tokens.push({ kind: 'string', text: line.slice(i, j), line: lineIdx, start: i, length: j - i });
                i = j;
                continue;
            }

            // ---- Regular strings ----
            if (ch === '"' || ch === "'") {
                const quote = ch;
                let j = i + 1;
                let escaped = false;
                while (j < line.length) {
                    const c = line[j];
                    if (!escaped && c === quote) { j++; break; }
                    escaped = !escaped && c === '\\';
                    j++;
                }
                tokens.push({ kind: 'string', text: line.slice(i, j), line: lineIdx, start: i, length: j - i });
                i = j;
                continue;
            }

            // ---- Numbers ----
            const numMatch = line.slice(i).match(NUMBER_RE);
            if (numMatch) {
                tokens.push({ kind: 'number', text: numMatch[0], line: lineIdx, start: i, length: numMatch[0].length });
                i += numMatch[0].length;
                continue;
            }

            // ---- Identifiers / keywords ----
            if (IDENT_START.test(ch)) {
                let j = i + 1;
                while (j < line.length && IDENT_PART.test(line[j])) j++;
                const word = line.slice(i, j);
                tokens.push({
                    kind: ALL_KEYWORDS.has(word) ? 'keyword' : 'identifier',
                    text: word,
                    line: lineIdx,
                    start: i,
                    length: j - i,
                });
                i = j;
                continue;
            }

            // ---- Multi-character operators ----
            let matched = false;
            for (const op of MULTI_CHAR_OPERATORS) {
                if (line.startsWith(op, i)) {
                    tokens.push({ kind: 'operator', text: op, line: lineIdx, start: i, length: op.length });
                    i += op.length;
                    matched = true;
                    break;
                }
            }
            if (matched) continue;

            // ---- Single-character operators ----
            if (SINGLE_CHAR_OPERATORS.has(ch)) {
                tokens.push({ kind: 'operator', text: ch, line: lineIdx, start: i, length: 1 });
                i++;
                continue;
            }

            // ---- Unknown character (skip) ----
            i++;
        }
    }

    // Unterminated block comment — extend to end of file
    if (inBlockComment) {
        const lastLine = lines.length - 1;
        tokens.push({
            kind: 'comment',
            text: '',
            line: blockStartLine,
            start: blockStartChar,
            length: 0,
            endLine: lastLine,
            endChar: lines[lastLine]?.length ?? 0,
        });
    }

    return tokens;
}

// ---------------------------------------------------------------------------
// Symbol table
// ---------------------------------------------------------------------------

export type SymbolKind =
    | 'class'
    | 'function'
    | 'method'
    | 'variable'
    | 'parameter'
    | 'import';

export interface SymbolInfo {
    kind: SymbolKind;
    name: string;
    line: number;
    character: number;
    length: number;
    /** The enclosing class name for methods */
    className?: string;
    /** Parameter names for functions / methods */
    parameters?: string[];
    /** Import alias (for `import X as Y`) */
    alias?: string;
    /** For functions/classes: the line where the `end` keyword appears */
    endLine?: number;
}

export interface ParsedDocument {
    tokens: Token[];
    symbols: SymbolInfo[];
    /** Unmatched block openers, used for diagnostics */
    unmatchedBlocks: Array<{ keyword: string; line: number; character: number }>;
}

// Keywords that open a new block scope and need a matching `end`
const BLOCK_OPEN = new Set(['if', 'while', 'for', 'do', 'def', 'class', 'try']);
// `elif`, `else`, `except` don't open a new block on the stack — they just
// continue an existing one. We track them separately for diagnostics.

/**
 * Parses a Berry document: tokenizes the text and extracts symbol definitions.
 */
export function parseDocument(text: string): ParsedDocument {
    const tokens = tokenize(text);
    const symbols: SymbolInfo[] = [];

    // Stack entries: {keyword, line, char, symbolIndex (for functions/classes)}
    interface StackEntry {
        keyword: string;
        line: number;
        character: number;
        /** Index into symbols[] for this scope's definition (if any) */
        symbolIndex: number | null;
    }
    const blockStack: StackEntry[] = [];

    // Track the "current class" context
    const classStack: string[] = [];

    let i = 0;

    // Helper to peek ahead
    const peek = (offset: number): Token | undefined => tokens[i + offset];
    const cur  = (): Token | undefined => tokens[i];

    const skipPast = (check: (t: Token) => boolean): void => {
        while (i < tokens.length && !check(tokens[i])) i++;
    };

    while (i < tokens.length) {
        const token = cur()!;

        // ---- Skip non-keywords in the primary pass ----
        if (token.kind !== 'keyword') { i++; continue; }

        const word = token.text;

        // ----------------------------------------------------------------
        // class Foo [: Bar]
        // ----------------------------------------------------------------
        if (word === 'class') {
            const kw = token;
            i++;
            const nameToken = cur();
            if (nameToken && nameToken.kind === 'identifier') {
                const symIdx = symbols.length;
                symbols.push({
                    kind: 'class',
                    name: nameToken.text,
                    line: nameToken.line,
                    character: nameToken.start,
                    length: nameToken.length,
                    parameters: [],
                });
                blockStack.push({ keyword: 'class', line: kw.line, character: kw.start, symbolIndex: symIdx });
                classStack.push(nameToken.text);
                i++;
            } else {
                blockStack.push({ keyword: 'class', line: kw.line, character: kw.start, symbolIndex: null });
            }
            continue;
        }

        // ----------------------------------------------------------------
        // def name(params) or def(params) [anonymous]
        // ----------------------------------------------------------------
        if (word === 'def') {
            const kw = token;
            i++;
            const nameToken = cur();
            let funcName: string | null = null;
            let funcLine = kw.line;
            let funcChar = kw.start;
            let funcLen = 3; // "def"

            if (nameToken && nameToken.kind === 'identifier') {
                funcName = nameToken.text;
                funcLine = nameToken.line;
                funcChar = nameToken.start;
                funcLen  = nameToken.length;
                i++;
            } else if (nameToken && nameToken.kind === 'operator' && nameToken.text !== '(') {
                // operator overload: def +(other) ...
                funcName = nameToken.text;
                funcLine = nameToken.line;
                funcChar = nameToken.start;
                funcLen  = nameToken.length;
                i++;
            }
            // else: anonymous function def(...)

            // Collect parameter names
            const params: string[] = [];
            if (cur() && cur()!.kind === 'operator' && cur()!.text === '(') {
                i++; // skip '('
                let depth = 1;
                while (i < tokens.length) {
                    const t = cur()!;
                    if (t.kind === 'operator' && t.text === '(') { depth++; i++; continue; }
                    if (t.kind === 'operator' && t.text === ')') {
                        depth--;
                        i++;
                        if (depth === 0) break;
                        continue;
                    }
                    if (depth === 1 && t.kind === 'identifier') {
                        params.push(t.text);
                        const symIdx = symbols.length;
                        symbols.push({
                            kind: 'parameter',
                            name: t.text,
                            line: t.line,
                            character: t.start,
                            length: t.length,
                            className: classStack.length > 0 ? classStack[classStack.length - 1] : undefined,
                        });
                        i++;
                        continue;
                    }
                    i++;
                }
            }

            // Lambda shorthand: def(x) -> expr  (no `end`)
            if (cur() && cur()!.kind === 'operator' && cur()!.text === '->') {
                // Lambda — no block, no `end` needed
                if (funcName) {
                    symbols.push({
                        kind: classStack.length > 0 ? 'method' : 'function',
                        name: funcName,
                        line: funcLine,
                        character: funcChar,
                        length: funcLen,
                        className: classStack.length > 0 ? classStack[classStack.length - 1] : undefined,
                        parameters: params,
                    });
                }
                // consume -> and the expression (no block to push)
                i++;
                continue;
            }

            if (funcName) {
                const symIdx = symbols.length;
                symbols.push({
                    kind: classStack.length > 0 ? 'method' : 'function',
                    name: funcName,
                    line: funcLine,
                    character: funcChar,
                    length: funcLen,
                    className: classStack.length > 0 ? classStack[classStack.length - 1] : undefined,
                    parameters: params,
                });
                blockStack.push({ keyword: 'def', line: kw.line, character: kw.start, symbolIndex: symIdx });
            } else {
                blockStack.push({ keyword: 'def', line: kw.line, character: kw.start, symbolIndex: null });
            }
            continue;
        }

        // ----------------------------------------------------------------
        // var x [, y [, ...]] or static x
        // ----------------------------------------------------------------
        if (word === 'var' || word === 'static') {
            i++;
            // Collect all comma-separated names on this line
            const declLine = token.line;
            while (i < tokens.length) {
                const t = cur()!;
                if (t.line !== declLine && t.kind !== 'operator') break;
                if (t.kind === 'identifier') {
                    symbols.push({
                        kind: 'variable',
                        name: t.text,
                        line: t.line,
                        character: t.start,
                        length: t.length,
                        className: classStack.length > 0 ? classStack[classStack.length - 1] : undefined,
                    });
                    i++;
                    continue;
                }
                if (t.kind === 'operator' && t.text === ',') { i++; continue; }
                if (t.kind === 'operator' && t.text === '=') {
                    // Skip the initializer expression up to ',' or end of line / ';'
                    i++;
                    while (i < tokens.length) {
                        const u = cur()!;
                        if (u.line !== declLine) break;
                        if (u.kind === 'operator' && (u.text === ',' || u.text === ';')) break;
                        i++;
                    }
                    continue;
                }
                break;
            }
            continue;
        }

        // ----------------------------------------------------------------
        // import X [as Y]
        // ----------------------------------------------------------------
        if (word === 'import') {
            i++;
            const nameTok = cur();
            if (nameTok && nameTok.kind === 'identifier') {
                let alias: string | undefined;
                i++;
                // Check for `as Y`
                if (cur() && cur()!.kind === 'keyword' && cur()!.text === 'as') {
                    i++;
                    const aliasTok = cur();
                    if (aliasTok && aliasTok.kind === 'identifier') {
                        alias = aliasTok.text;
                        // Record the alias as an importable symbol
                        symbols.push({
                            kind: 'import',
                            name: alias,
                            line: aliasTok.line,
                            character: aliasTok.start,
                            length: aliasTok.length,
                            alias: nameTok.text,
                        });
                        i++;
                    }
                }
                if (!alias) {
                    symbols.push({
                        kind: 'import',
                        name: nameTok.text,
                        line: nameTok.line,
                        character: nameTok.start,
                        length: nameTok.length,
                    });
                }
            }
            continue;
        }

        // ----------------------------------------------------------------
        // Other block-opening keywords (if, while, for, do, try)
        // ----------------------------------------------------------------
        if (BLOCK_OPEN.has(word) && word !== 'class' && word !== 'def') {
            blockStack.push({ keyword: word, line: token.line, character: token.start, symbolIndex: null });
            i++;
            continue;
        }

        // ----------------------------------------------------------------
        // end — closes the innermost block
        // ----------------------------------------------------------------
        if (word === 'end') {
            if (blockStack.length > 0) {
                const top = blockStack.pop()!;
                if (top.symbolIndex !== null) {
                    symbols[top.symbolIndex].endLine = token.line;
                }
                if (top.keyword === 'class' && classStack.length > 0) {
                    classStack.pop();
                }
            }
            i++;
            continue;
        }

        // ---- All other keywords (elif, else, except, break, continue, return, raise) ----
        i++;
    }

    // Collect unmatched openers
    const unmatchedBlocks = blockStack
        .filter(e => e.keyword === 'class' || e.keyword === 'def' ||
                     e.keyword === 'if'    || e.keyword === 'while' ||
                     e.keyword === 'for'   || e.keyword === 'do'    ||
                     e.keyword === 'try')
        .map(e => ({ keyword: e.keyword, line: e.line, character: e.character }));

    return { tokens, symbols, unmatchedBlocks };
}

// ---------------------------------------------------------------------------
// Position utilities
// ---------------------------------------------------------------------------

/** Returns the token at a given 0-based (line, character) position, or undefined. */
export function tokenAtPosition(tokens: Token[], line: number, character: number): Token | undefined {
    for (const tok of tokens) {
        if (tok.endLine !== undefined) {
            // Multi-line comment
            if (line < tok.line || line > tok.endLine) continue;
            if (line === tok.line && character < tok.start) continue;
            if (line === tok.endLine && character >= (tok.endChar ?? 0)) continue;
            return tok;
        }
        if (tok.line !== line) continue;
        if (character >= tok.start && character < tok.start + tok.length) return tok;
    }
    return undefined;
}

/**
 * Returns the word (identifier) at (line, character) without strict token
 * boundaries — useful for completion triggers.
 */
export function wordAtPosition(text: string, line: number, character: number): string {
    const lines = text.split(/\r?\n/);
    const lineText = lines[line] ?? '';
    let start = character;
    while (start > 0 && IDENT_PART.test(lineText[start - 1])) start--;
    let end = character;
    while (end < lineText.length && IDENT_PART.test(lineText[end])) end++;
    return lineText.slice(start, end);
}

/**
 * Returns the character just before the cursor word (used to detect `obj.`
 * member completion context).
 */
export function charBeforeWord(text: string, line: number, character: number): string {
    const lines = text.split(/\r?\n/);
    const lineText = lines[line] ?? '';
    let start = character;
    while (start > 0 && IDENT_PART.test(lineText[start - 1])) start--;
    return start > 0 ? lineText[start - 1] : '';
}
