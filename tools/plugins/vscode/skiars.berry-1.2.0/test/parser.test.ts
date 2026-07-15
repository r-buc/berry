/**
 * Tests for the Berry language parser (tokenizer + symbol extractor).
 */

import { tokenize, parseDocument, tokenAtPosition, wordAtPosition, charBeforeWord, Token } from '../src/parser';

// ---------------------------------------------------------------------------
// tokenize()
// ---------------------------------------------------------------------------

describe('tokenize', () => {
    it('tokenizes keywords', () => {
        const tokens = tokenize('if true end');
        expect(tokens.map(t => ({ kind: t.kind, text: t.text }))).toEqual([
            { kind: 'keyword',    text: 'if' },
            { kind: 'keyword',    text: 'true' },
            { kind: 'keyword',    text: 'end' },
        ]);
    });

    it('tokenizes identifiers', () => {
        const tokens = tokenize('myVar = 42');
        expect(tokens[0]).toMatchObject({ kind: 'identifier', text: 'myVar' });
    });

    it('tokenizes integer and hex numbers', () => {
        const tokens = tokenize('123 0xFF 3.14');
        expect(tokens).toHaveLength(3);
        expect(tokens[0]).toMatchObject({ kind: 'number', text: '123' });
        expect(tokens[1]).toMatchObject({ kind: 'number', text: '0xFF' });
        expect(tokens[2]).toMatchObject({ kind: 'number', text: '3.14' });
    });

    it('tokenizes double-quoted strings', () => {
        const tokens = tokenize('"hello world"');
        expect(tokens).toHaveLength(1);
        expect(tokens[0]).toMatchObject({ kind: 'string', text: '"hello world"' });
    });

    it('tokenizes single-quoted strings', () => {
        const tokens = tokenize("'hello'");
        expect(tokens[0]).toMatchObject({ kind: 'string', text: "'hello'" });
    });

    it('tokenizes f-strings', () => {
        const tokens = tokenize('f"value={x}"');
        expect(tokens[0]).toMatchObject({ kind: 'string', text: 'f"value={x}"' });
    });

    it('tokenizes line comments', () => {
        const tokens = tokenize('# this is a comment');
        expect(tokens[0]).toMatchObject({ kind: 'comment', text: '# this is a comment' });
    });

    it('tokenizes single-line block comment (#- -# on one line)', () => {
        const tokens = tokenize('#- block comment -#');
        expect(tokens[0]).toMatchObject({ kind: 'comment' });
        expect(tokens[0].length).toBeGreaterThan(0);
    });

    it('tokenizes multi-line block comment', () => {
        const tokens = tokenize('#- start\nmiddle\nend -#');
        expect(tokens).toHaveLength(1);
        const t = tokens[0];
        expect(t.kind).toBe('comment');
        expect(t.endLine).toBe(2);
    });

    it('records correct line/column for tokens on multiple lines', () => {
        const tokens = tokenize('var x\nvar y');
        const xTok = tokens.find(t => t.text === 'x')!;
        const yTok = tokens.find(t => t.text === 'y')!;
        expect(xTok.line).toBe(0);
        expect(yTok.line).toBe(1);
    });

    it('handles unterminated string (no closing quote)', () => {
        const tokens = tokenize("'hello");
        expect(tokens[0]).toMatchObject({ kind: 'string', text: "'hello" });
    });

    it('handles escape sequences in strings', () => {
        const tokens = tokenize('"say \\"hi\\""');
        expect(tokens[0].kind).toBe('string');
    });

    it('tokenizes multi-character operators', () => {
        const tokens = tokenize('x += 1 == 2 != 3');
        const ops = tokens.filter(t => t.kind === 'operator').map(t => t.text);
        expect(ops).toContain('+=');
        expect(ops).toContain('==');
        expect(ops).toContain('!=');
    });
});

// ---------------------------------------------------------------------------
// parseDocument() — symbols
// ---------------------------------------------------------------------------

describe('parseDocument – symbol extraction', () => {
    it('extracts a class declaration', () => {
        const doc = parseDocument('class Foo\nend\n');
        const cls = doc.symbols.find(s => s.name === 'Foo');
        expect(cls).toBeDefined();
        expect(cls!.kind).toBe('class');
        expect(cls!.endLine).toBe(1);
    });

    it('extracts a function declaration', () => {
        const doc = parseDocument('def greet(name)\n  print(name)\nend\n');
        const fn = doc.symbols.find(s => s.name === 'greet');
        expect(fn).toBeDefined();
        expect(fn!.kind).toBe('function');
        expect(fn!.parameters).toEqual(['name']);
    });

    it('extracts a method inside a class', () => {
        const doc = parseDocument('class Foo\n  def bar()\n  end\nend\n');
        const method = doc.symbols.find(s => s.name === 'bar');
        expect(method).toBeDefined();
        expect(method!.kind).toBe('method');
        expect(method!.className).toBe('Foo');
    });

    it('extracts function parameters', () => {
        const doc = parseDocument('def fn(a, b, c)\nend\n');
        const params = doc.symbols.filter(s => s.kind === 'parameter');
        expect(params.map(p => p.name)).toEqual(['a', 'b', 'c']);
    });

    it('extracts var declarations', () => {
        const doc = parseDocument('var x = 10\n');
        const sym = doc.symbols.find(s => s.name === 'x');
        expect(sym).toBeDefined();
        expect(sym!.kind).toBe('variable');
    });

    it('extracts multiple var names on one line', () => {
        const doc = parseDocument('var a, b, c\n');
        const names = doc.symbols.filter(s => s.kind === 'variable').map(s => s.name);
        expect(names).toContain('a');
        expect(names).toContain('b');
        expect(names).toContain('c');
    });

    it('extracts static declarations', () => {
        const doc = parseDocument('class Foo\n  static count = 0\nend\n');
        const sym = doc.symbols.find(s => s.name === 'count');
        expect(sym).toBeDefined();
        expect(sym!.kind).toBe('variable');
    });

    it('extracts import without alias', () => {
        const doc = parseDocument('import math\n');
        const sym = doc.symbols.find(s => s.name === 'math');
        expect(sym).toBeDefined();
        expect(sym!.kind).toBe('import');
    });

    it('extracts import with alias', () => {
        const doc = parseDocument('import os as operating_system\n');
        const sym = doc.symbols.find(s => s.name === 'operating_system');
        expect(sym).toBeDefined();
        expect(sym!.kind).toBe('import');
        expect(sym!.alias).toBe('os');
    });

    it('tracks endLine for def', () => {
        const doc = parseDocument('def foo()\n  return 1\nend\n');
        const fn = doc.symbols.find(s => s.name === 'foo');
        expect(fn!.endLine).toBe(2);
    });

    it('handles nested classes and methods', () => {
        const code = [
            'class Outer',
            '  def method()',
            '  end',
            'end',
        ].join('\n');
        const doc = parseDocument(code);
        const method = doc.symbols.find(s => s.name === 'method');
        expect(method!.className).toBe('Outer');
    });

    it('handles lambda (arrow function, no end needed)', () => {
        const doc = parseDocument('var fn = def(x) -> x * 2\n');
        // lambda produces no block push so unmatchedBlocks stays empty
        expect(doc.unmatchedBlocks).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// parseDocument() — diagnostics: unmatchedBlocks
// ---------------------------------------------------------------------------

describe('parseDocument – unmatched block diagnostics', () => {
    it('reports missing end for if', () => {
        const doc = parseDocument('if true\n  x = 1\n');
        expect(doc.unmatchedBlocks).toHaveLength(1);
        expect(doc.unmatchedBlocks[0].keyword).toBe('if');
    });

    it('reports missing end for def', () => {
        const doc = parseDocument('def foo()\n  return 1\n');
        expect(doc.unmatchedBlocks).toHaveLength(1);
        expect(doc.unmatchedBlocks[0].keyword).toBe('def');
    });

    it('reports missing end for class', () => {
        const doc = parseDocument('class Foo\n');
        expect(doc.unmatchedBlocks).toHaveLength(1);
        expect(doc.unmatchedBlocks[0].keyword).toBe('class');
    });

    it('reports missing end for while', () => {
        const doc = parseDocument('while true\n  x = 1\n');
        expect(doc.unmatchedBlocks).toHaveLength(1);
        expect(doc.unmatchedBlocks[0].keyword).toBe('while');
    });

    it('reports missing end for for', () => {
        const doc = parseDocument('for i : [1,2,3]\n  print(i)\n');
        expect(doc.unmatchedBlocks).toHaveLength(1);
        expect(doc.unmatchedBlocks[0].keyword).toBe('for');
    });

    it('no false positives for balanced blocks', () => {
        const code = 'if true\n  print("hi")\nend\n';
        const doc = parseDocument(code);
        expect(doc.unmatchedBlocks).toHaveLength(0);
    });

    it('handles nested balanced blocks correctly', () => {
        const code = [
            'def foo()',
            '  if true',
            '    while x > 0',
            '      x -= 1',
            '    end',
            '  end',
            'end',
        ].join('\n');
        const doc = parseDocument(code);
        expect(doc.unmatchedBlocks).toHaveLength(0);
    });

    it('reports multiple missing ends', () => {
        const code = 'if true\n  while x\n    do\n';
        const doc = parseDocument(code);
        expect(doc.unmatchedBlocks).toHaveLength(3);
    });
});

// ---------------------------------------------------------------------------
// parseDocument() — diagnostics: spuriousEnds
// ---------------------------------------------------------------------------

describe('parseDocument – spurious end diagnostics', () => {
    it('reports spurious end at top level', () => {
        const doc = parseDocument('end\n');
        expect(doc.spuriousEnds).toHaveLength(1);
        expect(doc.spuriousEnds[0]).toMatchObject({ line: 0, character: 0 });
    });

    it('reports extra end after balanced block', () => {
        const code = 'if true\n  x = 1\nend\nend\n';
        const doc = parseDocument(code);
        expect(doc.unmatchedBlocks).toHaveLength(0);
        expect(doc.spuriousEnds).toHaveLength(1);
        expect(doc.spuriousEnds[0].line).toBe(3);
    });

    it('no spurious ends when all blocks are balanced', () => {
        const code = 'def foo()\nend\n';
        const doc = parseDocument(code);
        expect(doc.spuriousEnds).toHaveLength(0);
    });

    it('reports multiple spurious ends', () => {
        const code = 'end\nend\nend\n';
        const doc = parseDocument(code);
        expect(doc.spuriousEnds).toHaveLength(3);
    });
});

// ---------------------------------------------------------------------------
// tokenAtPosition()
// ---------------------------------------------------------------------------

describe('tokenAtPosition', () => {
    it('returns the token the cursor is on', () => {
        const tokens = tokenize('var abc = 10');
        const tok = tokenAtPosition(tokens, 0, 4); // 'abc' starts at char 4
        expect(tok).toBeDefined();
        expect(tok!.text).toBe('abc');
    });

    it('returns the token when cursor is on the last character', () => {
        const tokens = tokenize('var abc = 10');
        // 'abc' is at start=4, length=3 → chars 4,5,6
        const tok = tokenAtPosition(tokens, 0, 6);
        expect(tok!.text).toBe('abc');
    });

    it('returns undefined when cursor is after the token', () => {
        const tokens = tokenize('abc ');
        // 'abc' is at 0..2, char 3 is a space (no token)
        const tok = tokenAtPosition(tokens, 0, 7);
        expect(tok).toBeUndefined();
    });

    it('returns token on the correct line', () => {
        const tokens = tokenize('var x\nvar y');
        const tok = tokenAtPosition(tokens, 1, 4); // 'y' on line 1
        expect(tok!.text).toBe('y');
    });

    it('returns multi-line comment token for positions inside it', () => {
        const tokens = tokenize('#- start\nmiddle line\nend -#');
        const tok = tokenAtPosition(tokens, 1, 3); // middle of line 1
        expect(tok).toBeDefined();
        expect(tok!.kind).toBe('comment');
    });

    it('returns undefined for whitespace position', () => {
        const tokens = tokenize('x   y');
        // Space between x and y (chars 1..3)
        const tok = tokenAtPosition(tokens, 0, 2);
        expect(tok).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// wordAtPosition()
// ---------------------------------------------------------------------------

describe('wordAtPosition', () => {
    it('returns the word at the cursor position', () => {
        const word = wordAtPosition('var myVar = 1', 0, 4);
        expect(word).toBe('myVar');
    });

    it('returns word when cursor is in the middle of it', () => {
        const word = wordAtPosition('print(hello)', 0, 7); // inside 'hello'
        expect(word).toBe('hello');
    });

    it('returns empty string for cursor on a space', () => {
        const word = wordAtPosition('x = y', 0, 2); // space
        expect(word).toBe('');
    });
});

// ---------------------------------------------------------------------------
// charBeforeWord()
// ---------------------------------------------------------------------------

describe('charBeforeWord', () => {
    it('returns the character before the word', () => {
        const ch = charBeforeWord('obj.method', 0, 4); // cursor in 'method'
        expect(ch).toBe('.');
    });

    it('returns empty string at beginning of line', () => {
        const ch = charBeforeWord('foo', 0, 0);
        expect(ch).toBe('');
    });

    it('returns space when word is preceded by space', () => {
        const ch = charBeforeWord('x = foo', 0, 4); // cursor on 'foo'
        expect(ch).toBe(' ');
    });
});
