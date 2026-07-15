/**
 * End-to-end tests for the Berry LSP server using the stdio transport.
 *
 * Each test launches a server subprocess, sends JSON-RPC messages over stdio,
 * and asserts on the responses.
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';

// ---------------------------------------------------------------------------
// LSP client helpers
// ---------------------------------------------------------------------------

function encodeMessage(msg: object): Buffer {
    const body = JSON.stringify(msg);
    const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
    return Buffer.from(header + body, 'utf8');
}

interface LspResponse {
    jsonrpc: string;
    id?: number;
    method?: string;
    result?: unknown;
    error?: { code: number; message: string };
    params?: unknown;
}

class LspClient {
    private proc: ChildProcess;
    private buffer = '';
    private callbacks = new Map<number, (r: LspResponse) => void>();
    private notificationHandler?: (msg: LspResponse) => void;
    private idCounter = 1;

    constructor() {
        const serverPath = path.join(__dirname, '..', 'out', 'server.js');
        this.proc = spawn('node', [serverPath, '--stdio'], {
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        this.proc.stdout!.on('data', (chunk: Buffer) => this.onData(chunk.toString()));
        this.proc.stderr!.on('data', () => { /* suppress */ });
    }

    onNotification(handler: (msg: LspResponse) => void): void {
        this.notificationHandler = handler;
    }

    private onData(data: string): void {
        this.buffer += data;
        while (true) {
            const headerEnd = this.buffer.indexOf('\r\n\r\n');
            if (headerEnd === -1) break;
            const header = this.buffer.slice(0, headerEnd);
            const lenMatch = header.match(/Content-Length: (\d+)/);
            if (!lenMatch) break;
            const len = parseInt(lenMatch[1], 10);
            const bodyStart = headerEnd + 4;
            if (this.buffer.length < bodyStart + len) break;
            const body = this.buffer.slice(bodyStart, bodyStart + len);
            this.buffer = this.buffer.slice(bodyStart + len);
            try {
                const msg: LspResponse = JSON.parse(body);
                if (msg.id !== undefined && this.callbacks.has(msg.id)) {
                    this.callbacks.get(msg.id)!(msg);
                    this.callbacks.delete(msg.id);
                } else if (msg.method) {
                    this.notificationHandler?.(msg);
                }
            } catch { /* ignore parse errors */ }
        }
    }

    send(msg: object): void {
        this.proc.stdin!.write(encodeMessage(msg));
    }

    request(method: string, params: object, timeoutMs = 5000): Promise<LspResponse> {
        const id = this.idCounter++;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.callbacks.delete(id);
                reject(new Error(`Timeout waiting for response to ${method}`));
            }, timeoutMs);
            this.callbacks.set(id, (res) => {
                clearTimeout(timer);
                resolve(res);
            });
            this.send({ jsonrpc: '2.0', id, method, params });
        });
    }

    notify(method: string, params: object): void {
        this.send({ jsonrpc: '2.0', method, params });
    }

    async initialize(): Promise<void> {
        await this.request('initialize', {
            processId: null,
            rootUri: null,
            capabilities: {
                textDocument: {
                    synchronization: { dynamicRegistration: false },
                    definition:  { dynamicRegistration: false },
                    references:  { dynamicRegistration: false },
                    documentSymbol: { dynamicRegistration: false },
                    publishDiagnostics: {},
                },
                workspace: {},
            },
        });
        this.notify('initialized', {});
    }

    openDocument(uri: string, text: string): void {
        this.notify('textDocument/didOpen', {
            textDocument: { uri, languageId: 'berry', version: 1, text },
        });
    }

    changeDocument(uri: string, text: string): void {
        this.notify('textDocument/didChange', {
            textDocument: { uri, version: 2 },
            contentChanges: [{ text }],
        });
    }

    kill(): void {
        this.proc.kill();
    }

    /** Collect all notifications of a given method for up to `ms` milliseconds. */
    collectNotifications(method: string, ms = 500): Promise<LspResponse[]> {
        const results: LspResponse[] = [];
        const prev = this.notificationHandler;
        this.notificationHandler = (msg) => {
            if (msg.method === method) results.push(msg);
            prev?.(msg);
        };
        return new Promise(resolve => setTimeout(() => {
            this.notificationHandler = prev;
            resolve(results);
        }, ms));
    }
}

// ---------------------------------------------------------------------------
// Test setup / teardown
// ---------------------------------------------------------------------------

let client: LspClient;

beforeEach(async () => {
    client = new LspClient();
    await client.initialize();
});

afterEach(() => {
    client.kill();
});

// ---------------------------------------------------------------------------
// Go to definition
// ---------------------------------------------------------------------------

describe('textDocument/definition', () => {
    it('resolves a variable declaration', async () => {
        const uri = 'file:///def_var.be';
        client.openDocument(uri, 'var x = 10\nprint(x)\n');
        await new Promise(r => setTimeout(r, 100));

        const res = await client.request('textDocument/definition', {
            textDocument: { uri },
            position: { line: 1, character: 6 }, // cursor on 'x' in print(x)
        });

        expect(res.error).toBeUndefined();
        const loc = res.result as { uri: string; range: { start: { line: number; character: number } } };
        expect(loc.uri).toBe(uri);
        expect(loc.range.start.line).toBe(0);        // declaration is on line 0
        expect(loc.range.start.character).toBe(4);   // 'x' starts at char 4 in 'var x'
    });

    it('resolves a function declaration', async () => {
        const uri = 'file:///def_fn.be';
        client.openDocument(uri, 'def greet(name)\n  print(name)\nend\ngreet("world")\n');
        await new Promise(r => setTimeout(r, 100));

        const res = await client.request('textDocument/definition', {
            textDocument: { uri },
            position: { line: 3, character: 1 }, // 'greet' on line 3
        });

        const loc = res.result as { range: { start: { line: number } } };
        expect(loc.range.start.line).toBe(0); // function defined on line 0
    });

    it('resolves a class declaration', async () => {
        const uri = 'file:///def_cls.be';
        client.openDocument(uri, 'class Foo\nend\nvar f = Foo()\n');
        await new Promise(r => setTimeout(r, 100));

        const res = await client.request('textDocument/definition', {
            textDocument: { uri },
            position: { line: 2, character: 8 }, // 'Foo' on line 2
        });

        const loc = res.result as { range: { start: { line: number } } };
        expect(loc.range.start.line).toBe(0);
    });

    it('returns null for an undefined symbol', async () => {
        const uri = 'file:///def_undef.be';
        client.openDocument(uri, 'print(undeclared)\n');
        await new Promise(r => setTimeout(r, 100));

        const res = await client.request('textDocument/definition', {
            textDocument: { uri },
            position: { line: 0, character: 6 },
        });

        expect(res.result).toBeNull();
    });

    it('resolves a method declaration', async () => {
        const uri = 'file:///def_meth.be';
        const code = 'class Bar\n  def compute()\n    return 1\n  end\nend\nvar b = Bar()\nb.compute()\n';
        client.openDocument(uri, code);
        await new Promise(r => setTimeout(r, 100));

        const res = await client.request('textDocument/definition', {
            textDocument: { uri },
            position: { line: 6, character: 2 }, // 'compute' on line 6
        });

        const loc = res.result as { range: { start: { line: number } } };
        expect(loc.range.start.line).toBe(1); // 'compute' defined on line 1
    });
});

// ---------------------------------------------------------------------------
// Find references
// ---------------------------------------------------------------------------

describe('textDocument/references', () => {
    it('finds all occurrences of a variable (includeDeclaration=true)', async () => {
        const uri = 'file:///ref_var.be';
        client.openDocument(uri, 'var x = 10\nprint(x)\nvar z = x + 1\n');
        await new Promise(r => setTimeout(r, 100));

        const res = await client.request('textDocument/references', {
            textDocument: { uri },
            position: { line: 1, character: 6 }, // 'x' in print(x)
            context: { includeDeclaration: true },
        });

        const locs = res.result as Array<{ range: { start: { line: number } } }>;
        expect(locs).toHaveLength(3);
        const lines = locs.map(l => l.range.start.line).sort((a, b) => a - b);
        expect(lines).toEqual([0, 1, 2]);
    });

    it('excludes declaration when includeDeclaration=false', async () => {
        const uri = 'file:///ref_nodecl.be';
        client.openDocument(uri, 'var x = 10\nprint(x)\n');
        await new Promise(r => setTimeout(r, 100));

        const res = await client.request('textDocument/references', {
            textDocument: { uri },
            position: { line: 1, character: 6 },
            context: { includeDeclaration: false },
        });

        const locs = res.result as unknown[];
        expect(locs).toHaveLength(1); // only the use, not the declaration
    });

    it('returns empty array for symbol with no references', async () => {
        const uri = 'file:///ref_none.be';
        client.openDocument(uri, 'var lonely = 42\n');
        await new Promise(r => setTimeout(r, 100));

        const res = await client.request('textDocument/references', {
            textDocument: { uri },
            position: { line: 0, character: 4 }, // 'lonely'
            context: { includeDeclaration: false },
        });

        expect(res.result).toEqual([]);
    });

    it('handles missing context gracefully (no crash)', async () => {
        const uri = 'file:///ref_nocontext.be';
        client.openDocument(uri, 'var x = 1\nprint(x)\n');
        await new Promise(r => setTimeout(r, 100));

        // Send without context field — should not crash the server
        const res = await client.request('textDocument/references', {
            textDocument: { uri },
            position: { line: 0, character: 4 },
            // context intentionally omitted
        });

        // Expect a valid (possibly empty) array, not an error
        expect(res.error).toBeUndefined();
        expect(Array.isArray(res.result)).toBe(true);
    });

    it('finds all uses of a function name', async () => {
        const uri = 'file:///ref_fn.be';
        client.openDocument(uri, 'def foo()\n  return 1\nend\nvar a = foo()\nvar b = foo()\n');
        await new Promise(r => setTimeout(r, 100));

        const res = await client.request('textDocument/references', {
            textDocument: { uri },
            position: { line: 3, character: 8 }, // 'foo' on line 3
            context: { includeDeclaration: true },
        });

        const locs = res.result as unknown[];
        expect(locs).toHaveLength(3); // definition + 2 calls
    });
});

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

describe('textDocument/publishDiagnostics', () => {
    it('reports no diagnostics for valid code', async () => {
        const uri = 'file:///diag_ok.be';
        const promise = client.collectNotifications('textDocument/publishDiagnostics');
        client.openDocument(uri, 'var x = 10\nprint(x)\n');
        const notifications = await promise;
        const diag = notifications.find(n => (n.params as { uri: string }).uri === uri);
        expect((diag!.params as { diagnostics: unknown[] }).diagnostics).toHaveLength(0);
    });

    it('reports missing end for if block', async () => {
        const uri = 'file:///diag_if.be';
        const promise = client.collectNotifications('textDocument/publishDiagnostics');
        client.openDocument(uri, 'if true\n  print("hi")\n');
        const notifications = await promise;
        const diag = notifications.find(n => (n.params as { uri: string }).uri === uri);
        const diagnostics = (diag!.params as { diagnostics: Array<{ message: string }> }).diagnostics;
        expect(diagnostics.some(d => d.message.includes("Missing 'end'"))).toBe(true);
    });

    it('reports unterminated string literal', async () => {
        const uri = 'file:///diag_str.be';
        const promise = client.collectNotifications('textDocument/publishDiagnostics');
        client.openDocument(uri, "var s = 'hello\n");
        const notifications = await promise;
        const diag = notifications.find(n => (n.params as { uri: string }).uri === uri);
        const diagnostics = (diag!.params as { diagnostics: Array<{ message: string }> }).diagnostics;
        expect(diagnostics.some(d => d.message.includes('Unterminated string'))).toBe(true);
    });

    it('reports spurious end keyword', async () => {
        const uri = 'file:///diag_spurious.be';
        const promise = client.collectNotifications('textDocument/publishDiagnostics');
        client.openDocument(uri, 'if true\n  x = 1\nend\nend\n'); // extra end
        const notifications = await promise;
        const diag = notifications.find(n => (n.params as { uri: string }).uri === uri);
        const diagnostics = (diag!.params as { diagnostics: Array<{ message: string }> }).diagnostics;
        expect(diagnostics.some(d => d.message.includes("Unexpected 'end'"))).toBe(true);
    });

    it('re-validates document on change', async () => {
        const uri = 'file:///diag_change.be';
        client.openDocument(uri, 'var x = 1\n'); // valid — wait for initial diagnostics
        await new Promise(r => setTimeout(r, 200));

        // Now introduce an error and collect the next diagnostics notification
        const promise = client.collectNotifications('textDocument/publishDiagnostics');
        client.changeDocument(uri, 'if true\n  x = 1\n'); // missing end
        const notifications = await promise;

        // Find the most-recent diagnostics for this URI (may have received multiple)
        const allForUri = notifications.filter(n => (n.params as { uri: string }).uri === uri);
        const last = allForUri[allForUri.length - 1];
        expect(last).toBeDefined();
        const diagnostics = (last!.params as { diagnostics: Array<{ message: string }> }).diagnostics;
        expect(diagnostics.some(d => d.message.includes("Missing 'end'"))).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Document symbols
// ---------------------------------------------------------------------------

describe('textDocument/documentSymbol', () => {
    it('returns class and method symbols', async () => {
        const uri = 'file:///sym_cls.be';
        const code = 'class Foo\n  def bar()\n  end\nend\n';
        client.openDocument(uri, code);
        await new Promise(r => setTimeout(r, 100));

        const res = await client.request('textDocument/documentSymbol', {
            textDocument: { uri },
        });

        const symbols = res.result as Array<{ name: string; children?: unknown[] }>;
        const cls = symbols.find(s => s.name === 'Foo');
        expect(cls).toBeDefined();
        expect(cls!.children?.some((c: unknown) => (c as { name: string }).name === 'bar')).toBe(true);
    });

    it('returns top-level function symbols', async () => {
        const uri = 'file:///sym_fn.be';
        client.openDocument(uri, 'def greet(name)\nend\n');
        await new Promise(r => setTimeout(r, 100));

        const res = await client.request('textDocument/documentSymbol', {
            textDocument: { uri },
        });

        const symbols = res.result as Array<{ name: string }>;
        expect(symbols.some(s => s.name === 'greet')).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Rename
// ---------------------------------------------------------------------------

describe('textDocument/rename', () => {
    it('renames all occurrences of a variable (declaration + uses)', async () => {
        const uri = 'file:///rename_var.be';
        client.openDocument(uri, 'var x = 10\nprint(x)\nvar z = x + 1\n');
        await new Promise(r => setTimeout(r, 100));

        const res = await client.request('textDocument/rename', {
            textDocument: { uri },
            position: { line: 0, character: 4 }, // cursor on 'x' in 'var x'
            newName: 'myVar',
        });

        expect(res.error).toBeUndefined();
        const edit = res.result as { changes: Record<string, Array<{ newText: string }>> };
        const edits = edit.changes[uri];
        expect(edits).toBeDefined();
        expect(edits.every((e: { newText: string }) => e.newText === 'myVar')).toBe(true);
        // declaration + 2 uses = 3 edits
        expect(edits).toHaveLength(3);
    });

    it('renames a function and all its call sites', async () => {
        const uri = 'file:///rename_fn.be';
        client.openDocument(uri, 'def foo()\n  return 1\nend\nvar a = foo()\nvar b = foo()\n');
        await new Promise(r => setTimeout(r, 100));

        const res = await client.request('textDocument/rename', {
            textDocument: { uri },
            position: { line: 0, character: 4 }, // cursor on 'foo' in 'def foo()'
            newName: 'bar',
        });

        expect(res.error).toBeUndefined();
        const edit = res.result as { changes: Record<string, Array<{ newText: string }>> };
        const edits = edit.changes[uri];
        expect(edits.every((e: { newText: string }) => e.newText === 'bar')).toBe(true);
        // declaration + 2 calls = 3 edits
        expect(edits).toHaveLength(3);
    });

    it('returns null when cursor is not on an identifier', async () => {
        const uri = 'file:///rename_noident.be';
        client.openDocument(uri, 'var x = 10\n');
        await new Promise(r => setTimeout(r, 100));

        const res = await client.request('textDocument/rename', {
            textDocument: { uri },
            position: { line: 0, character: 6 }, // cursor on '=' operator
            newName: 'y',
        });

        // Server returns null; some clients surface this as an error, some as null result
        expect(res.error !== undefined || res.result === null).toBe(true);
    });

    it('renames a class and all its references', async () => {
        const uri = 'file:///rename_cls.be';
        client.openDocument(uri, 'class Foo\nend\nvar f = Foo()\n');
        await new Promise(r => setTimeout(r, 100));

        const res = await client.request('textDocument/rename', {
            textDocument: { uri },
            position: { line: 0, character: 6 }, // cursor on 'Foo'
            newName: 'Bar',
        });

        expect(res.error).toBeUndefined();
        const edit = res.result as { changes: Record<string, Array<{ newText: string }>> };
        const edits = edit.changes[uri];
        expect(edits.every((e: { newText: string }) => e.newText === 'Bar')).toBe(true);
        expect(edits).toHaveLength(2); // declaration + constructor call
    });
});

// ---------------------------------------------------------------------------
// Undefined identifier diagnostics
// ---------------------------------------------------------------------------

describe('undefined identifier diagnostics', () => {
    it('emits no warnings for fully declared code', async () => {
        const uri = 'file:///undef_ok.be';
        const promise = client.collectNotifications('textDocument/publishDiagnostics');
        client.openDocument(uri, 'var x = 10\nprint(x)\n');
        const notifications = await promise;
        const diag = notifications.find(n => (n.params as { uri: string }).uri === uri);
        const diagnostics = (diag!.params as { diagnostics: Array<{ message: string }> }).diagnostics;
        expect(diagnostics.filter(d => d.message.includes('is not defined'))).toHaveLength(0);
    });

    it('emits a warning for an undeclared identifier', async () => {
        const uri = 'file:///undef_warn.be';
        const promise = client.collectNotifications('textDocument/publishDiagnostics');
        client.openDocument(uri, 'print(undeclaredVar)\n');
        const notifications = await promise;
        const diag = notifications.find(n => (n.params as { uri: string }).uri === uri);
        const diagnostics = (diag!.params as { diagnostics: Array<{ message: string; severity: number }> }).diagnostics;
        const undef = diagnostics.filter(d => d.message.includes("'undeclaredVar' is not defined"));
        expect(undef).toHaveLength(1);
        expect(undef[0].severity).toBe(2); // DiagnosticSeverity.Warning = 2
    });

    it('does not warn for a built-in global function', async () => {
        const uri = 'file:///undef_builtin.be';
        const promise = client.collectNotifications('textDocument/publishDiagnostics');
        client.openDocument(uri, 'print("hello")\nvar t = type(42)\n');
        const notifications = await promise;
        const diag = notifications.find(n => (n.params as { uri: string }).uri === uri);
        const diagnostics = (diag!.params as { diagnostics: Array<{ message: string }> }).diagnostics;
        expect(diagnostics.filter(d => d.message.includes('is not defined'))).toHaveLength(0);
    });

    it('does not warn for an import module name', async () => {
        const uri = 'file:///undef_import.be';
        const promise = client.collectNotifications('textDocument/publishDiagnostics');
        client.openDocument(uri, 'import math\nvar s = math.sin(1.0)\n');
        const notifications = await promise;
        const diag = notifications.find(n => (n.params as { uri: string }).uri === uri);
        const diagnostics = (diag!.params as { diagnostics: Array<{ message: string }> }).diagnostics;
        expect(diagnostics.filter(d => d.message.includes('is not defined'))).toHaveLength(0);
    });

    it('does not warn for member accesses after a dot', async () => {
        const uri = 'file:///undef_member.be';
        const promise = client.collectNotifications('textDocument/publishDiagnostics');
        client.openDocument(uri, 'var lst = [1,2,3]\nvar n = lst.size()\n');
        const notifications = await promise;
        const diag = notifications.find(n => (n.params as { uri: string }).uri === uri);
        const diagnostics = (diag!.params as { diagnostics: Array<{ message: string }> }).diagnostics;
        // 'size' after '.' should NOT be flagged
        expect(diagnostics.filter(d => d.message.includes("'size' is not defined"))).toHaveLength(0);
    });

    it('does not warn for implicit assignment targets', async () => {
        const uri = 'file:///undef_assign.be';
        const promise = client.collectNotifications('textDocument/publishDiagnostics');
        client.openDocument(uri, 'x = 5\nprint(x)\n');
        const notifications = await promise;
        const diag = notifications.find(n => (n.params as { uri: string }).uri === uri);
        const diagnostics = (diag!.params as { diagnostics: Array<{ message: string }> }).diagnostics;
        expect(diagnostics.filter(d => d.message.includes("'x' is not defined"))).toHaveLength(0);
    });

    it('does not warn for for-loop variables', async () => {
        const uri = 'file:///undef_forloop.be';
        const promise = client.collectNotifications('textDocument/publishDiagnostics');
        client.openDocument(uri, 'for i: 0..5\n  print(i)\nend\n');
        const notifications = await promise;
        const diag = notifications.find(n => (n.params as { uri: string }).uri === uri);
        const diagnostics = (diag!.params as { diagnostics: Array<{ message: string }> }).diagnostics;
        expect(diagnostics.filter(d => d.message.includes("'i' is not defined"))).toHaveLength(0);
    });
});

