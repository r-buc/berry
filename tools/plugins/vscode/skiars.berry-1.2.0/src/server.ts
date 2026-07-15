/**
 * Berry Language Server
 *
 * Provides full LSP features for the Berry scripting language:
 *   • Semantic tokens
 *   • Completions (keywords, builtins, document symbols)
 *   • Hover documentation
 *   • Go to definition
 *   • Document symbols (outline)
 *   • Signature help
 *   • Find references
 *   • Rename symbol
 *   • Diagnostics (unmatched blocks, basic syntax errors, undefined identifiers)
 */

import {
    createConnection,
    TextDocuments,
    ProposedFeatures,
    InitializeParams,
    DidChangeConfigurationNotification,
    CompletionItem,
    CompletionItemKind,
    TextDocumentPositionParams,
    TextDocumentSyncKind,
    InitializeResult,
    SemanticTokensParams,
    SemanticTokens,
    SemanticTokensLegend,
    HoverParams,
    Hover,
    MarkupKind,
    DefinitionParams,
    Location,
    DocumentSymbolParams,
    DocumentSymbol,
    SymbolKind,
    DiagnosticSeverity,
    Diagnostic,
    ReferenceParams,
    SignatureHelpParams,
    SignatureHelp,
    SignatureInformation,
    ParameterInformation,
    Range,
    Position,
    RenameParams,
    WorkspaceEdit,
    TextEdit,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

import { tokenize, parseDocument, tokenAtPosition, wordAtPosition, charBeforeWord, ALL_KEYWORDS, Token, ParsedDocument } from './parser';
import {
    GLOBAL_FUNCTIONS, GLOBAL_FUNCTION_MAP,
    MATH_FUNCTIONS, MATH_FUNCTION_MAP, MATH_CONSTANTS,
    JSON_FUNCTIONS, JSON_FUNCTION_MAP,
    OS_FUNCTIONS, OS_FUNCTION_MAP,
    DEBUG_FUNCTIONS, DEBUG_FUNCTION_MAP,
    INTROSPECT_FUNCTIONS, INTROSPECT_FUNCTION_MAP,
    STRING_METHODS, STRING_METHOD_MAP,
    LIST_METHODS, LIST_METHOD_MAP,
    MAP_METHODS, MAP_METHOD_MAP,
    CONSTANT_DOCS, MODULE_NAMES, KEYWORDS, BuiltinItem,
} from './builtins';

// ---------------------------------------------------------------------------
// Built-in name registry (used for undefined-identifier diagnostics)
// ---------------------------------------------------------------------------

/**
 * Set of all built-in identifier names that are always available without
 * being declared in the current file (global functions + importable modules).
 * Method names (string/list/map) are accessed through objects and are not
 * included here.
 */
const KNOWN_BUILTIN_NAMES = new Set<string>([
    ...GLOBAL_FUNCTIONS.map(f => f.name),
    ...MODULE_NAMES,
]);

/** Assignment operators: presence as the *next* token marks the prior identifier as an assignment target. */
const ASSIGN_OPS = new Set(['=', ':=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=']);

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments<TextDocument>(TextDocument);

// Cache of parsed documents
const parsedCache = new Map<string, ParsedDocument>();

function getParsed(uri: string): ParsedDocument | undefined {
    return parsedCache.get(uri);
}

function parseAndCache(doc: TextDocument): ParsedDocument {
    const parsed = parseDocument(doc.getText());
    parsedCache.set(doc.uri, parsed);
    return parsed;
}

// ---------------------------------------------------------------------------
// Semantic token legend
// ---------------------------------------------------------------------------

const TOKEN_TYPES = [
    'namespace',   // 0
    'class',       // 1
    'function',    // 2
    'method',      // 3
    'parameter',   // 4
    'variable',    // 5
    'property',    // 6
    'keyword',     // 7
    'comment',     // 8
    'string',      // 9
    'number',      // 10
    'operator',    // 11
];

const TOKEN_MODIFIERS = [
    'declaration', // 0
    'static',      // 1
];

const TOKEN_TYPE_MAP = new Map<string, number>(TOKEN_TYPES.map((t, i) => [t, i]));
const TOKEN_MOD_MAP  = new Map<string, number>(TOKEN_MODIFIERS.map((m, i) => [m, i]));

const SEMANTIC_LEGEND: SemanticTokensLegend = { tokenTypes: TOKEN_TYPES, tokenModifiers: TOKEN_MODIFIERS };

// ---------------------------------------------------------------------------
// Server settings
// ---------------------------------------------------------------------------

interface BerrySettings {
    diagnostics: { enabled: boolean };
    trace: { server: string };
}

const defaultSettings: BerrySettings = {
    diagnostics: { enabled: true },
    trace: { server: 'off' },
};

let hasConfigCapability = false;
let documentSettings = new Map<string, Thenable<BerrySettings>>();

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

connection.onInitialize((params: InitializeParams): InitializeResult => {
    const capabilities = params.capabilities;
    hasConfigCapability = !!(capabilities.workspace?.configuration);

    return {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,
            completionProvider: {
                resolveProvider: false,
                triggerCharacters: ['.', ':'],
            },
            hoverProvider: true,
            definitionProvider: true,
            documentSymbolProvider: true,
            referencesProvider: true,
            signatureHelpProvider: {
                triggerCharacters: ['(', ','],
                retriggerCharacters: [','],
            },
            semanticTokensProvider: {
                legend: SEMANTIC_LEGEND,
                full: true,
            },
            renameProvider: true,
        },
    };
});

connection.onInitialized(() => {
    if (hasConfigCapability) {
        connection.client.register(DidChangeConfigurationNotification.type, undefined);
    }
});

connection.onDidChangeConfiguration(() => {
    documentSettings.clear();
    documents.all().forEach(validateDocument);
});

async function getDocumentSettings(resource: string): Promise<BerrySettings> {
    if (!hasConfigCapability) return defaultSettings;
    let result = documentSettings.get(resource);
    if (!result) {
        result = connection.workspace.getConfiguration({ scopeUri: resource, section: 'berry' }) as Thenable<BerrySettings>;
        documentSettings.set(resource, result);
    }
    return result;
}

// ---------------------------------------------------------------------------
// Document lifecycle
// ---------------------------------------------------------------------------

documents.onDidOpen(e => {
    parseAndCache(e.document);
    validateDocument(e.document);
});

documents.onDidChangeContent(e => {
    parseAndCache(e.document);
    validateDocument(e.document);
});

documents.onDidClose(e => {
    parsedCache.delete(e.document.uri);
    documentSettings.delete(e.document.uri);
});

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

async function validateDocument(doc: TextDocument): Promise<void> {
    const settings = await getDocumentSettings(doc.uri);
    if (!settings?.diagnostics?.enabled) {
        connection.sendDiagnostics({ uri: doc.uri, diagnostics: [] });
        return;
    }

    const parsed = getParsed(doc.uri) ?? parseAndCache(doc);
    const diagnostics: Diagnostic[] = [];

    // Report unmatched block openers
    for (const unmatched of parsed.unmatchedBlocks) {
        diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: {
                start: { line: unmatched.line, character: unmatched.character },
                end:   { line: unmatched.line, character: unmatched.character + unmatched.keyword.length },
            },
            message: `Missing 'end' for '${unmatched.keyword}'.`,
            source: 'berry',
        });
    }

    // Report spurious 'end' keywords (no matching opener)
    for (const spurious of parsed.spuriousEnds) {
        diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: {
                start: { line: spurious.line, character: spurious.character },
                end:   { line: spurious.line, character: spurious.character + 3 }, // 'end'.length === 3
            },
            message: `Unexpected 'end': no matching block opener.`,
            source: 'berry',
        });
    }

    // Report unclosed strings: any string token that ends at the same position
    // it started (i.e., opening quote with no closing quote on the same line)
    for (const tok of parsed.tokens) {
        if (tok.kind === 'string') {
            const text = tok.text;
            if (text.length >= 1) {
                const openQuote = text[0] === 'f' || text[0] === 'F' ? text[1] : text[0];
                if ((openQuote === '"' || openQuote === "'") && text[text.length - 1] !== openQuote) {
                    diagnostics.push({
                        severity: DiagnosticSeverity.Error,
                        range: {
                            start: { line: tok.line, character: tok.start },
                            end:   { line: tok.line, character: tok.start + tok.length },
                        },
                        message: 'Unterminated string literal.',
                        source: 'berry',
                    });
                }
            }
        }
    }

    // Report undefined identifier references (Warning severity — Berry is dynamic
    // and identifiers may come from imports or runtime globals not visible here)
    const declaredNames = new Set<string>(parsed.symbols.map(s => s.name));
    const implicitDecls = collectImplicitDeclarations(parsed.tokens);
    const toks = parsed.tokens;

    for (let idx = 0; idx < toks.length; idx++) {
        const t = toks[idx];
        if (t.kind !== 'identifier') continue;

        // Skip member-access targets (identifier after '.')
        const prev = toks[idx - 1];
        if (prev && prev.kind === 'operator' && prev.text === '.') continue;

        // Skip identifiers that are declared, built-in, or implicitly assigned
        if (declaredNames.has(t.text)) continue;
        if (KNOWN_BUILTIN_NAMES.has(t.text)) continue;
        if (implicitDecls.has(t.text)) continue;

        diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range: {
                start: { line: t.line, character: t.start },
                end:   { line: t.line, character: t.start + t.length },
            },
            message: `Identifier '${t.text}' is not defined.`,
            source: 'berry',
        });
    }

    connection.sendDiagnostics({ uri: doc.uri, diagnostics });
}

/**
 * Collects identifier names that are implicitly declared — not via
 * `var`/`def`/`class`/`import`, but through bare assignment, `for` loop
 * variables, `except` variables, or the lambda-shorthand `/ param ->` syntax.
 */
function collectImplicitDeclarations(tokens: Token[]): Set<string> {
    const implicit = new Set<string>();

    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];

        // LHS of any assignment operator: x = ..., x += ..., x := ...
        if (t.kind === 'identifier') {
            const prev = tokens[i - 1];
            const next = tokens[i + 1];
            if (next && next.kind === 'operator' && ASSIGN_OPS.has(next.text)) {
                if (!prev || !(prev.kind === 'operator' && prev.text === '.')) {
                    implicit.add(t.text);
                }
            }
        }

        // for <ident> [, <ident>]* : <iterable>
        if (t.kind === 'keyword' && t.text === 'for') {
            let j = i + 1;
            while (j < tokens.length) {
                const ft = tokens[j];
                if (ft.kind === 'identifier') { implicit.add(ft.text); j++; }
                else if (ft.kind === 'operator' && ft.text === ',') { j++; }
                else { break; }
            }
        }

        // except [...] as <ident>
        if (t.kind === 'keyword' && t.text === 'as') {
            const next = tokens[i + 1];
            if (next && next.kind === 'identifier') {
                implicit.add(next.text);
            }
        }

        // Lambda shorthand:  / <ident> [, <ident>]* ->  body
        if (t.kind === 'operator' && t.text === '/') {
            // Distinguish  `a / b`  (division) from  `/ x -> x+1`  (lambda) by
            // looking ahead up to LAMBDA_LOOKAHEAD_LIMIT tokens for '->'.  A real
            // lambda parameter list only contains identifiers and commas, so we
            // bail out early on any other token kind.  The limit caps the scan at
            // a reasonable worst-case parameter count (e.g. `/ a, b, c, d, e ->`).
            const LAMBDA_LOOKAHEAD_LIMIT = 10;
            let hasArrow = false;
            for (let j = i + 1; j < tokens.length && j < i + LAMBDA_LOOKAHEAD_LIMIT; j++) {
                if (tokens[j].kind === 'operator' && tokens[j].text === '->') { hasArrow = true; break; }
                if (tokens[j].kind === 'identifier' || (tokens[j].kind === 'operator' && tokens[j].text === ',')) continue;
                break;
            }
            if (hasArrow) {
                let j = i + 1;
                while (j < tokens.length) {
                    const lt = tokens[j];
                    if (lt.kind === 'identifier') { implicit.add(lt.text); j++; }
                    else if (lt.kind === 'operator' && lt.text === ',') { j++; }
                    else { break; }
                }
            }
        }
    }

    return implicit;
}

// ---------------------------------------------------------------------------
// Semantic tokens
// ---------------------------------------------------------------------------

connection.languages.semanticTokens.on((params: SemanticTokensParams): SemanticTokens => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return { data: [] };

    const parsed = getParsed(doc.uri) ?? parseAndCache(doc);
    return buildSemanticTokens(doc, parsed);
});

function buildSemanticTokens(doc: TextDocument, parsed: ParsedDocument): SemanticTokens {
    const { tokens } = parsed;
    const data: number[] = [];

    let prevLine = 0;
    let prevChar = 0;

    const push = (line: number, startChar: number, length: number, type: string, mods: string[] = []): void => {
        if (length <= 0) return;
        const typeIdx = TOKEN_TYPE_MAP.get(type);
        if (typeIdx === undefined) return;
        const modBits = mods.reduce((bits, m) => {
            const idx = TOKEN_MOD_MAP.get(m);
            return idx !== undefined ? bits | (1 << idx) : bits;
        }, 0);
        const deltaLine = line - prevLine;
        const deltaChar = deltaLine === 0 ? startChar - prevChar : startChar;
        data.push(deltaLine, deltaChar, length, typeIdx, modBits);
        prevLine = line;
        prevChar = startChar;
    };

    const pushMultiLine = (tok: Token, type: string, mods: string[] = []): void => {
        // Multi-line comments: emit one token per line
        const endLine = tok.endLine ?? tok.line;
        const endChar = tok.endChar ?? (tok.start + tok.length);
        for (let l = tok.line; l <= endLine; l++) {
            const lineText = doc.getText(Range.create(l, 0, l, 10000));
            const start = l === tok.line ? tok.start : 0;
            const end   = l === endLine  ? endChar   : lineText.length;
            const len   = end - start;
            if (len > 0) push(l, start, len, type, mods);
        }
    };

    // Walk token stream applying semantic types
    const activeBlocks: string[] = [];
    let expectClassName  = false;
    let expectDefName    = false;
    let inParamListDepth = 0;
    let markNextParam    = false;
    let varDeclLine      = -1;
    let importLine       = -1;

    for (let i = 0; i < tokens.length; i++) {
        const tok = tokens[i];

        if (tok.kind === 'comment') {
            if (tok.endLine !== undefined) {
                pushMultiLine(tok, 'comment');
            } else {
                push(tok.line, tok.start, tok.length, 'comment');
            }
            continue;
        }

        if (tok.kind === 'string') {
            push(tok.line, tok.start, tok.length, 'string');
            continue;
        }

        if (tok.kind === 'number') {
            push(tok.line, tok.start, tok.length, 'number');
            continue;
        }

        if (tok.kind === 'operator') {
            push(tok.line, tok.start, tok.length, 'operator');
            if (tok.text === '(' && expectDefName) {
                expectDefName    = false;
                inParamListDepth = 1;
                markNextParam    = true;
            } else if (tok.text === '(' && inParamListDepth > 0) {
                inParamListDepth++;
            } else if (tok.text === ')' && inParamListDepth > 0) {
                inParamListDepth--;
                if (inParamListDepth === 0) markNextParam = false;
            } else if (tok.text === ',' && inParamListDepth > 0) {
                markNextParam = true;
            } else if (tok.text === ';' && tok.line === varDeclLine) {
                varDeclLine = -1;
            } else if (tok.text === ';' && tok.line === importLine) {
                importLine = -1;
            }
            continue;
        }

        if (tok.kind !== 'keyword' && tok.kind !== 'identifier') continue;

        const word = tok.text;

        if (tok.kind === 'keyword') {
            push(tok.line, tok.start, tok.length, 'keyword');

            if (word === 'class') {
                expectClassName = true;
                activeBlocks.push('class');
            } else if (word === 'def') {
                expectDefName = true;
                activeBlocks.push('def');
            } else if (word === 'var' || word === 'static') {
                varDeclLine = tok.line;
            } else if (word === 'import') {
                importLine = tok.line;
            } else if (word === 'end' && activeBlocks.length > 0) {
                activeBlocks.pop();
            } else if (['if', 'while', 'for', 'do', 'try'].includes(word)) {
                activeBlocks.push(word);
            }
            continue;
        }

        // ---- Identifier handling ----

        if (expectClassName) {
            expectClassName = false;
            push(tok.line, tok.start, tok.length, 'class', ['declaration']);
            continue;
        }

        if (expectDefName) {
            expectDefName = false;
            const inClass = activeBlocks.includes('class');
            push(tok.line, tok.start, tok.length, inClass ? 'method' : 'function', ['declaration']);
            continue;
        }

        if (inParamListDepth > 0 && markNextParam) {
            markNextParam = false;
            push(tok.line, tok.start, tok.length, 'parameter', ['declaration']);
            continue;
        }

        if (importLine === tok.line) {
            push(tok.line, tok.start, tok.length, 'namespace');
            continue;
        }

        if (varDeclLine === tok.line) {
            push(tok.line, tok.start, tok.length, 'variable', ['declaration']);
            continue;
        }

        const prev = tokens[i - 1];
        if (prev && prev.kind === 'operator' && prev.text === '.') {
            push(tok.line, tok.start, tok.length, 'property');
            continue;
        }

        const next = tokens[i + 1];
        if (next && next.kind === 'operator' && next.text === '(') {
            const inClass = activeBlocks.includes('class');
            // If it's after a dot, it's a method call — property handled above
            push(tok.line, tok.start, tok.length, inClass ? 'method' : 'function');
            continue;
        }

        push(tok.line, tok.start, tok.length, 'variable');
    }

    return { data };
}

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

connection.onCompletion((params: TextDocumentPositionParams): CompletionItem[] => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return [];

    const text = doc.getText();
    const { line, character } = params.position;

    const word    = wordAtPosition(text, line, character);
    const charBef = charBeforeWord(text, line, character);

    const parsed = getParsed(doc.uri) ?? parseAndCache(doc);

    // ---- Member completion after `.` ----
    if (charBef === '.') {
        return buildMemberCompletions();
    }

    const items: CompletionItem[] = [];

    // Keywords
    for (const kw of KEYWORDS) {
        items.push({ label: kw, kind: CompletionItemKind.Keyword });
    }

    // Global built-in functions
    for (const fn of GLOBAL_FUNCTIONS) {
        items.push({
            label: fn.name,
            kind: CompletionItemKind.Function,
            detail: fn.signature,
            documentation: { kind: MarkupKind.Markdown, value: fn.documentation },
        });
    }

    // Module names (after `import`)
    for (const mod of MODULE_NAMES) {
        items.push({ label: mod, kind: CompletionItemKind.Module });
    }

    // Document-local symbols
    for (const sym of parsed.symbols) {
        if (sym.name === word) continue; // don't complete the word under cursor
        switch (sym.kind) {
            case 'class':
                items.push({ label: sym.name, kind: CompletionItemKind.Class });
                break;
            case 'function':
                items.push({
                    label: sym.name,
                    kind: CompletionItemKind.Function,
                    detail: buildSignatureString(sym.name, sym.parameters ?? []),
                });
                break;
            case 'method':
                items.push({
                    label: sym.name,
                    kind: CompletionItemKind.Method,
                    detail: buildSignatureString(sym.name, sym.parameters ?? []),
                });
                break;
            case 'variable':
                items.push({ label: sym.name, kind: CompletionItemKind.Variable });
                break;
            case 'parameter':
                items.push({ label: sym.name, kind: CompletionItemKind.Variable });
                break;
            case 'import':
                items.push({ label: sym.name, kind: CompletionItemKind.Module });
                break;
        }
    }

    return deduplicateCompletions(items);
});

function buildMemberCompletions(): CompletionItem[] {
    // Offer all method names from string, list, map, and math/json/os members
    const items: CompletionItem[] = [];
    const addMethods = (methods: BuiltinItem[]): void => {
        for (const m of methods) {
            items.push({
                label: m.name,
                kind: CompletionItemKind.Method,
                detail: m.signature,
                documentation: { kind: MarkupKind.Markdown, value: m.documentation },
            });
        }
    };
    addMethods(STRING_METHODS);
    addMethods(LIST_METHODS);
    addMethods(MAP_METHODS);
    // Module functions (math, json, os, debug, introspect)
    for (const fn of [...MATH_FUNCTIONS, ...JSON_FUNCTIONS, ...OS_FUNCTIONS, ...DEBUG_FUNCTIONS, ...INTROSPECT_FUNCTIONS]) {
        items.push({
            label: fn.name,
            kind: CompletionItemKind.Function,
            detail: fn.signature,
            documentation: { kind: MarkupKind.Markdown, value: fn.documentation },
        });
    }
    // math constants
    for (const [name, doc] of Object.entries(MATH_CONSTANTS)) {
        items.push({ label: name, kind: CompletionItemKind.Constant, documentation: doc });
    }
    return deduplicateCompletions(items);
}

function buildSignatureString(name: string, params: string[]): string {
    return `${name}(${params.join(', ')})`;
}

function deduplicateCompletions(items: CompletionItem[]): CompletionItem[] {
    const seen = new Set<string>();
    return items.filter(item => {
        if (seen.has(item.label)) return false;
        seen.add(item.label);
        return true;
    });
}

// ---------------------------------------------------------------------------
// Hover
// ---------------------------------------------------------------------------

connection.onHover((params: HoverParams): Hover | null => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return null;

    const parsed = getParsed(doc.uri) ?? parseAndCache(doc);
    const { line, character } = params.position;
    const tok = tokenAtPosition(parsed.tokens, line, character);
    if (!tok || (tok.kind !== 'identifier' && tok.kind !== 'keyword')) return null;

    const word = tok.text;

    // Built-in keyword / constant
    const constDoc = CONSTANT_DOCS[word];
    if (constDoc) {
        return { contents: { kind: MarkupKind.Markdown, value: `**${word}** — ${constDoc}` } };
    }

    // Global built-in function
    const gf = GLOBAL_FUNCTION_MAP.get(word);
    if (gf) return builtinHover(gf);

    // String method
    const sm = STRING_METHOD_MAP.get(word);
    if (sm) return builtinHover(sm);

    // List method
    const lm = LIST_METHOD_MAP.get(word);
    if (lm) return builtinHover(lm);

    // Map method
    const mm = MAP_METHOD_MAP.get(word);
    if (mm) return builtinHover(mm);

    // Module functions (check all)
    for (const map of [MATH_FUNCTION_MAP, JSON_FUNCTION_MAP, OS_FUNCTION_MAP, DEBUG_FUNCTION_MAP, INTROSPECT_FUNCTION_MAP]) {
        const fn = map.get(word);
        if (fn) return builtinHover(fn);
    }

    // Math constants
    if (MATH_CONSTANTS[word]) {
        return { contents: { kind: MarkupKind.Markdown, value: `**math.${word}** — ${MATH_CONSTANTS[word]}` } };
    }

    // Document symbol
    const sym = parsed.symbols.find(s => s.name === word);
    if (sym) {
        let md = '';
        switch (sym.kind) {
            case 'class':
                md = `**class** \`${word}\``;
                break;
            case 'function':
                md = `**def** \`${buildSignatureString(word, sym.parameters ?? [])}\``;
                break;
            case 'method':
                md = `**def** \`${sym.className}.${buildSignatureString(word, sym.parameters ?? [])}\``;
                break;
            case 'variable':
                md = `**var** \`${word}\`` + (sym.className ? ` *(field of ${sym.className})*` : '');
                break;
            case 'parameter':
                md = `**parameter** \`${word}\``;
                break;
            case 'import':
                md = `**import** \`${sym.alias ?? word}\`` + (sym.alias ? ` as \`${word}\`` : '');
                break;
        }
        if (md) {
            return {
                contents: { kind: MarkupKind.Markdown, value: md },
                range: {
                    start: { line: sym.line, character: sym.character },
                    end:   { line: sym.line, character: sym.character + sym.length },
                },
            };
        }
    }

    return null;
});

function builtinHover(fn: BuiltinItem): Hover {
    let md = `\`\`\`berry\n${fn.signature}\n\`\`\`\n\n${fn.documentation}`;
    if (fn.parameters.length > 0) {
        md += '\n\n**Parameters:**\n';
        for (const p of fn.parameters) {
            md += `- \`${p.name}\`${p.optional ? ' *(optional)*' : ''}: ${p.description}\n`;
        }
    }
    if (fn.returnType) {
        md += `\n**Returns:** \`${fn.returnType}\``;
    }
    return { contents: { kind: MarkupKind.Markdown, value: md } };
}

// ---------------------------------------------------------------------------
// Go to definition
// ---------------------------------------------------------------------------

connection.onDefinition((params: DefinitionParams): Location | null => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return null;

    const parsed = getParsed(doc.uri) ?? parseAndCache(doc);
    const { line, character } = params.position;
    const tok = tokenAtPosition(parsed.tokens, line, character);
    if (!tok || tok.kind !== 'identifier') return null;

    const word = tok.text;
    // Find the first declaration of this name (prefer class > function > variable)
    const priority: Record<string, number> = { class: 0, function: 1, method: 2, variable: 3, import: 4, parameter: 5 };
    const matches = parsed.symbols.filter(s => s.name === word);
    if (matches.length === 0) return null;

    matches.sort((a, b) => (priority[a.kind] ?? 99) - (priority[b.kind] ?? 99));
    const sym = matches[0];

    return Location.create(doc.uri, Range.create(
        { line: sym.line, character: sym.character },
        { line: sym.line, character: sym.character + sym.length },
    ));
});

// ---------------------------------------------------------------------------
// Document symbols (outline)
// ---------------------------------------------------------------------------

connection.onDocumentSymbol((params: DocumentSymbolParams): DocumentSymbol[] => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return [];

    const parsed = getParsed(doc.uri) ?? parseAndCache(doc);
    const result: DocumentSymbol[] = [];
    const classMap = new Map<string, DocumentSymbol>();

    for (const sym of parsed.symbols) {
        if (sym.kind === 'parameter') continue;

        const endLine = sym.endLine ?? sym.line;
        const range = Range.create(
            { line: sym.line, character: sym.character },
            { line: endLine,  character: sym.character + sym.length },
        );
        const selRange = Range.create(
            { line: sym.line, character: sym.character },
            { line: sym.line, character: sym.character + sym.length },
        );

        let skind: SymbolKind;
        switch (sym.kind) {
            case 'class':    skind = SymbolKind.Class;    break;
            case 'function': skind = SymbolKind.Function; break;
            case 'method':   skind = SymbolKind.Method;   break;
            case 'variable': skind = SymbolKind.Variable; break;
            case 'import':   skind = SymbolKind.Module;   break;
            default:         skind = SymbolKind.Variable; break;
        }

        const ds: DocumentSymbol = {
            name:           sym.name,
            kind:           skind,
            range,
            selectionRange: selRange,
            children:       sym.kind === 'class' ? [] : undefined,
        };

        if (sym.kind === 'class') {
            classMap.set(sym.name, ds);
            result.push(ds);
        } else if (sym.className) {
            const parent = classMap.get(sym.className);
            if (parent) {
                parent.children = parent.children ?? [];
                parent.children.push(ds);
            } else {
                result.push(ds);
            }
        } else {
            result.push(ds);
        }
    }

    return result;
});

// ---------------------------------------------------------------------------
// Find references
// ---------------------------------------------------------------------------

connection.onReferences((params: ReferenceParams): Location[] => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return [];

    const parsed = getParsed(doc.uri) ?? parseAndCache(doc);
    const { line, character } = params.position;
    const tok = tokenAtPosition(parsed.tokens, line, character);
    if (!tok || tok.kind !== 'identifier') return [];

    const word = tok.text;
    const locs: Location[] = [];

    for (const t of parsed.tokens) {
        if (t.kind === 'identifier' && t.text === word) {
            if (!(params.context?.includeDeclaration ?? true)) {
                // Skip if it's a declaration token
                const isDecl = parsed.symbols.some(
                    s => s.name === word && s.line === t.line && s.character === t.start,
                );
                if (isDecl) continue;
            }
            locs.push(Location.create(
                doc.uri,
                Range.create({ line: t.line, character: t.start }, { line: t.line, character: t.start + t.length }),
            ));
        }
    }

    return locs;
});

// ---------------------------------------------------------------------------
// Signature help
// ---------------------------------------------------------------------------

connection.onSignatureHelp((params: SignatureHelpParams): SignatureHelp | null => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return null;

    const text = doc.getText();
    const offset = doc.offsetAt(params.position);

    // Walk backwards to find the opening '(' and the function name
    let depth = 0;
    let activeParam = 0;
    let i = offset - 1;
    while (i >= 0) {
        const ch = text[i];
        if (ch === ')') { depth++; }
        else if (ch === '(') {
            if (depth === 0) break;
            depth--;
        } else if (ch === ',' && depth === 0) {
            activeParam++;
        }
        i--;
    }
    if (i < 0) return null;

    // Extract the function name before '('
    let nameEnd = i;
    while (nameEnd > 0 && /\s/.test(text[nameEnd - 1])) nameEnd--;
    let nameStart = nameEnd;
    while (nameStart > 0 && /[A-Za-z0-9_]/.test(text[nameStart - 1])) nameStart--;
    const funcName = text.slice(nameStart, nameEnd);
    if (!funcName) return null;

    // Look up in all built-in maps
    const allMaps = [
        GLOBAL_FUNCTION_MAP, MATH_FUNCTION_MAP, JSON_FUNCTION_MAP,
        OS_FUNCTION_MAP, DEBUG_FUNCTION_MAP, INTROSPECT_FUNCTION_MAP,
        STRING_METHOD_MAP, LIST_METHOD_MAP, MAP_METHOD_MAP,
    ];
    let fn: BuiltinItem | undefined;
    for (const map of allMaps) {
        fn = map.get(funcName);
        if (fn) break;
    }

    // Also look up document-local functions
    if (!fn) {
        const parsed = getParsed(doc.uri) ?? parseAndCache(doc);
        const localFn = parsed.symbols.find(
            s => s.name === funcName && (s.kind === 'function' || s.kind === 'method'),
        );
        if (localFn) {
            const params2 = localFn.parameters ?? [];
            const sig: SignatureInformation = {
                label: buildSignatureString(funcName, params2),
                parameters: params2.map(p => ({ label: p } as ParameterInformation)),
            };
            return {
                signatures: [sig],
                activeSignature: 0,
                activeParameter: Math.min(activeParam, Math.max(0, params2.length - 1)),
            };
        }
        return null;
    }

    const paramInfos: ParameterInformation[] = fn.parameters.map(p => ({
        label: p.name,
        documentation: { kind: MarkupKind.Markdown, value: p.description + (p.optional ? ' *(optional)*' : '') },
    }));

    const sig: SignatureInformation = {
        label: fn.signature,
        documentation: { kind: MarkupKind.Markdown, value: fn.documentation },
        parameters: paramInfos,
    };

    return {
        signatures: [sig],
        activeSignature: 0,
        activeParameter: Math.min(activeParam, Math.max(0, paramInfos.length - 1)),
    };
});

// ---------------------------------------------------------------------------
// Rename
// ---------------------------------------------------------------------------

connection.onRenameRequest((params: RenameParams): WorkspaceEdit | null => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return null;

    const parsed = getParsed(doc.uri) ?? parseAndCache(doc);
    const { line, character } = params.position;
    const tok = tokenAtPosition(parsed.tokens, line, character);
    if (!tok || tok.kind !== 'identifier') return null;

    const oldName = tok.text;
    const newName = params.newName.trim();
    if (!newName || newName === oldName) return null;

    const edits: TextEdit[] = [];
    // NOTE: the rename is file-wide by text match, not scope-aware.  Berry's
    // parser builds a flat symbol table without full lexical-scope analysis,
    // so identifiers with the same name in different (nested) scopes will all
    // be renamed together.  This is the correct behaviour for the most common
    // cases (renaming top-level or class-level symbols) and matches VS Code's
    // expectation for simple single-file rename.
    for (const t of parsed.tokens) {
        if (t.kind === 'identifier' && t.text === oldName) {
            edits.push(TextEdit.replace(
                Range.create(
                    { line: t.line, character: t.start },
                    { line: t.line, character: t.start + t.length },
                ),
                newName,
            ));
        }
    }

    if (edits.length === 0) return null;
    return { changes: { [doc.uri]: edits } };
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

documents.listen(connection);
connection.listen();
