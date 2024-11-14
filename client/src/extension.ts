import * as path from 'path';
import {
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
	TransportKind,
} from 'vscode-languageclient/node';
import * as vscode from 'vscode';
import { DebugAdapterFactory } from './Debugger/DebugAdapterFactory';
import { ZSDebugConfigurationProvider } from './Debugger/DebugConfigProvider';

let client: LanguageClient;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const outputChannel = vscode.window.createOutputChannel('ZS Language Server');

	const serverModule = context.asAbsolutePath(path.join('server', 'out', 'server.js'));

	context.subscriptions.push(
		vscode.debug.registerDebugConfigurationProvider(
			'zs',
			new ZSDebugConfigurationProvider()
		),
		vscode.debug.registerDebugAdapterDescriptorFactory('zs', new DebugAdapterFactory())
	);

	const serverOptions: ServerOptions = {
		run: { module: serverModule, transport: TransportKind.ipc },
		debug: {
			module: serverModule,
			transport: TransportKind.ipc,
		},
	};

	const clientOptions: LanguageClientOptions = {
		documentSelector: [
			{ scheme: 'file', language: 'zs' },
			{ scheme: 'file', language: 'zi' },
		],
		synchronize: {
			fileEvents: [
				vscode.workspace.createFileSystemWatcher('**/*.zs'),
				vscode.workspace.createFileSystemWatcher('**/*.zi'),
			],
		},
		outputChannel: outputChannel,
	};

	client = new LanguageClient(
		'zs',
		serverOptions,
		clientOptions
	);

	client.start();
}

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}
