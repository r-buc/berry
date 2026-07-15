"use strict";
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
 *   • Diagnostics (unmatched blocks, basic syntax errors)
 */
Object.defineProperty(exports, "__esModule", { value: true });
const node_1 = require("vscode-languageserver/node");
const vscode_languageserver_textdocument_1 = require("vscode-languageserver-textdocument");
const parser_1 = require("./parser");
const builtins_1 = require("./builtins");
// ---------------------------------------------------------------------------
// Connection & document manager
// ---------------------------------------------------------------------------
const connection = (0, node_1.createConnection)(node_1.ProposedFeatures.all);
const documents = new node_1.TextDocuments(vscode_languageserver_textdocument_1.TextDocument);
// Cache of parsed documents
const parsedCache = new Map();
function getParsed(uri) {
    return parsedCache.get(uri);
}
function parseAndCache(doc) {
    const parsed = (0, parser_1.parseDocument)(doc.getText());
    parsedCache.set(doc.uri, parsed);
    return parsed;
}
// ---------------------------------------------------------------------------
// Semantic token legend
// ---------------------------------------------------------------------------
const TOKEN_TYPES = [
    'namespace', // 0
    'class', // 1
    'function', // 2
    'method', // 3
    'parameter', // 4
    'variable', // 5
    'property', // 6
    'keyword', // 7
    'comment', // 8
    'string', // 9
    'number', // 10
    'operator', // 11
];
const TOKEN_MODIFIERS = [
    'declaration', // 0
    'static', // 1
];
const TOKEN_TYPE_MAP = new Map(TOKEN_TYPES.map((t, i) => [t, i]));
const TOKEN_MOD_MAP = new Map(TOKEN_MODIFIERS.map((m, i) => [m, i]));
const SEMANTIC_LEGEND = { tokenTypes: TOKEN_TYPES, tokenModifiers: TOKEN_MODIFIERS };
const defaultSettings = {
    diagnostics: { enabled: true },
    trace: { server: 'off' },
};
let hasConfigCapability = false;
let documentSettings = new Map();
// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------
connection.onInitialize((params) => {
    const capabilities = params.capabilities;
    hasConfigCapability = !!(capabilities.workspace?.configuration);
    return {
        capabilities: {
            textDocumentSync: node_1.TextDocumentSyncKind.Incremental,
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
        },
    };
});
connection.onInitialized(() => {
    if (hasConfigCapability) {
        connection.client.register(node_1.DidChangeConfigurationNotification.type, undefined);
    }
});
connection.onDidChangeConfiguration(() => {
    documentSettings.clear();
    documents.all().forEach(validateDocument);
});
async function getDocumentSettings(resource) {
    if (!hasConfigCapability)
        return defaultSettings;
    let result = documentSettings.get(resource);
    if (!result) {
        result = connection.workspace.getConfiguration({ scopeUri: resource, section: 'berry' });
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
async function validateDocument(doc) {
    const settings = await getDocumentSettings(doc.uri);
    if (!settings?.diagnostics?.enabled) {
        connection.sendDiagnostics({ uri: doc.uri, diagnostics: [] });
        return;
    }
    const parsed = getParsed(doc.uri) ?? parseAndCache(doc);
    const diagnostics = [];
    // Report unmatched block openers
    for (const unmatched of parsed.unmatchedBlocks) {
        diagnostics.push({
            severity: node_1.DiagnosticSeverity.Error,
            range: {
                start: { line: unmatched.line, character: unmatched.character },
                end: { line: unmatched.line, character: unmatched.character + unmatched.keyword.length },
            },
            message: `Missing 'end' for '${unmatched.keyword}'.`,
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
                        severity: node_1.DiagnosticSeverity.Error,
                        range: {
                            start: { line: tok.line, character: tok.start },
                            end: { line: tok.line, character: tok.start + tok.length },
                        },
                        message: 'Unterminated string literal.',
                        source: 'berry',
                    });
                }
            }
        }
    }
    connection.sendDiagnostics({ uri: doc.uri, diagnostics });
}
// ---------------------------------------------------------------------------
// Semantic tokens
// ---------------------------------------------------------------------------
connection.languages.semanticTokens.on((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc)
        return { data: [] };
    const parsed = getParsed(doc.uri) ?? parseAndCache(doc);
    return buildSemanticTokens(doc, parsed);
});
function buildSemanticTokens(doc, parsed) {
    const { tokens } = parsed;
    const data = [];
    let prevLine = 0;
    let prevChar = 0;
    const push = (line, startChar, length, type, mods = []) => {
        if (length <= 0)
            return;
        const typeIdx = TOKEN_TYPE_MAP.get(type);
        if (typeIdx === undefined)
            return;
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
    const pushMultiLine = (tok, type, mods = []) => {
        // Multi-line comments: emit one token per line
        const endLine = tok.endLine ?? tok.line;
        const endChar = tok.endChar ?? (tok.start + tok.length);
        for (let l = tok.line; l <= endLine; l++) {
            const lineText = doc.getText(node_1.Range.create(l, 0, l, 10000));
            const start = l === tok.line ? tok.start : 0;
            const end = l === endLine ? endChar : lineText.length;
            const len = end - start;
            if (len > 0)
                push(l, start, len, type, mods);
        }
    };
    // Walk token stream applying semantic types
    const activeBlocks = [];
    let expectClassName = false;
    let expectDefName = false;
    let inParamListDepth = 0;
    let markNextParam = false;
    let varDeclLine = -1;
    let importLine = -1;
    for (let i = 0; i < tokens.length; i++) {
        const tok = tokens[i];
        if (tok.kind === 'comment') {
            if (tok.endLine !== undefined) {
                pushMultiLine(tok, 'comment');
            }
            else {
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
                expectDefName = false;
                inParamListDepth = 1;
                markNextParam = true;
            }
            else if (tok.text === '(' && inParamListDepth > 0) {
                inParamListDepth++;
            }
            else if (tok.text === ')' && inParamListDepth > 0) {
                inParamListDepth--;
                if (inParamListDepth === 0)
                    markNextParam = false;
            }
            else if (tok.text === ',' && inParamListDepth > 0) {
                markNextParam = true;
            }
            else if (tok.text === ';' && tok.line === varDeclLine) {
                varDeclLine = -1;
            }
            else if (tok.text === ';' && tok.line === importLine) {
                importLine = -1;
            }
            continue;
        }
        if (tok.kind !== 'keyword' && tok.kind !== 'identifier')
            continue;
        const word = tok.text;
        if (tok.kind === 'keyword') {
            push(tok.line, tok.start, tok.length, 'keyword');
            if (word === 'class') {
                expectClassName = true;
                activeBlocks.push('class');
            }
            else if (word === 'def') {
                expectDefName = true;
                activeBlocks.push('def');
            }
            else if (word === 'var' || word === 'static') {
                varDeclLine = tok.line;
            }
            else if (word === 'import') {
                importLine = tok.line;
            }
            else if (word === 'end' && activeBlocks.length > 0) {
                activeBlocks.pop();
            }
            else if (['if', 'while', 'for', 'do', 'try'].includes(word)) {
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
connection.onCompletion((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc)
        return [];
    const text = doc.getText();
    const { line, character } = params.position;
    const word = (0, parser_1.wordAtPosition)(text, line, character);
    const charBef = (0, parser_1.charBeforeWord)(text, line, character);
    const parsed = getParsed(doc.uri) ?? parseAndCache(doc);
    // ---- Member completion after `.` ----
    if (charBef === '.') {
        return buildMemberCompletions();
    }
    const items = [];
    // Keywords
    for (const kw of builtins_1.KEYWORDS) {
        items.push({ label: kw, kind: node_1.CompletionItemKind.Keyword });
    }
    // Global built-in functions
    for (const fn of builtins_1.GLOBAL_FUNCTIONS) {
        items.push({
            label: fn.name,
            kind: node_1.CompletionItemKind.Function,
            detail: fn.signature,
            documentation: { kind: node_1.MarkupKind.Markdown, value: fn.documentation },
        });
    }
    // Module names (after `import`)
    for (const mod of builtins_1.MODULE_NAMES) {
        items.push({ label: mod, kind: node_1.CompletionItemKind.Module });
    }
    // Document-local symbols
    for (const sym of parsed.symbols) {
        if (sym.name === word)
            continue; // don't complete the word under cursor
        switch (sym.kind) {
            case 'class':
                items.push({ label: sym.name, kind: node_1.CompletionItemKind.Class });
                break;
            case 'function':
                items.push({
                    label: sym.name,
                    kind: node_1.CompletionItemKind.Function,
                    detail: buildSignatureString(sym.name, sym.parameters ?? []),
                });
                break;
            case 'method':
                items.push({
                    label: sym.name,
                    kind: node_1.CompletionItemKind.Method,
                    detail: buildSignatureString(sym.name, sym.parameters ?? []),
                });
                break;
            case 'variable':
                items.push({ label: sym.name, kind: node_1.CompletionItemKind.Variable });
                break;
            case 'parameter':
                items.push({ label: sym.name, kind: node_1.CompletionItemKind.Variable });
                break;
            case 'import':
                items.push({ label: sym.name, kind: node_1.CompletionItemKind.Module });
                break;
        }
    }
    return deduplicateCompletions(items);
});
function buildMemberCompletions() {
    // Offer all method names from string, list, map, and math/json/os members
    const items = [];
    const addMethods = (methods) => {
        for (const m of methods) {
            items.push({
                label: m.name,
                kind: node_1.CompletionItemKind.Method,
                detail: m.signature,
                documentation: { kind: node_1.MarkupKind.Markdown, value: m.documentation },
            });
        }
    };
    addMethods(builtins_1.STRING_METHODS);
    addMethods(builtins_1.LIST_METHODS);
    addMethods(builtins_1.MAP_METHODS);
    // Module functions (math, json, os, debug, introspect)
    for (const fn of [...builtins_1.MATH_FUNCTIONS, ...builtins_1.JSON_FUNCTIONS, ...builtins_1.OS_FUNCTIONS, ...builtins_1.DEBUG_FUNCTIONS, ...builtins_1.INTROSPECT_FUNCTIONS]) {
        items.push({
            label: fn.name,
            kind: node_1.CompletionItemKind.Function,
            detail: fn.signature,
            documentation: { kind: node_1.MarkupKind.Markdown, value: fn.documentation },
        });
    }
    // math constants
    for (const [name, doc] of Object.entries(builtins_1.MATH_CONSTANTS)) {
        items.push({ label: name, kind: node_1.CompletionItemKind.Constant, documentation: doc });
    }
    return deduplicateCompletions(items);
}
function buildSignatureString(name, params) {
    return `${name}(${params.join(', ')})`;
}
function deduplicateCompletions(items) {
    const seen = new Set();
    return items.filter(item => {
        if (seen.has(item.label))
            return false;
        seen.add(item.label);
        return true;
    });
}
// ---------------------------------------------------------------------------
// Hover
// ---------------------------------------------------------------------------
connection.onHover((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc)
        return null;
    const parsed = getParsed(doc.uri) ?? parseAndCache(doc);
    const { line, character } = params.position;
    const tok = (0, parser_1.tokenAtPosition)(parsed.tokens, line, character);
    if (!tok || (tok.kind !== 'identifier' && tok.kind !== 'keyword'))
        return null;
    const word = tok.text;
    // Built-in keyword / constant
    const constDoc = builtins_1.CONSTANT_DOCS[word];
    if (constDoc) {
        return { contents: { kind: node_1.MarkupKind.Markdown, value: `**${word}** — ${constDoc}` } };
    }
    // Global built-in function
    const gf = builtins_1.GLOBAL_FUNCTION_MAP.get(word);
    if (gf)
        return builtinHover(gf);
    // String method
    const sm = builtins_1.STRING_METHOD_MAP.get(word);
    if (sm)
        return builtinHover(sm);
    // List method
    const lm = builtins_1.LIST_METHOD_MAP.get(word);
    if (lm)
        return builtinHover(lm);
    // Map method
    const mm = builtins_1.MAP_METHOD_MAP.get(word);
    if (mm)
        return builtinHover(mm);
    // Module functions (check all)
    for (const map of [builtins_1.MATH_FUNCTION_MAP, builtins_1.JSON_FUNCTION_MAP, builtins_1.OS_FUNCTION_MAP, builtins_1.DEBUG_FUNCTION_MAP, builtins_1.INTROSPECT_FUNCTION_MAP]) {
        const fn = map.get(word);
        if (fn)
            return builtinHover(fn);
    }
    // Math constants
    if (builtins_1.MATH_CONSTANTS[word]) {
        return { contents: { kind: node_1.MarkupKind.Markdown, value: `**math.${word}** — ${builtins_1.MATH_CONSTANTS[word]}` } };
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
                contents: { kind: node_1.MarkupKind.Markdown, value: md },
                range: {
                    start: { line: sym.line, character: sym.character },
                    end: { line: sym.line, character: sym.character + sym.length },
                },
            };
        }
    }
    return null;
});
function builtinHover(fn) {
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
    return { contents: { kind: node_1.MarkupKind.Markdown, value: md } };
}
// ---------------------------------------------------------------------------
// Go to definition
// ---------------------------------------------------------------------------
connection.onDefinition((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc)
        return null;
    const parsed = getParsed(doc.uri) ?? parseAndCache(doc);
    const { line, character } = params.position;
    const tok = (0, parser_1.tokenAtPosition)(parsed.tokens, line, character);
    if (!tok || tok.kind !== 'identifier')
        return null;
    const word = tok.text;
    // Find the first declaration of this name (prefer class > function > variable)
    const priority = { class: 0, function: 1, method: 2, variable: 3, import: 4, parameter: 5 };
    const matches = parsed.symbols.filter(s => s.name === word);
    if (matches.length === 0)
        return null;
    matches.sort((a, b) => (priority[a.kind] ?? 99) - (priority[b.kind] ?? 99));
    const sym = matches[0];
    return node_1.Location.create(doc.uri, node_1.Range.create({ line: sym.line, character: sym.character }, { line: sym.line, character: sym.character + sym.length }));
});
// ---------------------------------------------------------------------------
// Document symbols (outline)
// ---------------------------------------------------------------------------
connection.onDocumentSymbol((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc)
        return [];
    const parsed = getParsed(doc.uri) ?? parseAndCache(doc);
    const result = [];
    const classMap = new Map();
    for (const sym of parsed.symbols) {
        if (sym.kind === 'parameter')
            continue;
        const endLine = sym.endLine ?? sym.line;
        const range = node_1.Range.create({ line: sym.line, character: sym.character }, { line: endLine, character: sym.character + sym.length });
        const selRange = node_1.Range.create({ line: sym.line, character: sym.character }, { line: sym.line, character: sym.character + sym.length });
        let skind;
        switch (sym.kind) {
            case 'class':
                skind = node_1.SymbolKind.Class;
                break;
            case 'function':
                skind = node_1.SymbolKind.Function;
                break;
            case 'method':
                skind = node_1.SymbolKind.Method;
                break;
            case 'variable':
                skind = node_1.SymbolKind.Variable;
                break;
            case 'import':
                skind = node_1.SymbolKind.Module;
                break;
            default:
                skind = node_1.SymbolKind.Variable;
                break;
        }
        const ds = {
            name: sym.name,
            kind: skind,
            range,
            selectionRange: selRange,
            children: sym.kind === 'class' ? [] : undefined,
        };
        if (sym.kind === 'class') {
            classMap.set(sym.name, ds);
            result.push(ds);
        }
        else if (sym.className) {
            const parent = classMap.get(sym.className);
            if (parent) {
                parent.children = parent.children ?? [];
                parent.children.push(ds);
            }
            else {
                result.push(ds);
            }
        }
        else {
            result.push(ds);
        }
    }
    return result;
});
// ---------------------------------------------------------------------------
// Find references
// ---------------------------------------------------------------------------
connection.onReferences((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc)
        return [];
    const parsed = getParsed(doc.uri) ?? parseAndCache(doc);
    const { line, character } = params.position;
    const tok = (0, parser_1.tokenAtPosition)(parsed.tokens, line, character);
    if (!tok || tok.kind !== 'identifier')
        return [];
    const word = tok.text;
    const locs = [];
    for (const t of parsed.tokens) {
        if (t.kind === 'identifier' && t.text === word) {
            if (!params.context.includeDeclaration) {
                // Skip if it's a declaration token
                const isDecl = parsed.symbols.some(s => s.name === word && s.line === t.line && s.character === t.start);
                if (isDecl)
                    continue;
            }
            locs.push(node_1.Location.create(doc.uri, node_1.Range.create({ line: t.line, character: t.start }, { line: t.line, character: t.start + t.length })));
        }
    }
    return locs;
});
// ---------------------------------------------------------------------------
// Signature help
// ---------------------------------------------------------------------------
connection.onSignatureHelp((params) => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc)
        return null;
    const text = doc.getText();
    const offset = doc.offsetAt(params.position);
    // Walk backwards to find the opening '(' and the function name
    let depth = 0;
    let activeParam = 0;
    let i = offset - 1;
    while (i >= 0) {
        const ch = text[i];
        if (ch === ')') {
            depth++;
        }
        else if (ch === '(') {
            if (depth === 0)
                break;
            depth--;
        }
        else if (ch === ',' && depth === 0) {
            activeParam++;
        }
        i--;
    }
    if (i < 0)
        return null;
    // Extract the function name before '('
    let nameEnd = i;
    while (nameEnd > 0 && /\s/.test(text[nameEnd - 1]))
        nameEnd--;
    let nameStart = nameEnd;
    while (nameStart > 0 && /[A-Za-z0-9_]/.test(text[nameStart - 1]))
        nameStart--;
    const funcName = text.slice(nameStart, nameEnd);
    if (!funcName)
        return null;
    // Look up in all built-in maps
    const allMaps = [
        builtins_1.GLOBAL_FUNCTION_MAP, builtins_1.MATH_FUNCTION_MAP, builtins_1.JSON_FUNCTION_MAP,
        builtins_1.OS_FUNCTION_MAP, builtins_1.DEBUG_FUNCTION_MAP, builtins_1.INTROSPECT_FUNCTION_MAP,
        builtins_1.STRING_METHOD_MAP, builtins_1.LIST_METHOD_MAP, builtins_1.MAP_METHOD_MAP,
    ];
    let fn;
    for (const map of allMaps) {
        fn = map.get(funcName);
        if (fn)
            break;
    }
    // Also look up document-local functions
    if (!fn) {
        const parsed = getParsed(doc.uri) ?? parseAndCache(doc);
        const localFn = parsed.symbols.find(s => s.name === funcName && (s.kind === 'function' || s.kind === 'method'));
        if (localFn) {
            const params2 = localFn.parameters ?? [];
            const sig = {
                label: buildSignatureString(funcName, params2),
                parameters: params2.map(p => ({ label: p })),
            };
            return {
                signatures: [sig],
                activeSignature: 0,
                activeParameter: Math.min(activeParam, Math.max(0, params2.length - 1)),
            };
        }
        return null;
    }
    const paramInfos = fn.parameters.map(p => ({
        label: p.name,
        documentation: { kind: node_1.MarkupKind.Markdown, value: p.description + (p.optional ? ' *(optional)*' : '') },
    }));
    const sig = {
        label: fn.signature,
        documentation: { kind: node_1.MarkupKind.Markdown, value: fn.documentation },
        parameters: paramInfos,
    };
    return {
        signatures: [sig],
        activeSignature: 0,
        activeParameter: Math.min(activeParam, Math.max(0, paramInfos.length - 1)),
    };
});
// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
documents.listen(connection);
connection.listen();
//# sourceMappingURL=server.js.map