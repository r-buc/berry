"use strict";

const vscode = require("vscode");

const tokenTypes = [
    "namespace",
    "class",
    "function",
    "method",
    "parameter",
    "variable",
    "property",
    "keyword",
    "comment",
    "string",
    "number",
    "operator"
];

const tokenModifiers = [
    "declaration",
    "static"
];

const legend = new vscode.SemanticTokensLegend(tokenTypes, tokenModifiers);

const BLOCK_START_KEYWORDS = new Set(["if", "while", "for", "do", "def", "class", "try"]);
const CONTROL_KEYWORDS = new Set(["if", "elif", "else", "for", "while", "do", "end", "break", "continue", "return", "try", "except", "raise"]);
const DECLARATION_KEYWORDS = new Set(["def", "class", "var", "static"]);
const NAMESPACE_KEYWORDS = new Set(["import", "as"]);
const CONSTANT_KEYWORDS = new Set(["true", "false", "nil", "self", "super", "_class"]);
const KEYWORDS = new Set([...CONTROL_KEYWORDS, ...DECLARATION_KEYWORDS, ...NAMESPACE_KEYWORDS, ...CONSTANT_KEYWORDS]);

const operators = [
    "<<=", ">>=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=",
    "==", "!=", "<=", ">=", "<<", ">>", "&&", "||", "..", ":=", "->"
];
const singleCharOperators = new Set(["(", ")", "[", "]", "{", "}", ".", "-", "!", "~", "*", "/", "%", "+", "&", "^", "|", "<", ">", "=", ":", ",", ";", "?"]);
const IDENT_START_RE = /[A-Za-z_]/;
const IDENT_PART_RE = /[A-Za-z0-9_]/;
const NUMBER_RE = /^(?:0[xX][A-Fa-f0-9]+|\d+[eE][+-]?\d+|(?:\d+\.\d*|\.\d+)(?:[eE][+-]?\d+)?|\d+)/;

function isIdentStart(ch) {
    return IDENT_START_RE.test(ch);
}

function isIdentPart(ch) {
    return IDENT_PART_RE.test(ch);
}

function tokenizeDocument(text) {
    const lines = text.split(/\r?\n/);
    const tokens = [];
    let inBlockComment = false;
    let blockCommentStartLine = 0;
    let blockCommentStartChar = 0;

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];
        let i = 0;

        while (i < line.length) {
            if (inBlockComment) {
                const end = line.indexOf("-#", i);
                if (end >= 0) {
                    tokens.push({
                        kind: "comment",
                        line: blockCommentStartLine,
                        start: blockCommentStartChar,
                        endLine: lineIndex,
                        endChar: end + 2
                    });
                    inBlockComment = false;
                    i = end + 2;
                    continue;
                }
                break;
            }

            const ch = line[i];
            if (/\s/.test(ch)) {
                i++;
                continue;
            }

            if (ch === "#") {
                if (line[i + 1] === "-") {
                    const end = line.indexOf("-#", i + 2);
                    if (end >= 0) {
                        tokens.push({
                            kind: "comment",
                            line: lineIndex,
                            start: i,
                            endLine: lineIndex,
                            endChar: end + 2
                        });
                        i = end + 2;
                        continue;
                    }
                    inBlockComment = true;
                    blockCommentStartLine = lineIndex;
                    blockCommentStartChar = i;
                    break;
                }
                tokens.push({ kind: "comment", line: lineIndex, start: i, length: line.length - i });
                break;
            }

            if ((ch === "f" || ch === "F") && (line[i + 1] === "\"" || line[i + 1] === "'")) {
                const quote = line[i + 1];
                let j = i + 2;
                let escaped = false;
                while (j < line.length) {
                    const c = line[j];
                    if (!escaped && c === quote) {
                        j++;
                        break;
                    }
                    escaped = !escaped && c === "\\";
                    j++;
                }
                tokens.push({ kind: "string", line: lineIndex, start: i, length: j - i });
                i = j;
                continue;
            }

            if (ch === "\"" || ch === "'") {
                const quote = ch;
                let j = i + 1;
                let escaped = false;
                while (j < line.length) {
                    const c = line[j];
                    if (!escaped && c === quote) {
                        j++;
                        break;
                    }
                    escaped = !escaped && c === "\\";
                    j++;
                }
                tokens.push({ kind: "string", line: lineIndex, start: i, length: j - i });
                i = j;
                continue;
            }

            const numberMatch = line.slice(i).match(NUMBER_RE);
            if (numberMatch) {
                tokens.push({ kind: "number", line: lineIndex, start: i, length: numberMatch[0].length, text: numberMatch[0] });
                i += numberMatch[0].length;
                continue;
            }

            if (isIdentStart(ch)) {
                let j = i + 1;
                while (j < line.length && isIdentPart(line[j])) {
                    j++;
                }
                tokens.push({ kind: "identifier", line: lineIndex, start: i, length: j - i, text: line.slice(i, j) });
                i = j;
                continue;
            }

            let matched = false;
            for (const op of operators) {
                if (line.startsWith(op, i)) {
                    tokens.push({ kind: "operator", line: lineIndex, start: i, length: op.length, text: op });
                    i += op.length;
                    matched = true;
                    break;
                }
            }
            if (matched) {
                continue;
            }

            if (singleCharOperators.has(ch)) {
                tokens.push({ kind: "operator", line: lineIndex, start: i, length: 1, text: ch });
                i++;
                continue;
            }

            i++;
        }
    }

    if (inBlockComment) {
        const lastLine = lines.length - 1;
        tokens.push({
            kind: "comment",
            line: blockCommentStartLine,
            start: blockCommentStartChar,
            endLine: lastLine,
            endChar: lines[lastLine] ? lines[lastLine].length : 0
        });
    }

    return tokens;
}

function pushToken(builder, line, start, length, type, modifiers = []) {
    if (length <= 0) {
        return;
    }
    builder.push(line, start, length, tokenTypes.indexOf(type), modifiers.reduce((bits, m) => bits | (1 << tokenModifiers.indexOf(m)), 0));
}

function buildSemanticTokens(document) {
    const builder = new vscode.SemanticTokensBuilder(legend);
    const text = document.getText();
    const tokens = tokenizeDocument(text);

    const activeBlocks = [];
    let expectClassName = false;
    let expectDefName = false;
    let inParamListDepth = 0;
    let markNextIdentifierAsParameter = false;
    let varDeclLine = -1;
    let importLine = -1;

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (token.kind === "comment") {
            if (token.endLine !== undefined) {
                const startPos = new vscode.Position(token.line, token.start);
                const endPos = new vscode.Position(token.endLine, token.endChar);
                const startOffset = document.offsetAt(startPos);
                const endOffset = document.offsetAt(endPos);
                let offset = startOffset;
                while (offset < endOffset) {
                    const pos = document.positionAt(offset);
                    const lineEnd = document.lineAt(pos.line).range.end.character;
                    const lineEndOffset = document.offsetAt(new vscode.Position(pos.line, lineEnd));
                    const length = Math.min(lineEndOffset - offset, endOffset - offset);
                    if (length > 0) {
                        pushToken(builder, pos.line, pos.character, length, "comment");
                    }
                    if (pos.line >= document.lineCount - 1) {
                        break;
                    }
                    offset = document.offsetAt(new vscode.Position(pos.line + 1, 0));
                }
            } else {
                pushToken(builder, token.line, token.start, token.length, "comment");
            }
            continue;
        }

        if (token.kind === "string") {
            pushToken(builder, token.line, token.start, token.length, "string");
            continue;
        }

        if (token.kind === "number") {
            pushToken(builder, token.line, token.start, token.length, "number");
            continue;
        }

        if (token.kind === "operator") {
            pushToken(builder, token.line, token.start, token.length, "operator");
            if (token.text === "(" && expectDefName) {
                expectDefName = false;
                inParamListDepth = 1;
                markNextIdentifierAsParameter = true;
            } else if (token.text === "(" && inParamListDepth > 0) {
                inParamListDepth++;
            } else if (token.text === ")" && inParamListDepth > 0) {
                inParamListDepth--;
                if (inParamListDepth === 0) {
                    markNextIdentifierAsParameter = false;
                }
            } else if (token.text === "," && inParamListDepth > 0) {
                markNextIdentifierAsParameter = true;
            } else if (token.text === ";" && token.line === varDeclLine) {
                varDeclLine = -1;
            } else if (token.text === ";" && token.line === importLine) {
                importLine = -1;
            }
            continue;
        }

        if (token.kind !== "identifier") {
            continue;
        }

        const word = token.text;
        if (KEYWORDS.has(word)) {
            pushToken(builder, token.line, token.start, token.length, "keyword");

            if (word === "class") {
                expectClassName = true;
                activeBlocks.push("class");
            } else if (word === "def") {
                expectDefName = true;
                activeBlocks.push("def");
            } else if (word === "var" || word === "static") {
                varDeclLine = token.line;
            } else if (word === "import") {
                importLine = token.line;
            } else if (BLOCK_START_KEYWORDS.has(word) && word !== "class" && word !== "def") {
                activeBlocks.push(word);
            } else if (word === "end" && activeBlocks.length) {
                activeBlocks.pop();
            } else if (word === "as" && importLine === token.line) {
                continue;
            }
            continue;
        }

        if (expectClassName) {
            expectClassName = false;
            pushToken(builder, token.line, token.start, token.length, "class", ["declaration"]);
            continue;
        }

        if (expectDefName) {
            expectDefName = false;
            const inClass = activeBlocks.includes("class");
            pushToken(builder, token.line, token.start, token.length, inClass ? "method" : "function", ["declaration"]);
            continue;
        }

        if (inParamListDepth > 0 && markNextIdentifierAsParameter) {
            markNextIdentifierAsParameter = false;
            pushToken(builder, token.line, token.start, token.length, "parameter", ["declaration"]);
            continue;
        }

        if (importLine === token.line) {
            pushToken(builder, token.line, token.start, token.length, "namespace");
            continue;
        }

        if (varDeclLine === token.line) {
            pushToken(builder, token.line, token.start, token.length, "variable", ["declaration"]);
            continue;
        }

        const prev = tokens[i - 1];
        if (prev && prev.kind === "operator" && prev.text === ".") {
            pushToken(builder, token.line, token.start, token.length, "property");
            continue;
        }

        const next = tokens[i + 1];
        if (next && next.kind === "operator" && next.text === "(") {
            pushToken(builder, token.line, token.start, token.length, "function");
            continue;
        }

        pushToken(builder, token.line, token.start, token.length, "variable");
    }

    return builder.build();
}

function activate(context) {
    const selector = [
        { language: "berry", scheme: "file" },
        { language: "berry", scheme: "untitled" }
    ];

    const provider = {
        provideDocumentSemanticTokens(document) {
            return buildSemanticTokens(document);
        }
    };

    context.subscriptions.push(vscode.languages.registerDocumentSemanticTokensProvider(selector, provider, legend));
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};
