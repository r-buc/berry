/**
 * Berry Language Extension – VS Code client entry point.
 *
 * Starts the Berry language server (out/server.js) via IPC and creates a
 * LanguageClient that delegates all document-intelligence requests to it.
 */

import * as path from 'path';
import * as vscode from 'vscode';
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind,
} from 'vscode-languageclient/node';

let client: LanguageClient;

export function activate(context: vscode.ExtensionContext): void {
    const serverModule = context.asAbsolutePath(path.join('out', 'server.js'));

    const serverOptions: ServerOptions = {
        run: {
            module: serverModule,
            transport: TransportKind.ipc,
        },
        debug: {
            module: serverModule,
            transport: TransportKind.ipc,
            options: { execArgv: ['--nolazy', '--inspect=6009'] },
        },
    };

    const clientOptions: LanguageClientOptions = {
        documentSelector: [
            { scheme: 'file',     language: 'berry' },
            { scheme: 'untitled', language: 'berry' },
        ],
        synchronize: {
            fileEvents: vscode.workspace.createFileSystemWatcher('**/*.be'),
        },
    };

    client = new LanguageClient(
        'berry',
        'Berry Language Server',
        serverOptions,
        clientOptions,
    );

    client.start();
}

export function deactivate(): Thenable<void> | undefined {
    if (!client) return undefined;
    return client.stop();
}
